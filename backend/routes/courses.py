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
from database import get_db_session, Course, User
from sqlalchemy.future import select

router = APIRouter()

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# ─── Range & ETag helpers ───────────────────────────────────────────────────
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


def _etag_for(channel_id: int, msg_id: int, file_size: int) -> str:
    return hashlib.md5(f"{channel_id}:{msg_id}:{file_size}".encode()).hexdigest()


def _clean_cache_directory(max_size_mb: int = 10, max_age_hours: int = 24):
    """
    Automatic server cache cleanup:
    1. Removes any files older than max_age_hours (default: 24 hours).
    2. Deletes any accidental non-thumbnail/temporary files.
    3. Strictly caps total cache directory size to max_size_mb (default: 10 MB).
    """
    try:
        now = time.time()
        max_age_seconds = max_age_hours * 3600
        max_size_bytes = max_size_mb * 1024 * 1024

        if not os.path.exists(CACHE_DIR):
            return

        all_files = []
        for fname in os.listdir(CACHE_DIR):
            fpath = os.path.join(CACHE_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            
            # Immediately delete any stray video files to preserve 0MB video storage
            if not fname.startswith("thumb_"):
                try:
                    os.remove(fpath)
                    continue
                except OSError:
                    pass

            # Check age (TTL)
            mtime = os.path.getmtime(fpath)
            if (now - mtime) > max_age_seconds:
                try:
                    os.remove(fpath)
                    continue
                except OSError:
                    pass

            all_files.append((fpath, os.path.getsize(fpath), mtime))

        # Check total size against cap
        total_size = sum(f[1] for f in all_files)
        if total_size > max_size_bytes:
            # Sort oldest first (LRU)
            all_files.sort(key=lambda x: x[2])
            target_size = max_size_bytes // 2  # shrink to 50% of limit
            
            for fpath, fsize, _ in all_files:
                try:
                    os.remove(fpath)
                    total_size -= fsize
                    if total_size <= target_size:
                        break
                except OSError:
                    pass
    except Exception as e:
        print(f"[cache_cleaner] Error: {e}")


# ─── Course CRUD ──────────────────────────────────────────────────────────────
class CourseSyncRequest(BaseModel):
    phone: str
    channel_id: int


async def check_telegram_auth_error(phone: str, e: Exception):
    err_str = str(e)
    clean_phone = normalize_phone(phone)
    if any(term in err_str for term in [
        "AuthKeyUnregisteredError", 
        "AuthKeyDuplicatedError", 
        "The key is not registered", 
        "two different IP addresses",
        "SessionRevokedError",
        "UserDeactivatedError",
        "unauthorized"
    ]):
        from telegram_client import clear_client
        await clear_client(clean_phone)
        raise HTTPException(
            status_code=401, 
            detail="Telegram session expired or invalid. Please log in again."
        )


@router.get("/channels")
async def list_channels(phone: str):
    clean_phone = normalize_phone(phone)
    try:
        client = await get_client(clean_phone)
        if not await client.is_user_authorized():
            raise HTTPException(status_code=401, detail="User not authorized")
        dialogs = await client.get_dialogs()
        return {"channels": [
            {"id": d.id, "name": d.name, "is_channel": d.is_channel, "is_group": d.is_group}
            for d in dialogs if d.is_channel or d.is_group
        ]}
    except HTTPException:
        raise
    except Exception as e:
        await check_telegram_auth_error(clean_phone, e)
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sync")
async def sync_course(request: CourseSyncRequest):
    clean_phone = normalize_phone(request.phone)
    try:
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

        async with get_db_session() as session:
            clean_phone = normalize_phone(request.phone)
            user_res = await session.execute(select(User).filter_by(phone=clean_phone))
            user = user_res.scalars().first()
            user_id = user.id if user else None

            result = await session.execute(
                select(Course).filter_by(user_id=user_id, channel_id=request.channel_id)
            )
            course = result.scalars().first()
            if course:
                course.title = course_data["title"]
                course.data = json.dumps(course_data)
            else:
                course = Course(
                    user_id=user_id,
                    channel_id=request.channel_id,
                    title=course_data["title"],
                    data=json.dumps(course_data)
                )
                session.add(course)
            await session.commit()
            
            # Retrieve the newly generated ID
            await session.refresh(course)
            course_data["_id"] = str(course.id)
            
        return {"success": True, "course": course_data}
    except Exception as e:
        print("Sync course error:", e)
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/")
async def get_courses(phone: str = None):
    async with get_db_session() as session:
        if phone:
            clean_phone = normalize_phone(phone)
            user_res = await session.execute(select(User).filter_by(phone=clean_phone))
            user = user_res.scalars().first()
            if user:
                result = await session.execute(select(Course).filter_by(user_id=user.id))
            else:
                return {"courses": []}
        else:
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
    async with get_db_session() as session:
        result = await session.execute(select(Course).filter_by(id=int(course_id)))
        row = result.scalars().first()
        if row and row.data:
            c = json.loads(row.data)
            c["_id"] = str(row.id)
            return c
    raise HTTPException(status_code=404, detail="Course not found")


class RenameModuleRequest(BaseModel):
    phone: str
    new_title: str


@router.put("/{course_id}/modules/{module_id}/rename")
async def rename_module(course_id: str, module_id: int, request: RenameModuleRequest):
    new_title = request.new_title.strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="Module title cannot be empty")

    clean_phone = normalize_phone(request.phone)
    async with get_db_session() as session:
        user_res = await session.execute(select(User).filter_by(phone=clean_phone))
        user = user_res.scalars().first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        result = await session.execute(
            select(Course).filter_by(id=int(course_id), user_id=user.id)
        )
        course = result.scalars().first()
        if not course or not course.data:
            raise HTTPException(status_code=404, detail="Course not found")

        data = json.loads(course.data)
        updated = False
        for mod in data.get("modules", []):
            if mod.get("id") == module_id:
                mod["title"] = new_title
                updated = True
                break

        if not updated:
            raise HTTPException(status_code=404, detail="Module not found in this course")

        course.data = json.dumps(data)
        await session.commit()
        from routes.dashboard import invalidate_dashboard_cache
        invalidate_dashboard_cache(clean_phone)

        data["_id"] = str(course.id)
        return {"success": True, "course": data, "new_title": new_title}


