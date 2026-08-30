import json
import time
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Request
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
    clean = normalize_phone(phone)
    result = await session.execute(
        select(User).filter((User.phone == phone) | (User.phone == clean))
    )
    user = result.scalars().first()
    if not user:
        user = User(phone=clean)
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user


async def _calculate_streak_days(session, user_id: int) -> int:
    today = date.today()
    res = await session.execute(
        select(StudyLog.date)
        .filter(StudyLog.user_id == user_id, StudyLog.seconds_studied >= 30)
        .order_by(StudyLog.date.desc())
    )
    studied_dates = set(res.scalars().all())
    if not studied_dates:
        return 0

    streak = 0
    check_date = today
    if check_date not in studied_dates:
        # If user hasn't studied today yet, check if studied yesterday (streak still alive)
        check_date = today - timedelta(days=1)
        if check_date not in studied_dates:
            return 0

    while check_date in studied_dates:
        streak += 1
        check_date -= timedelta(days=1)

    return streak


# ─────────────────────────────────────────────────────────────────────────────
# LIVE STATS ENDPOINT (Fast < 20ms: streak, today's hours, accurate continue watching)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/live")
async def get_dashboard_live(phone: str):
    clean_phone = normalize_phone(phone)
    async with get_db_session() as session:
        user = await _get_user_by_phone(session, clean_phone)
        if not user:
            return {
                "metrics": {"total_hours": 0, "hours_today": 0, "streak_days": 0},
                "continue_watching": None,
                "completed_counts": {},
                "bookmarks_count": 0,
            }

        # 1. Study Metrics
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

        streak_days = await _calculate_streak_days(session, user.id)
        metrics = {
            "total_hours": round(total_seconds / 3600, 1),
            "hours_today": round(today_seconds / 3600, 1),
            "streak_days": streak_days,
        }

        # 2. Continue Watching (Accurately resolves the last played video or next lecture)
        cw_result = await session.execute(
            select(Progress)
            .filter_by(user_id=user.id)
            .order_by(Progress.last_watched_at.desc())
            .limit(1)
        )
        cw_progress = cw_result.scalars().first()

        continue_watching = None
        if cw_progress:
            course_title = "Course"
            module_title = "Module"
            lesson_title = f"Lecture #{cw_progress.lesson_id}"
            is_completed = cw_progress.is_completed
            target_lesson_id = cw_progress.lesson_id
            target_progress_sec = cw_progress.progress_seconds
            target_duration_sec = cw_progress.duration_seconds

            # Look up course metadata for titles
            course_row = None
            try:
                c_res = await session.execute(select(Course).filter_by(id=int(cw_progress.course_id)))
                course_row = c_res.scalars().first()
            except Exception:
                pass

            if course_row and course_row.data:
                try:
                    cdata = json.loads(course_row.data)
                    course_title = cdata.get("title", course_title)
                    found_mod = None
                    found_les_idx = -1

                    for mod in cdata.get("modules", []):
                        lessons = mod.get("lessons", [])
                        for idx, les in enumerate(lessons):
                            if les.get("id") == cw_progress.lesson_id:
                                found_mod = mod
                                found_les_idx = idx
                                module_title = mod.get("title", "Module")
                                lesson_title = les.get("file_name") or les.get("text") or lesson_title
                                break
                        if found_mod:
                            break

                    # If the watched lesson was completed, suggest the next lesson in the module
                    if is_completed and found_mod:
                        lessons = found_mod.get("lessons", [])
                        if found_les_idx + 1 < len(lessons):
                            next_les = lessons[found_les_idx + 1]
                            target_lesson_id = next_les.get("id")
                            lesson_title = next_les.get("file_name") or next_les.get("text") or f"Lecture #{target_lesson_id}"
                            target_progress_sec = 0
                            target_duration_sec = next_les.get("duration", 0)
                            is_completed = False
                except Exception as e:
                    print(f"[dashboard_live] Metadata error: {e}")

            continue_watching = {
                "course_id": cw_progress.course_id,
                "lesson_id": target_lesson_id,
                "progress_seconds": target_progress_sec,
                "duration_seconds": target_duration_sec,
                "is_completed": is_completed,
                "course_title": course_title,
                "module_title": module_title,
                "lesson_title": lesson_title,
            }

        # 3. Completed Lessons Count Grouped by Course
        prog_res = await session.execute(
            select(Progress.course_id, func.count(Progress.id))
            .filter_by(user_id=user.id, is_completed=True)
            .group_by(Progress.course_id)
        )
        completed_counts = {str(row[0]): row[1] for row in prog_res.all()}

        # 4. Bookmarks count
        bm_result = await session.execute(
            select(func.count(Bookmark.id)).filter_by(user_id=user.id)
        )
        bookmarks_count = bm_result.scalar() or 0

        return {
            "metrics": metrics,
            "continue_watching": continue_watching,
            "completed_counts": completed_counts,
            "bookmarks_count": bookmarks_count,
        }


