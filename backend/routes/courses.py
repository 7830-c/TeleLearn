import os
import json
import re
import asyncio
import hashlib
import time
import urllib.parse
import aiofiles
import aiofiles.os
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from telethon import functions, types
from telethon.tl.types import (
    MessageMediaDocument,
    MessageMediaPhoto,
    DocumentAttributeVideo,
    DocumentAttributeFilename,
    MessageActionTopicCreate,
    MessageActionTopicEdit,
)
from telegram_client import get_client, normalize_phone
from database import get_db_session, Course
from sqlalchemy.future import select

router = APIRouter()

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# ── Streaming constants ───────────────────────────────────────────────────────
CHUNK_SIZE = 1024 * 1024        # 1 MB chunk granularity (up from 512KB)
STREAM_YIELD_SIZE = 256 * 1024  # Yield to client in 256KB pieces for responsiveness
PARALLELISM = {"low": 3, "medium": 6, "high": 10}

# ── Background pre-fetch tracking ─────────────────────────────────────────────
_prefetch_tasks: dict[str, asyncio.Task] = {}
_prefetch_lock = asyncio.Lock()


# ─── helpers ─────────────────────────────────────────────────────────────────
def parse_range_header(range_header: str, file_size: int):
    start, end, code = 0, file_size - 1, 200
    if range_header:
        m = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if m:
            start = int(m.group(1))
            end   = int(m.group(2)) if m.group(2) else file_size - 1
            code  = 206
    if end >= file_size:
        end = file_size - 1
    return start, end, code


def _cache_path_for(channel_id: int, msg_id: int) -> str:
    return os.path.join(CACHE_DIR, f"{channel_id}_{msg_id}.mp4")


def _meta_path_for(channel_id: int, msg_id: int) -> str:
    return os.path.join(CACHE_DIR, f"{channel_id}_{msg_id}.meta")


def _etag_for(channel_id: int, msg_id: int, file_size: int) -> str:
    return hashlib.md5(f"{channel_id}:{msg_id}:{file_size}".encode()).hexdigest()


async def _get_cached_size(cache_path: str) -> int:
    """Get how many bytes are actually written to the cache file."""
    try:
        stat = await aiofiles.os.stat(cache_path)
        return stat.st_size
    except (FileNotFoundError, OSError):
        return 0