@router.delete("/{course_id}")
async def delete_course(course_id: str, phone: str = None):
    async with get_db_session() as session:
        if phone:
            clean_phone = normalize_phone(phone)
            user_res = await session.execute(select(User).filter_by(phone=clean_phone))
            user = user_res.scalars().first()
            if user:
                result = await session.execute(select(Course).filter_by(id=int(course_id), user_id=user.id))
            else:
                raise HTTPException(status_code=404, detail="User not found")
        else:
            result = await session.execute(select(Course).filter_by(id=int(course_id)))

        course = result.scalars().first()
        if course:
            await session.delete(course)
            await session.commit()
        return {"success": True}


# ─── Thumbnail (Client Browser Cached + Auto-Cleaned Server Cache) ───────────
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
            _clean_cache_directory(max_size_mb=10, max_age_hours=24)
            await client.download_media(msg.media, file=cache_path, thumb=-1)
        except Exception:
            raise HTTPException(status_code=404, detail="No thumbnail available")

    if os.path.exists(cache_path):
        return FileResponse(
            path=cache_path,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=2592000, immutable"}
        )
    raise HTTPException(status_code=404, detail="Thumbnail not found")


# ─── Stream info ─────────────────────────────────────────────────────────────
@router.get("/stream-info/{phone}/{channel_id}/{msg_id}")
async def stream_info(phone: str, channel_id: int, msg_id: int):
    """Returns file size for video player."""
    try:
        clean_phone = normalize_phone(phone)
        client = await get_client(clean_phone)
        msg = await client.get_messages(channel_id, ids=msg_id)
        if msg and msg.media and hasattr(msg.media, "document"):
            file_size = msg.media.document.size
            return {
                "file_size": file_size,
                "cached_bytes": file_size,
                "cached_pct": 100,
                "fully_cached": True,
            }
    except Exception:
        pass

    return {"file_size": 0, "cached_bytes": 0, "cached_pct": 0, "fully_cached": False}


