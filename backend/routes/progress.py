from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from database import get_db_session, Progress, Bookmark, User, StudyLog

router = APIRouter()

class ProgressUpdateRequest(BaseModel):
    phone: str
    course_id: str
    lesson_id: int
    progress_seconds: int
    duration_seconds: int
    is_completed: bool
    delta_seconds: int = 0  # time spent watching in this specific chunk

class BookmarkRequest(BaseModel):
    phone: str
    lesson_id: int
    title: str

async def get_user_by_phone(session: AsyncSession, phone: str) -> User:
    result = await session.execute(select(User).filter_by(phone=phone))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@router.post("/update")
async def update_progress(request: ProgressUpdateRequest):
    try:
        async for session in get_db_session():
            user = await get_user_by_phone(session, request.phone)
            
            # 1. Update overall Progress
            result = await session.execute(
                select(Progress).filter_by(
                    user_id=user.id, 
                    course_id=request.course_id, 
                    lesson_id=request.lesson_id
                )
            )
            progress = result.scalars().first()
            
            if progress:
                progress.progress_seconds = request.progress_seconds
                progress.duration_seconds = request.duration_seconds
                progress.is_completed = request.is_completed
                progress.last_watched_at = func.now()
            else:
                progress = Progress(
                    user_id=user.id,
                    course_id=request.course_id,
                    lesson_id=request.lesson_id,
                    progress_seconds=request.progress_seconds,
                    duration_seconds=request.duration_seconds,
                    is_completed=request.is_completed,
                    last_watched_at=func.now()
                )
                session.add(progress)
                
            # 2. Update daily StudyLog
            if request.delta_seconds > 0:
                log_result = await session.execute(
                    select(StudyLog).filter_by(user_id=user.id, date=func.current_date())
                )
                study_log = log_result.scalars().first()
                if study_log:
                    study_log.seconds_studied += request.delta_seconds
                else:
                    study_log = StudyLog(user_id=user.id, seconds_studied=request.delta_seconds)
                    session.add(study_log)
                
            await session.commit()
            return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/summary/{phone}/{course_id}")
async def get_progress_summary(phone: str, course_id: str):
    try:
        async for session in get_db_session():
            user = await get_user_by_phone(session, phone)
            
            result = await session.execute(
                select(Progress).filter_by(user_id=user.id, course_id=course_id)
            )
            progresses = result.scalars().all()
            
            completed_videos = sum(1 for p in progresses if p.is_completed)
            total_watched = sum(p.progress_seconds or 0 for p in progresses)
            total_duration = sum(p.duration_seconds or 0 for p in progresses)
            
            return {
                "completed_videos": completed_videos,
                "total_watched_seconds": total_watched,
                "remaining_seconds": max(0, total_duration - total_watched),
                "progress": [
                    {
                        "lesson_id": p.lesson_id,
                        "progress_seconds": p.progress_seconds,
                        "duration_seconds": p.duration_seconds,
                        "is_completed": p.is_completed
                    } for p in progresses
                ]
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/bookmark")
async def toggle_bookmark(request: BookmarkRequest):
    try:
        async for session in get_db_session():
            user = await get_user_by_phone(session, request.phone)
            
            result = await session.execute(
                select(Bookmark).filter_by(user_id=user.id, lesson_id=request.lesson_id)
            )
            existing = result.scalars().first()
            
            if existing:
                await session.delete(existing)
                await session.commit()
                return {"bookmarked": False}
            else:
                bookmark = Bookmark(user_id=user.id, lesson_id=request.lesson_id, title=request.title)
                session.add(bookmark)
                await session.commit()
                return {"bookmarked": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/bookmarks/{phone}")
async def get_bookmarks(phone: str):
    try:
        async for session in get_db_session():
            user = await get_user_by_phone(session, phone)
            
            result = await session.execute(
                select(Bookmark).filter_by(user_id=user.id)
            )
            bookmarks = result.scalars().all()
            
            return {
                "bookmarks": [
                    {"_id": str(b.id), "lesson_id": b.lesson_id, "title": b.title} 
                    for b in bookmarks
                ]
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/metrics/{phone}")
async def get_metrics(phone: str):
    try:
        async for session in get_db_session():
            user = await get_user_by_phone(session, phone)
            
            # Total Hours
            total_res = await session.execute(
                select(func.sum(StudyLog.seconds_studied)).filter_by(user_id=user.id)
            )
            total_seconds = total_res.scalar() or 0
            
            # Hours Today
            today_res = await session.execute(
                select(func.sum(StudyLog.seconds_studied)).filter_by(user_id=user.id, date=func.current_date())
            )
            today_seconds = today_res.scalar() or 0
            
            # Active Streak
            return {
                "total_hours": round(total_seconds / 3600, 1),
                "hours_today": round(today_seconds / 3600, 1),
                "streak_days": 1 if today_seconds > 0 else 0
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/continue-watching/{phone}")
async def continue_watching(phone: str):
    try:
        async for session in get_db_session():
            user = await get_user_by_phone(session, phone)
            
            result = await session.execute(
                select(Progress)
                .filter_by(user_id=user.id, is_completed=False)
                .order_by(Progress.last_watched_at.desc())
                .limit(1)
            )
            progress = result.scalars().first()
            if not progress:
                result = await session.execute(
                    select(Progress)
                    .filter_by(user_id=user.id)
                    .order_by(Progress.last_watched_at.desc())
                    .limit(1)
                )
                progress = result.scalars().first()
                
            if progress:
                return {
                    "course_id": progress.course_id,
                    "lesson_id": progress.lesson_id,
                    "progress_seconds": progress.progress_seconds,
                    "duration_seconds": progress.duration_seconds
                }
            return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