# ─────────────────────────────────────────────────────────────────────────────
# COMPLETE DASHBOARD ENDPOINT (Courses catalog + full structure)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/")
async def get_dashboard(phone: str, req: Request = None):
    clean_phone = normalize_phone(phone)

    # Check if client requested a fresh cache bypass
    no_cache = False
    if req:
        no_cache = "no-cache" in req.headers.get("Cache-Control", "") or req.query_params.get("_t") is not None

    # Check in-memory cache first for instant return
    now = time.time()
    if not no_cache and clean_phone in _dashboard_cache:
        cached_time, cached_data = _dashboard_cache[clean_phone]
        if now - cached_time < _CACHE_TTL:
            return cached_data

    async with get_db_session() as session:
        user = await _get_user_by_phone(session, clean_phone)

        # If no user found, return empty courses and zero metrics
        if not user:
            return {
                "courses": [],
                "metrics": {"total_hours": 0, "hours_today": 0, "streak_days": 0},
                "continue_watching": None,
                "bookmarks_count": 0,
            }

        # 1. Courses strictly for this specific user
        course_result = await session.execute(select(Course).filter_by(user_id=user.id))
        courses = []
        for row in course_result.scalars().all():
            if row.data:
                c = json.loads(row.data)
                c["_id"] = str(row.id)
                courses.append(c)

        completed_lessons_by_course = {}
        user_progress_res = await session.execute(
            select(Progress).filter_by(user_id=user.id, is_completed=True)
        )
        for p in user_progress_res.scalars().all():
            cid = str(p.course_id)
            completed_lessons_by_course.setdefault(cid, set()).add(p.lesson_id)

        # Attach progress metrics to each course catalog item
        for c in courses:
            cid = str(c.get("_id"))
            all_lessons = [l for mod in c.get("modules", []) for l in mod.get("lessons", [])]
            total_lessons = len(all_lessons)
            completed_set = completed_lessons_by_course.get(cid, set())
            completed_count = sum(1 for l in all_lessons if l.get("id") in completed_set)
            
            c["total_lessons"] = total_lessons
            c["completed_lessons"] = completed_count
            c["progress_percentage"] = round((completed_count / total_lessons * 100) if total_lessons > 0 else 0)

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

        streak_days = await _calculate_streak_days(session, user.id)
        metrics = {
            "total_hours": round(total_seconds / 3600, 1),
            "hours_today": round(today_seconds / 3600, 1),
            "streak_days": streak_days,
        }

        # 3. Continue Watching
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
            is_completed = cw_progress.is_completed
            target_lesson_id = cw_progress.lesson_id
            target_progress_sec = cw_progress.progress_seconds
            target_duration_sec = cw_progress.duration_seconds
            
            if matched_course:
                found_mod = None
                found_les_idx = -1
                for mod in matched_course.get("modules", []):
                    lessons = mod.get("lessons", [])
                    for idx, les in enumerate(lessons):
                        if les.get("id") == cw_progress.lesson_id:
                            found_mod = mod
                            found_les_idx = idx
                            module_title = mod.get("title", "Module")
                            lesson_title = les.get("file_name") or les.get("text") or lesson_title
                            break
                    if found_mod:
                        break

                if is_completed and found_mod:
                    lessons = found_mod.get("lessons", [])
                    if found_les_idx + 1 < len(lessons):
                        next_les = lessons[found_les_idx + 1]
                        target_lesson_id = next_les.get("id")
                        lesson_title = next_les.get("file_name") or next_les.get("text") or f"Lecture #{target_lesson_id}"
                        target_progress_sec = 0
                        target_duration_sec = next_les.get("duration", 0)
                        is_completed = False

            continue_watching = {
                "course_id": cw_progress.course_id,
                "lesson_id": target_lesson_id,
                "progress_seconds": target_progress_sec,
                "duration_seconds": target_duration_sec,
                "is_completed": is_completed,
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
