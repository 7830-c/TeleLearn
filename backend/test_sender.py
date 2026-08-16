import asyncio
from telethon import TelegramClient
from telethon.network import MTProtoSender
from telethon.crypto import AuthKey
from telethon.tl.functions.auth import ExportAuthorizationRequest, ImportAuthorizationRequest
from dotenv import load_dotenv
import os

load_dotenv("d:/Projects/TeleLearn/backend/.env")
API_ID = int(os.environ.get("TELEGRAM_API_ID", "34979954"))
API_HASH = os.environ.get("TELEGRAM_API_HASH", "55a2f5c696725c26d9b2373e7c1ba1ad")

async def main():
    client = TelegramClient("test_sess", API_ID, API_HASH)
    await client.start()
    
    dc_id = client.session.dc_id
    export = await client(ExportAuthorizationRequest(dc_id))
    dc = await client._get_dc(dc_id)
    
    sender = MTProtoSender(AuthKey(None), loggers=client._log)
    conn = client._connection(dc.ip_address, dc.port, dc.id, loggers=client._log, proxy=client._proxy)
    await sender.connect(conn)
    await sender.send(ImportAuthorizationRequest(id=export.id, bytes=export.bytes))
    print("Successfully connected and imported auth!")
    await sender.disconnect()
    await client.disconnect()

asyncio.run(main())
