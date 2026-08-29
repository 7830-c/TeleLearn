import os
import asyncio
import urllib.parse
from telethon import TelegramClient
from telethon.sessions import StringSession, SQLiteSession
from database import get_db_session, User
from sqlalchemy.future import select
from security import encrypt_session, decrypt_session
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(env_path)

API_ID = int(os.environ.get("TELEGRAM_API_ID", "34979954"))
API_HASH = os.environ.get("TELEGRAM_API_HASH", "55a2f5c696725c26d9b2373e7c1ba1ad")

SESSION_DIR = os.path.join(os.path.dirname(__file__), "sessions")
os.makedirs(SESSION_DIR, exist_ok=True)

clients: dict[str, TelegramClient] = {}
_client_lock = asyncio.Lock()


def normalize_phone(phone: str) -> str:
    """Normalize phone number to handle +, %2B, spaces, dashes."""
    phone = urllib.parse.unquote(phone).strip()
    phone = phone.replace(" ", "").replace("-", "")
    if not phone.startswith("+"):
        phone = "+" + phone
    return phone


async def _get_session_string(clean_phone: str) -> str:
    """
    Read session string from PostgreSQL Database User table.
    """
    try:
        async with get_db_session() as session:
            result = await session.execute(select(User).filter_by(phone=clean_phone))
            user = result.scalars().first()
            if user and user.session_string:
                return decrypt_session(user.session_string)
    except Exception as e:
        print(f"[telegram_client] DB read error: {e}")
            
    # Check for legacy .sessionstring file and migrate
    string_file = os.path.join(SESSION_DIR, f"{clean_phone}.sessionstring")
    if os.path.exists(string_file):
        with open(string_file, "r", encoding="utf-8") as f:
            return f.read().strip()
            
    return ""


async def save_session_string(clean_phone: str, session_str: str):
    """Save StringSession to PostgreSQL Database."""
    encrypted_str = encrypt_session(session_str)
    
    async with get_db_session() as session:
        result = await session.execute(select(User).filter_by(phone=clean_phone))
        user = result.scalars().first()
        
        if user:
            user.session_string = encrypted_str
        else:
            user = User(phone=clean_phone, session_string=encrypted_str)
            session.add(user)
            
        await session.commit()


async def get_client(phone: str) -> TelegramClient:
    """
    Gets or creates a singleton TelegramClient for the given phone number.
    Uses StringSession to completely eliminate SQLite file locks.
    """
    clean_phone = normalize_phone(phone)

    async with _client_lock:
        if clean_phone in clients:
            client = clients[clean_phone]
            try:
                if not client.is_connected():
                    await asyncio.wait_for(client.connect(), timeout=8.0)
                return client
            except Exception as e:
                print(f"[telegram_client] Reconnecting due to error: {e}")
                # Fall through to recreate

        session_str = await _get_session_string(clean_phone)
        session = StringSession(session_str)
        client = TelegramClient(session, API_ID, API_HASH)
        try:
            await asyncio.wait_for(client.connect(), timeout=8.0)
            if session_str and not await client.is_user_authorized():
                print(f"[telegram_client] Stale un-authorized session for {clean_phone}. Resetting...")
                await clear_client(clean_phone)
                session = StringSession("")
                client = TelegramClient(session, API_ID, API_HASH)
                await asyncio.wait_for(client.connect(), timeout=8.0)
        except Exception as e:
            err_msg = str(e)
            if any(term in err_msg for term in [
                "AuthKeyDuplicatedError",
                "AuthKeyUnregisteredError",
                "The key is not registered",
                "two different IP addresses",
                "SecurityError",
                "Key was already used",
                "SessionRevokedError",
                "UserDeactivatedError"
            ]):
                print(f"[telegram_client] Resetting invalid/unregistered session for {clean_phone} due to: {e}")
                await clear_client(clean_phone)
                session = StringSession("")
                client = TelegramClient(session, API_ID, API_HASH)
                await asyncio.wait_for(client.connect(), timeout=8.0)
            else:
                raise e

        clients[clean_phone] = client
        return client


async def get_authorized_client(phone: str) -> TelegramClient:
    """
    Returns an active, authorized TelegramClient.
    If the session is revoked or unauthenticated, immediately cleans up and raises HTTP 401.
    """
    from fastapi import HTTPException
    clean_phone = normalize_phone(phone)
    try:
        client = await get_client(clean_phone)
        if not await client.is_user_authorized():
            await clear_client(clean_phone)
            raise HTTPException(
                status_code=401,
                detail="Telegram session is expired or logged in elsewhere. Please log in again."
            )
        return client
    except HTTPException:
        raise
    except Exception as e:
        err_msg = str(e)
        if any(term in err_msg for term in [
            "AuthKeyDuplicatedError",
            "AuthKeyUnregisteredError",
            "The key is not registered",
            "two different IP addresses",
            "SecurityError",
            "Key was already used",
            "SessionRevokedError",
            "UserDeactivatedError",
            "Unauthorized"
        ]):
            await clear_client(clean_phone)
            raise HTTPException(
                status_code=401,
                detail="Telegram session was revoked by Telegram security. Please log in again."
            )
        raise


async def clear_client(phone: str):
    """Force remove a client from cache and clear stored invalid session string."""
    clean_phone = normalize_phone(phone)
    async with _client_lock:
        if clean_phone in clients:
            try:
                await clients[clean_phone].disconnect()
            except:
                pass
            del clients[clean_phone]
        try:
            await save_session_string(clean_phone, "")
        except Exception as e:
            print(f"[telegram_client] Error clearing DB session string: {e}")

