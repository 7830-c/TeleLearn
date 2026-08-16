import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy import Column, Integer, BigInteger, String, Boolean, ForeignKey, Text, DateTime, Date
from sqlalchemy.sql import func

load_dotenv()

# Ensure DATABASE_URL uses asyncpg (e.g. postgresql+asyncpg://...)
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///telelearn.db")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    pool_pre_ping=True
)

AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    phone = Column(String, unique=True, index=True, nullable=False)
    session_string = Column(Text, nullable=True)

class Course(Base):
    __tablename__ = "courses"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    channel_id = Column(BigInteger, unique=True, index=True, nullable=False)
    title = Column(String, nullable=True)
    data = Column(Text, nullable=True) # Stored as JSON

class Progress(Base):
    __tablename__ = "progress"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    course_id = Column(String, index=True, nullable=False)
    lesson_id = Column(Integer, index=True, nullable=False)
    progress_seconds = Column(Integer, default=0)
    duration_seconds = Column(Integer, default=0)
    is_completed = Column(Boolean, default=False)
    last_watched_at = Column(DateTime, default=func.now(), onupdate=func.now())

class StudyLog(Base):
    __tablename__ = "study_logs"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    date = Column(Date, index=True, nullable=False, default=func.current_date())
    seconds_studied = Column(Integer, default=0)

class Bookmark(Base):
    __tablename__ = "bookmarks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    lesson_id = Column(Integer, nullable=False)
    course_id = Column(String, nullable=True, index=True)
    title = Column(String, nullable=True)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Database schema initialized")

async def get_db_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
