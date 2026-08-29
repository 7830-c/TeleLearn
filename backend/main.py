import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import auth, courses, progress, dashboard
from database import init_db, engine
from routes.courses import _clean_cache_directory


async def _periodic_cache_cleanup():
    """Background loop: automatically purges expired/excess server cache every hour."""
    while True:
        try:
            _clean_cache_directory(max_size_mb=10, max_age_hours=24)
        except Exception as e:
            print(f"[cache_cleanup_task] {e}")
        await asyncio.sleep(3600)  # Every 1 hour


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    _clean_cache_directory(max_size_mb=10, max_age_hours=24)
    cleanup_task = asyncio.create_task(_periodic_cache_cleanup())
    yield
    # Shutdown
    cleanup_task.cancel()
    await engine.dispose()


app = FastAPI(title="TeleLearn API", lifespan=lifespan)

# CORS: Allow production frontend domains (Render, Vercel) and localhost for development
ALLOWED_ORIGINS = [
    "https://telelearn.onrender.com",
    "https://telelearn-frontend.onrender.com",
    "https://telelearn-backend.onrender.com",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.onrender\.com|https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

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
