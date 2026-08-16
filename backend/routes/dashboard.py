import json
import time
from fastapi import APIRouter, HTTPException
from sqlalchemy.future import select
from sqlalchemy import func
from database import get_db_session, Course, Progress, Bookmark, User, StudyLog
from telegram_client import normalize_phone

router = APIRouter()

# High-speed in-memory cache for dashboard
_dashboard_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 30.0  # 30 seconds

def invalidate_dashboard_cache(phone: str = None):
    if phone:
        clean = normalize_phone(phone)
        _dashboard_cache.pop(clean, None)
    else:
        _dashboard_cache.clear()


async def _get_user_by_phone(session, phone: str):
    result = await session.execute(select(User).filter_by(phone=phone))
    return result.scalars().first()


@router.get("/")
async def get_dashboard(phone: str):
    clean_phone = normalize_phone(phone)

    # Check in-memory cache first for instant sub-millisecond return
    now = time.time()
    if clean_phone in _dashboard_cache:
        cached_time, cached_data = _dashboard_cache[clean_phone]
        if now - cached_time < _CACHE_TTL:
            return cached_data

    async for session in get_db_session():
        user = await _get_user_by_phone(session, clean_phone)

        # 1. Courses
        course_result = await session.execute(select(Course))
        courses = []
        for row in course_result.scalars().all():
            if row.data:
                c = json.loads(row.data)
                c["_id"] = str(row.id)
                courses.append(c)

        # If no user found, return courses with empty user data
        if not user:
            return {
                "courses": courses,
                "metrics": {"total_hours": 0, "hours_today": 0, "streak_days": 0},
                "continue_watching": None,
                "bookmarks_count": 0,
            }

        # 2. Metrics
        total_res = await session.execute(
            select(func.sum(StudyLog.seconds_studied)).filter_by(user_id=user.id)
        )
        total_seconds = total_res.scalar() or 0

        today_res = await session.execute(
            select(func.sum(StudyLog.seconds_studied)).filter_by(
                user_id=user.id, date=func.current_date()
            )
        )
        today_seconds = today_res.scalar() or 0

        metrics = {
            "total_hours": round(total_seconds / 3600, 1),
            "hours_today": round(today_seconds / 3600, 1),
            "streak_days": 1 if today_seconds > 0 else 0,
        }

        # 3. Continue Watching
        cw_result = await session.execute(
            select(Progress)
            .filter_by(user_id=user.id, is_completed=False)
            .order_by(Progress.last_watched_at.desc())
            .limit(1)
        )
        cw_progress = cw_result.scalars().first()
        if not cw_progress:
            cw_result = await session.execute(
                select(Progress)
                .filter_by(user_id=user.id)
                .order_by(Progress.last_watched_at.desc())
                .limit(1)
            )
            cw_progress = cw_result.scalars().first()

        continue_watching = None
        if cw_progress:
            matched_course = next((c for c in courses if str(c.get("_id")) == str(cw_progress.course_id)), None)
            course_title = matched_course.get("title") if matched_course else "Course"
            module_title = "Module"
            lesson_title = f"Lecture #{cw_progress.lesson_id}"
            
            if matched_course:
                for mod in matched_course.get("modules", []):
                    for les in mod.get("lessons", []):
                        if les.get("id") == cw_progress.lesson_id:
                            module_title = mod.get("title", "Module")
                            lesson_title = les.get("file_name") or les.get("text") or lesson_title
                            break

            continue_watching = {
                "course_id": cw_progress.course_id,
                "lesson_id": cw_progress.lesson_id,
                "progress_seconds": cw_progress.progress_seconds,
                "duration_seconds": cw_progress.duration_seconds,
                "course_title": course_title,
                "module_title": module_title,
                "lesson_title": lesson_title,
            }

        # 4. Bookmarks count
        bm_result = await session.execute(
            select(func.count(Bookmark.id)).filter_by(user_id=user.id)
        )
        bookmarks_count = bm_result.scalar() or 0

        output = {
            "courses": courses,
            "metrics": metrics,
            "continue_watching": continue_watching,
            "bookmarks_count": bookmarks_count,
        }
        _dashboard_cache[clean_phone] = (time.time(), output)
        return output