# ─────────────────────────────────────────────────────────────────────────────
# VIDEO STREAMING  —  Zero-Disk On-The-Fly Passthrough with Client Browser Cache
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/stream/{phone}/{channel_id}/{msg_id}")
async def stream_video(
    phone: str,
    channel_id: int,
    msg_id: int,
    request: Request,
    quality: str = "medium",
):
    try:
        clean_phone = normalize_phone(phone)
        client = await get_client(clean_phone)
        msg    = await client.get_messages(channel_id, ids=msg_id)
    except HTTPException:
        raise
    except Exception as e:
        await check_telegram_auth_error(phone, e)
        raise HTTPException(status_code=500, detail=f"Telegram error: {e}")

    if not msg or not msg.media or not hasattr(msg.media, "document"):
        raise HTTPException(status_code=404, detail="Video media not found")

    doc       = msg.media.document
    file_size = doc.size
    mime_type = getattr(doc, "mime_type", None) or "video/mp4"
    if mime_type in ["application/octet-stream", "video/x-matroska", "application/x-matroska", "binary/octet-stream"]:
        mime_type = "video/mp4"

    start, end, code = parse_range_header(request.headers.get("Range", ""), file_size)
    clen = end - start + 1
    etag = _etag_for(channel_id, msg_id, file_size)

    # Check ETag / If-None-Match for browser device cache
    if_none_match = request.headers.get("If-None-Match", "")
    if if_none_match == f'"{etag}"':
        return StreamingResponse(iter([]), status_code=304, headers={"ETag": f'"{etag}"'})

    chunk_map = {
        "low": 128 * 1024,      # 128 KB chunks (Low bandwidth / conservative data usage)
        "medium": 256 * 1024,   # 256 KB chunks (Balanced responsive playback)
        "high": 512 * 1024,     # 512 KB chunks (High throughput / fast pre-buffering)
    }
    chunk_request_size = chunk_map.get(quality, 256 * 1024)

    async def telegram_passthrough_stream():
        remaining = clen
        try:
            async for piece in client.iter_download(doc, offset=start, request_size=chunk_request_size):
                if remaining <= 0:
                    break
                if len(piece) > remaining:
                    piece = piece[:remaining]
                remaining -= len(piece)
                yield piece
        except (asyncio.CancelledError, GeneratorExit):
            pass
        except Exception as e:
            print(f"[stream] Error during live stream {channel_id}/{msg_id}: {e}")

    headers = {
        "Content-Range":       f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges":       "bytes",
        "Content-Type":        mime_type,
        "Content-Disposition": "inline",
        "ETag":                f'"{etag}"',
        "Cache-Control":       "private, max-age=604800",  # Cache on user's device for 7 days
    }
    if clen > 0:
        headers["Content-Length"] = str(clen)

    return StreamingResponse(
        telegram_passthrough_stream(),
        status_code=code,
        headers=headers
    )


# ─── Download (Zero-Disk Full File Stream Directly to Client Device) ──────────
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

        safe_filename = urllib.parse.quote(file_name)

        async def direct_client_download_stream():
            try:
                # Stream entire file from byte 0 directly to client's download manager
                async for chunk in client.iter_download(media_obj, offset=0, request_size=512 * 1024):
                    yield chunk
            except (asyncio.CancelledError, GeneratorExit):
                pass
            except Exception as e:
                print(f"[download] Direct stream error: {e}")

        headers = {
            "Content-Disposition": f'attachment; filename="{file_name}"; filename*=UTF-8\'\'{safe_filename}',
            "Content-Type": "application/octet-stream",
            "Access-Control-Expose-Headers": "Content-Disposition",
        }
        if doc_size > 0:
            headers["Content-Length"] = str(doc_size)

        return StreamingResponse(
            direct_client_download_stream(),
            media_type="application/octet-stream",
            headers=headers
        )
    except HTTPException:
        raise
    except Exception as e:
        await check_telegram_auth_error(phone, e)
        print(f"[download] Error downloading file {channel_id}/{msg_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Download error: {str(e)}")
