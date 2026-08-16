import os
import json
import re
import asyncio
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
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
CHUNK_SIZE = 512 * 1024   # 512 KB chunk granularity
PARALLELISM = {"low": 2, "medium": 4, "high": 6}


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


# ─────────────────────────────────────────────────────────────────────────────
# VIDEO STREAMING  —  Concurrent chunk sliding window
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/stream/{phone}/{channel_id}/{msg_id}")
async def stream_video(
    phone: str,
    channel_id: int,
    msg_id: int,
    request: Request,
    quality: str = "medium",
):
    cache_path = os.path.join(CACHE_DIR, f"{channel_id}_{msg_id}.mp4")

    # ── FAST PATH: full file cached on disk ───────────────────────────────────
    if os.path.exists(cache_path):
        file_size = os.path.getsize(cache_path)
        start, end, code = parse_range_header(request.headers.get("Range", ""), file_size)
        clen = end - start + 1

        def disk_stream():
            with open(cache_path, "rb") as f:
                f.seek(start)
                rem = clen
                while rem > 0:
                    chunk = f.read(min(CHUNK_SIZE, rem))
                    if not chunk:
                        break
                    rem -= len(chunk)
                    yield chunk

        return StreamingResponse(disk_stream(), status_code=code, headers={
            "Content-Range":  f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges":  "bytes",
            "Content-Length": str(clen),
            "Content-Type":   "video/mp4",
            "Cache-Control":  "no-cache",
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

    start, end, code = parse_range_header(request.headers.get("Range", ""), file_size)
    clen       = end - start + 1
    n_parallel = PARALLELISM.get(quality, PARALLELISM["medium"])

    # ── CONCURRENT SLIDING-WINDOW STREAM ──────────────────────────────────────
    async def parallel_stream():
        positions = list(range(start, start + clen, CHUNK_SIZE))
        if not positions:
            return

        tasks: dict[int, asyncio.Task] = {}
        next_launch = 0
        bytes_sent  = 0

        def _launch(idx: int):
            if idx >= len(positions):
                return
            pos   = positions[idx]
            max_b = min(CHUNK_SIZE, start + clen - pos)
            tasks[idx] = asyncio.create_task(
                _fetch_chunk(client, msg.media, pos, max_b)
            )

        # Pre-launch initial window of concurrent fetches
        for i in range(min(n_parallel, len(positions))):
            _launch(i)
            next_launch = i + 1

        try:
            for i in range(len(positions)):
                if i not in tasks:
                    break

                try:
                    chunk = await asyncio.wait_for(tasks.pop(i), timeout=60.0)
                except asyncio.TimeoutError:
                    print(f"[stream] 60s timeout chunk {i} — {channel_id}/{msg_id}")
                    break
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    print(f"[stream] chunk {i} error: {e}")
                    break

                # Launch next chunk to keep pipeline saturated
                _launch(next_launch)
                next_launch += 1

                if chunk:
                    bytes_sent += len(chunk)
                    yield chunk

                if bytes_sent >= clen:
                    break

        finally:
            running = list(tasks.values())
            for t in running:
                t.cancel()
            if running:
                await asyncio.gather(*running, return_exceptions=True)

    return StreamingResponse(parallel_stream(), status_code=code, headers={
        "Content-Range":  f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges":  "bytes",
        "Content-Length": str(clen),
        "Content-Type":   mime_type,
        "Cache-Control":  "no-cache",
    })


# ─── Download (full file, offline) ───────────────────────────────────────────
@router.get("/download/{phone}/{channel_id}/{msg_id}")
async def download_file(phone: str, channel_id: int, msg_id: int):
    clean_phone = normalize_phone(phone)
    client = await get_client(clean_phone)
    msg    = await client.get_messages(channel_id, ids=msg_id)
    if not msg or not msg.media:
        raise HTTPException(status_code=404, detail="File not found")

    file_name = "Document"
    media_obj = msg.media
    if hasattr(msg.media, "document"):
        media_obj = msg.media.document
        for attr in media_obj.attributes:
            if isinstance(attr, DocumentAttributeFilename):
                file_name = attr.file_name

    cache_path = os.path.join(CACHE_DIR, f"{channel_id}_{msg_id}_{file_name}")
    if not os.path.exists(cache_path):
        await client.download_media(media_obj, file=cache_path)

    def file_sender():
        with open(cache_path, "rb") as f:
            while chunk := f.read(128 * 1024):
                yield chunk

    return StreamingResponse(file_sender(), headers={
        "Content-Disposition": f'attachment; filename="{file_name}"'
    })
