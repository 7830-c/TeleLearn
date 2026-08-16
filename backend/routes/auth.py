from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from telethon.errors import SessionPasswordNeededError, AuthRestartError
from telegram_client import get_client, save_session_string, normalize_phone, clear_client

router = APIRouter()


class SendCodeRequest(BaseModel):
    phone: str


class VerifyCodeRequest(BaseModel):
    phone: str
    code: str
    phone_code_hash: str


class VerifyPasswordRequest(BaseModel):
    phone: str
    password: str


@router.post("/send-code")
async def send_code(request: SendCodeRequest):
    clean_phone = normalize_phone(request.phone)
    try:
        client = await get_client(clean_phone)
        result = await client.send_code_request(clean_phone)
        return {"phone_code_hash": result.phone_code_hash}
    except Exception as e:
        print(f"send_code error: {e}, retrying...")
        await clear_client(clean_phone)
        try:
            client = await get_client(clean_phone)
            result = await client.send_code_request(clean_phone)
            return {"phone_code_hash": result.phone_code_hash}
        except Exception as retry_e:
            raise HTTPException(status_code=400, detail=str(retry_e))


@router.post("/verify-code")
async def verify_code(request: VerifyCodeRequest):
    try:
        clean_phone = normalize_phone(request.phone)
        client = await get_client(clean_phone)
        await client.sign_in(clean_phone, request.code, phone_code_hash=request.phone_code_hash)
        me = await client.get_me()
        # Persist the StringSession
        await save_session_string(clean_phone, client.session.save())
        return {"success": True, "user_id": me.id, "username": me.username}
    except SessionPasswordNeededError:
        return {"success": False, "requires_password": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/verify-password")
async def verify_password(request: VerifyPasswordRequest):
    try:
        clean_phone = normalize_phone(request.phone)
        client = await get_client(clean_phone)
        await client.sign_in(password=request.password)
        me = await client.get_me()
        # Persist the StringSession
        await save_session_string(clean_phone, client.session.save())
        return {"success": True, "user_id": me.id, "username": me.username}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/status")
async def get_status(phone: str):
    try:
        clean_phone = normalize_phone(phone)
        client = await get_client(clean_phone)
        if await client.is_user_authorized():
            me = await client.get_me()
            return {"authenticated": True, "user_id": me.id, "username": me.username}
        return {"authenticated": False}
    except Exception as e:
        return {"authenticated": False, "error": str(e)}