async def _fetch_chunk(client, media, byte_offset: int, max_bytes: int) -> bytes:
    """Fetch chunk cleanly using iter_download with aligned offset support up to 64-bit."""
    aligned_offset = (byte_offset // CHUNK_SIZE) * CHUNK_SIZE
    skip_bytes = byte_offset - aligned_offset
    buf = bytearray()
    try:
        async for piece in client.iter_download(media, offset=aligned_offset, request_size=CHUNK_SIZE):
            if skip_bytes > 0:
                piece = piece[skip_bytes:]
                skip_bytes = 0
            
            buf.extend(piece)
            if len(buf) >= max_bytes:
                break
    except Exception as e:
        print(f"[stream] iter_download error at offset {byte_offset}: {e}")
    return bytes(buf[:max_bytes])


async def _append_to_cache(cache_path: str, data: bytes, offset: int):
    """Write data to the cache file at the specified offset."""
    try:
        async with aiofiles.open(cache_path, "r+b") as f:
            await f.seek(offset)
            await f.write(data)
    except FileNotFoundError:
        # File doesn't exist yet — create it
        async with aiofiles.open(cache_path, "wb") as f:
            if offset > 0:
                await f.seek(offset)
            await f.write(data)


async def _read_from_cache(cache_path: str, offset: int, length: int) -> bytes:
    """Read data from the cache file."""
    try:
        async with aiofiles.open(cache_path, "rb") as f:
            await f.seek(offset)
            return await f.read(length)
    except (FileNotFoundError, OSError):
        return b""


async def _save_meta(channel_id: int, msg_id: int, file_size: int, cached_bytes: int):
    """Save metadata about how much of the file is cached."""
    meta_path = _meta_path_for(channel_id, msg_id)
    data = json.dumps({"file_size": file_size, "cached_bytes": cached_bytes, "ts": time.time()})
    async with aiofiles.open(meta_path, "w") as f:
        await f.write(data)


async def _load_meta(channel_id: int, msg_id: int) -> dict | None:
    """Load cache metadata."""
    meta_path = _meta_path_for(channel_id, msg_id)
    try:
        async with aiofiles.open(meta_path, "r") as f:
            return json.loads(await f.read())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


# ── Background pre-fetch: download entire file to cache ──────────────────────
async def _prefetch_full_file(phone: str, channel_id: int, msg_id: int, file_size: int, quality: str):
    """Background task: download the entire file from Telegram and cache it to disk."""
    cache_path = _cache_path_for(channel_id, msg_id)
    task_key = f"{channel_id}_{msg_id}"

    try:
        cached_size = await _get_cached_size(cache_path)
        if cached_size >= file_size:
            # Already fully cached
            return

        clean_phone = normalize_phone(phone)
        client = await get_client(clean_phone)
        msg = await client.get_messages(channel_id, ids=msg_id)
        if not msg or not msg.media or not hasattr(msg.media, "document"):
            return

        n_parallel = PARALLELISM.get(quality, PARALLELISM["medium"])
        start_offset = cached_size  # Resume from where we left off

        # Create/extend the file to full size so we can write at any offset
        if cached_size == 0:
            async with aiofiles.open(cache_path, "wb") as f:
                pass  # Create empty file

        positions = list(range(start_offset, file_size, CHUNK_SIZE))
        if not positions:
            return

        print(f"[prefetch] Starting background download for {channel_id}/{msg_id} from offset {start_offset} ({len(positions)} chunks)")

        # Process chunks in batches for controlled parallelism
        for batch_start in range(0, len(positions), n_parallel):
            batch = positions[batch_start:batch_start + n_parallel]
            tasks = []
            for pos in batch:
                max_b = min(CHUNK_SIZE, file_size - pos)
                tasks.append(_fetch_chunk(client, msg.media, pos, max_b))

            results = await asyncio.gather(*tasks, return_exceptions=True)

            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    print(f"[prefetch] chunk error at {batch[i]}: {result}")
                    continue
                if result:
                    await _append_to_cache(cache_path, result, batch[i])

            # Update meta periodically
            current_cached = await _get_cached_size(cache_path)
            await _save_meta(channel_id, msg_id, file_size, current_cached)

            # Yield control to avoid starving the event loop
            await asyncio.sleep(0.01)

        final_cached = await _get_cached_size(cache_path)
        await _save_meta(channel_id, msg_id, file_size, final_cached)
        print(f"[prefetch] Completed {channel_id}/{msg_id}: {final_cached}/{file_size} bytes cached")

    except asyncio.CancelledError:
        print(f"[prefetch] Cancelled for {task_key}")
    except Exception as e:
        print(f"[prefetch] Error for {task_key}: {e}")
    finally:
        async with _prefetch_lock:
            _prefetch_tasks.pop(task_key, None)


async def _ensure_prefetch(phone: str, channel_id: int, msg_id: int, file_size: int, quality: str):
    """Start a background pre-fetch if not already running."""
    task_key = f"{channel_id}_{msg_id}"
    async with _prefetch_lock:
        if task_key in _prefetch_tasks:
            task = _prefetch_tasks[task_key]
            if not task.done():
                return  # Already running
        task = asyncio.create_task(
            _prefetch_full_file(phone, channel_id, msg_id, file_size, quality)
        )
        _prefetch_tasks[task_key] = task


# ─── Course CRUD ──────────────────────────────────────────────────────────────
class CourseSyncRequest(BaseModel):
    phone: str
    channel_id: int


@router.get("/channels")
async def list_channels(phone: str):
    try:
        client = await get_client(phone)
        if not await client.is_user_authorized():
            raise HTTPException(status_code=401, detail="User not authorized")
        dialogs = await client.get_dialogs()
        return {"channels": [
            {"id": d.id, "name": d.name, "is_channel": d.is_channel, "is_group": d.is_group}
            for d in dialogs if d.is_channel or d.is_group
        ]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sync")
async def sync_course(request: CourseSyncRequest):
    try:
        clean_phone = normalize_phone(request.phone)
        client = await get_client(clean_phone)
        if not await client.is_user_authorized():
            raise HTTPException(status_code=401, detail="User not authorized")

        entity       = await client.get_entity(request.channel_id)
        channel_name = getattr(entity, "title", f"Channel {request.channel_id}")

        topics_map = {0: "General"}
        if getattr(entity, "forum", False):
            try:
                result = await client(functions.channels.GetForumTopicsRequest(
                    channel=entity, offset_date=None, offset_id=0, offset_topic=0, limit=300
                ))
                for t in result.topics:
                    if isinstance(t, types.ForumTopic):
                        topics_map[t.id] = t.title
            except Exception as e:
                print("Note: Could not get forum topics via RPC:", e)

        messages = []
        async for msg in client.iter_messages(entity):
            messages.append(msg)
            if msg.action and isinstance(msg.action, (MessageActionTopicCreate, MessageActionTopicEdit)):
                if getattr(msg.action, "title", None):
                    topics_map[msg.id] = msg.action.title

        modules_dict: dict = {}
        for msg in messages:
            if not msg.media:
                continue
            topic_id = 0
            if msg.reply_to:
                top_id = getattr(msg.reply_to, "reply_to_top_id", None)
                if top_id is not None:
                    topic_id = top_id
                elif getattr(msg.reply_to, "forum_topic", False):
                    topic_id = getattr(msg.reply_to, "reply_to_msg_id", 0) or 0

            topic_title = topics_map.get(topic_id, f"Sub-Module {topic_id}" if topic_id else "General")
            if topic_id not in modules_dict:
                modules_dict[topic_id] = {"id": topic_id, "title": topic_title, "lessons": [], "notes": []}
            elif modules_dict[topic_id]["title"].startswith("Sub-Module") and topic_id in topics_map:
                modules_dict[topic_id]["title"] = topics_map[topic_id]

            if isinstance(msg.media, MessageMediaDocument):
                doc  = msg.media.document
                mime = (doc.mime_type or "").lower()
                is_video = any(isinstance(a, DocumentAttributeVideo) for a in doc.attributes) or mime.startswith("video/")
                file_name = next(
                    (a.file_name for a in doc.attributes if isinstance(a, DocumentAttributeFilename)), None
                )
                if not file_name:
                    file_name = (msg.text or "").strip().split("\n")[0][:80] or f"{'Lesson' if is_video else 'Note'}_{msg.id}"
                item = {"id": msg.id, "text": file_name, "file_name": file_name,
                        "date": msg.date.isoformat(), "size": doc.size, "mime_type": doc.mime_type}
                if is_video:
                    item["duration"] = next((a.duration for a in doc.attributes if isinstance(a, DocumentAttributeVideo)), 0)
                    modules_dict[topic_id]["lessons"].insert(0, item)
                else:
                    modules_dict[topic_id]["notes"].insert(0, item)
            elif isinstance(msg.media, MessageMediaPhoto):
                file_name = (msg.text or "").strip().split("\n")[0] or f"Photo_Note_{msg.id}.jpg"
                modules_dict[topic_id]["notes"].insert(0, {
                    "id": msg.id, "text": file_name, "file_name": file_name,
                    "date": msg.date.isoformat(), "size": 0, "mime_type": "image/jpeg",
                })

        modules = sorted(
            [m for m in modules_dict.values() if m["lessons"] or m["notes"]],
            key=lambda x: (x["id"] == 0, x["title"])
        )
        course_data = {"channel_id": request.channel_id, "title": channel_name, "modules": modules}

        async for session in get_db_session():
            result = await session.execute(select(Course).filter_by(channel_id=request.channel_id))
            course = result.scalars().first()
            if course:
                course.title = course_data["title"]
                course.data = json.dumps(course_data)
            else:
                course = Course(
                    channel_id=request.channel_id,
                    title=course_data["title"],
                    data=json.dumps(course_data)
                )
                session.add(course)
            await session.commit()
            
            # Retrieve the newly generated ID
            await session.refresh(course)
            course_data["_id"] = str(course.id)
            break
            
        return {"success": True, "course": course_data}
    except Exception as e:
        print("Sync course error:", e)
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/")
async def get_courses():
    async for session in get_db_session():
        result = await session.execute(select(Course))
        courses = []
        for row in result.scalars().all():
            if row.data:
                c = json.loads(row.data)
                c["_id"] = str(row.id)
                courses.append(c)
        return {"courses": courses}


@router.get("/{course_id}")
async def get_course(course_id: str):
    async for session in get_db_session():
        result = await session.execute(select(Course).filter_by(id=int(course_id)))
        row = result.scalars().first()
        if row and row.data:
            c = json.loads(row.data)
            c["_id"] = str(row.id)
            return c
    raise HTTPException(status_code=404, detail="Course not found")


@router.delete("/{course_id}")
async def delete_course(course_id: str):
    async for session in get_db_session():
        result = await session.execute(select(Course).filter_by(id=int(course_id)))
        course = result.scalars().first()
        if course:
            await session.delete(course)
            await session.commit()
        return {"success": True}


# ─── Thumbnail ────────────────────────────────────────────────────────────────
@router.get("/thumbnail/{phone}/{channel_id}/{msg_id}")
async def get_thumbnail(phone: str, channel_id: int, msg_id: int):
    cache_path = os.path.join(CACHE_DIR, f"thumb_{channel_id}_{msg_id}.jpg")
    if not os.path.exists(cache_path):
        clean_phone = normalize_phone(phone)
        client = await get_client(clean_phone)
        msg = await client.get_messages(channel_id, ids=msg_id)
        if not msg or not msg.media:
            raise HTTPException(status_code=404, detail="Thumbnail not found")
        try:
            await client.download_media(msg.media, file=cache_path, thumb=-1)
        except Exception:
            raise HTTPException(status_code=404, detail="No thumbnail available")
    if os.path.exists(cache_path):
        def _send():
            with open(cache_path, "rb") as f:
                yield f.read()
        return StreamingResponse(_send(), media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="Thumbnail not found")


# ─── Stream info (for frontend buffer display) ───────────────────────────────
@router.get("/stream-info/{phone}/{channel_id}/{msg_id}")
async def stream_info(phone: str, channel_id: int, msg_id: int):
    """Returns file size and how much is cached locally."""
    cache_path = _cache_path_for(channel_id, msg_id)
    meta = await _load_meta(channel_id, msg_id)
    cached_bytes = await _get_cached_size(cache_path)

    if meta:
        return {
            "file_size": meta["file_size"],
            "cached_bytes": cached_bytes,
            "cached_pct": round(cached_bytes / meta["file_size"] * 100, 1) if meta["file_size"] > 0 else 0,
            "fully_cached": cached_bytes >= meta["file_size"],
        }

    # No meta yet — need to resolve from Telegram
    try:
        clean_phone = normalize_phone(phone)
        client = await get_client(clean_phone)
        msg = await client.get_messages(channel_id, ids=msg_id)
        if msg and msg.media and hasattr(msg.media, "document"):
            file_size = msg.media.document.size
            return {
                "file_size": file_size,
                "cached_bytes": cached_bytes,
                "cached_pct": round(cached_bytes / file_size * 100, 1) if file_size > 0 else 0,
                "fully_cached": cached_bytes >= file_size,
            }
    except Exception:
        pass

    return {"file_size": 0, "cached_bytes": 0, "cached_pct": 0, "fully_cached": False}


# ─────────────────────────────────────────────────────────────────────────────
# VIDEO STREAMING  —  Sequential direct streaming with automatic disk cache
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/stream/{phone}/{channel_id}/{msg_id}")
async def stream_video(
    phone: str,
    channel_id: int,
    msg_id: int,
    request: Request,
    quality: str = "medium",
):
    cache_path = _cache_path_for(channel_id, msg_id)

    # ── FAST PATH: full file cached on disk ───────────────────────────────────
    if os.path.exists(cache_path):
        meta = await _load_meta(channel_id, msg_id)
        cached_size = await _get_cached_size(cache_path)

        if meta and cached_size >= meta.get("file_size", 1):
            file_size = meta["file_size"]
            start, end, code = parse_range_header(request.headers.get("Range", ""), file_size)
            clen = end - start + 1
            etag = _etag_for(channel_id, msg_id, file_size)

            if_none_match = request.headers.get("If-None-Match", "")
            if if_none_match == f'"{etag}"':
                return StreamingResponse(iter([]), status_code=304, headers={"ETag": f'"{etag}"'})

            async def disk_stream():
                async with aiofiles.open(cache_path, "rb") as f:
                    await f.seek(start)
                    rem = clen
                    while rem > 0:
                        chunk = await f.read(min(STREAM_YIELD_SIZE, rem))
                        if not chunk:
                            break
                        rem -= len(chunk)
                        yield chunk

            return StreamingResponse(disk_stream(), status_code=code, headers={
                "Content-Range":       f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges":       "bytes",
                "Content-Length":      str(clen),
                "Content-Type":        "video/mp4",
                "Content-Disposition": "inline",
                "ETag":                f'"{etag}"',
                "Cache-Control":       "private, max-age=86400",
            })

    # ── Resolve Telegram media ────────────────────────────────────────────────
    try:
        clean_phone = normalize_phone(phone)
        client = await get_client(clean_phone)
        msg    = await client.get_messages(channel_id, ids=msg_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Telegram error: {e}")

    if not msg or not msg.media or not hasattr(msg.media, "document"):
        raise HTTPException(status_code=404, detail="Video media not found")

    doc       = msg.media.document
    file_size = doc.size
    mime_type = getattr(doc, "mime_type", None) or "video/mp4"

    await _save_meta(channel_id, msg_id, file_size, 0)

    start, end, code = parse_range_header(request.headers.get("Range", ""), file_size)
    clen = end - start + 1
    etag = _etag_for(channel_id, msg_id, file_size)

    # ── Direct Sequential Live Streaming from Telegram + Progressive Caching ──
    chunk_request_size = 256 * 1024  # 256 KB chunks for low-latency streaming

    async def telegram_live_stream():
        current_offset = start
        remaining = clen
        try:
            async for piece in client.iter_download(doc, offset=start, request_size=chunk_request_size):
                if remaining <= 0:
                    break
                
                # Truncate piece if it exceeds requested range
                if len(piece) > remaining:
                    piece = piece[:remaining]

                # Progressively write to disk cache
                try:
                    await _append_to_cache(cache_path, piece, current_offset)
                except Exception:
                    pass

                current_offset += len(piece)
                remaining -= len(piece)
                yield piece

            # Update cache metadata
            try:
                new_cached_size = await _get_cached_size(cache_path)
                await _save_meta(channel_id, msg_id, file_size, new_cached_size)
            except Exception:
                pass

        except (asyncio.CancelledError, GeneratorExit):
            # Client disconnected / seeked away — update cache and exit cleanly
            try:
                new_cached_size = await _get_cached_size(cache_path)
                await _save_meta(channel_id, msg_id, file_size, new_cached_size)
            except Exception:
                pass
        except Exception as e:
            print(f"[stream] Error during live streaming {channel_id}/{msg_id}: {e}")

    headers = {
        "Content-Range":       f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges":       "bytes",
        "Content-Type":        mime_type,
        "Content-Disposition": "inline",
        "ETag":                f'"{etag}"',
        "Cache-Control":       "no-cache",
    }
    # Only set Content-Length for exact byte ranges
    if clen > 0:
        headers["Content-Length"] = str(clen)

    return StreamingResponse(
        telegram_live_stream(),
        status_code=code,
        headers=headers
    )


# ─── Download (Instant Full File Streaming & Complete Cache) ────────────────
@router.get("/download/{phone}/{channel_id}/{msg_id}")
async def download_file(phone: str, channel_id: int, msg_id: int):
    try:
        clean_phone = normalize_phone(phone)
        client = await get_client(clean_phone)
        msg = await client.get_messages(channel_id, ids=msg_id)
        if not msg or not msg.media:
            raise HTTPException(status_code=404, detail="File not found")

        file_name = f"lecture_{channel_id}_{msg_id}.mp4"
        media_obj = msg.media
        doc_size = 0
        if hasattr(msg.media, "document"):
            media_obj = msg.media.document
            doc_size = getattr(media_obj, "size", 0)
            for attr in media_obj.attributes:
                if isinstance(attr, DocumentAttributeFilename):
                    file_name = attr.file_name
        elif hasattr(msg.media, "size"):
            doc_size = msg.media.size

        # Check if local cache has the 100% COMPLETE file (must equal or exceed full doc_size)
        mp4_cache = _cache_path_for(channel_id, msg_id)
        if os.path.exists(mp4_cache) and doc_size > 0:
            cached_size = await _get_cached_size(mp4_cache)
            if cached_size >= doc_size:
                return FileResponse(
                    path=mp4_cache,
                    filename=file_name,
                    media_type="application/octet-stream"
                )

        # Stream full file from byte 0 directly to the client's browser download tray
        safe_filename = urllib.parse.quote(file_name)

        async def full_download_stream():
            try:
                # Always start download from offset 0 to ensure the entire file is received
                async for chunk in client.iter_download(media_obj, offset=0, request_size=512 * 1024):
                    yield chunk
            except (asyncio.CancelledError, GeneratorExit):
                pass
            except Exception as e:
                print(f"[download] Full stream error: {e}")

        headers = {
            "Content-Disposition": f'attachment; filename="{file_name}"; filename*=UTF-8\'\'{safe_filename}',
            "Content-Type": "application/octet-stream",
            "Access-Control-Expose-Headers": "Content-Disposition",
        }
        if doc_size > 0:
            headers["Content-Length"] = str(doc_size)

        return StreamingResponse(
            full_download_stream(),
            media_type="application/octet-stream",
            headers=headers
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[download] Error downloading file {channel_id}/{msg_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Download error: {str(e)}")
