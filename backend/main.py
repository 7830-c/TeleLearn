import os
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import auth, courses, progress, dashboard
from database import init_db, engine
from routes.courses import _clean_cache_directory

app = FastAPI(title="TeleLearn API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def _periodic_cache_cleanup():
    """Background loop: automatically purges expired/excess server cache every hour."""
    while True:
        try:
            _clean_cache_directory(max_size_mb=10, max_age_hours=24)
        except Exception as e:
            print(f"[cache_cleanup_task] {e}")
        await asyncio.sleep(3600)  # Every 1 hour

@app.on_event("startup")
async def startup_db_client():
    await init_db()
    _clean_cache_directory(max_size_mb=10, max_age_hours=24)
    asyncio.create_task(_periodic_cache_cleanup())

@app.on_event("shutdown")
async def shutdown_db_client():
    await engine.dispose()

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(courses.router, prefix="/api/courses", tags=["courses"])
app.include_router(progress.router, prefix="/api/progress", tags=["progress"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])

@app.get("/")
def root():
    return {"message": "Welcome to TeleLearn API"}

@app.get("/health")
@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "telelearn-api"}
