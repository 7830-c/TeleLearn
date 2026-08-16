import asyncio
import logging
from telethon import TelegramClient
from telethon.network import MTProtoSender
from telethon.tl.functions.auth import ExportAuthorizationRequest, ImportAuthorizationRequest
from telethon.tl.functions.upload import GetFileRequest
from telethon.tl.types import InputDocumentFileLocation

logger = logging.getLogger(__name__)

class SenderPool:
    def __init__(self, senders: list[MTProtoSender]):
        self.senders = senders
        self.semaphores = [asyncio.Semaphore(1) for _ in senders]
        
    async def fetch_part(self, req: GetFileRequest, index: int):
        # Pick sender by round-robin based on part index
        idx = index % len(self.senders)
        sender = self.senders[idx]
        sem = self.semaphores[idx]
        
        async with sem:
            # We add retries at the chunk level
            for attempt in range(3):
                try:
                    res = await sender.send(req)
                    return res.bytes
                except Exception as e:
                    if attempt == 2:
                        raise e
                    await asyncio.sleep(0.5)

_POOL = {}
_POOL_LOCK = asyncio.Lock()

async def get_persistent_pool(client: TelegramClient, phone: str, dc_id: int, workers: int = 6) -> SenderPool:
    key = (phone, dc_id)
    
    async with _POOL_LOCK:
        if key not in _POOL:
            print(f"[FastStream] Creating persistent connection pool for DC {dc_id} with {workers} workers")
            export = await client(ExportAuthorizationRequest(dc_id))
            dc = await client._get_dc(dc_id)
            
            senders = []
            for _ in range(workers):
                # Using None for auth_key so MTProtoSender generates a fresh one
                sender = MTProtoSender(None, loggers=client._log)
                conn = client._connection(
                    dc.ip_address, 
                    dc.port, 
                    dc.id, 
                    loggers=client._log, 
                    proxy=client._proxy
                )
                await sender.connect(conn)
                await sender.send(ImportAuthorizationRequest(id=export.id, bytes=export.bytes))
                senders.append(sender)
                
            _POOL[key] = SenderPool(senders)
            
        return _POOL[key]

async def parallel_stream(client: TelegramClient, phone: str, document, offset: int, limit: int, workers: int = 6):
    """
    High-performance parallel streaming using persistent MTProto sender pools.
    This resolves both sustained playback speeds (via parallelism) and seek latency (via persistent connections).
    """
    dc_id = getattr(document, 'dc_id', client.session.dc_id)
    pool = await get_persistent_pool(client, phone, dc_id, workers=workers)
    
    file_loc = InputDocumentFileLocation(
        id=document.id,
        access_hash=document.access_hash,
        file_reference=document.file_reference,
        thumb_size=""
    )
    
    part_size = 512 * 1024  # 512KB chunk size (max for Telegram)
    start_part = offset // part_size
    end_part = (offset + limit - 1) // part_size
    
    current_part = start_part
    bytes_yielded = 0
    tasks = {}
    
    try:
        while bytes_yielded < limit:
            # Keep up to `workers` parts fetching concurrently
            while len(tasks) < workers and (current_part + len(tasks)) <= end_part:
                part_to_fetch = current_part + len(tasks)
                req = GetFileRequest(
                    location=file_loc,
                    offset=part_to_fetch * part_size,
                    limit=part_size
                )
                tasks[part_to_fetch] = asyncio.create_task(pool.fetch_part(req, part_to_fetch))
                
            # Wait for the next sequential part to be ready
            if current_part not in tasks:
                break # Prevents KeyError in edge cases where EOF is reached early
            task = tasks.pop(current_part)
            data = await task
            
            if not data:
                break # EOF reached
            
            # Slice the first part if offset starts in the middle
            if current_part == start_part:
                skip = offset % part_size
                data = data[skip:]
                
            # Truncate the last part if we have more than limit
            if bytes_yielded + len(data) > limit:
                data = data[:limit - bytes_yielded]
                
            yield data
            bytes_yielded += len(data)
            current_part += 1
            
    finally:
        # Cancel any pending background fetch tasks if the client disconnects early
        for t in tasks.values():
            t.cancel()
