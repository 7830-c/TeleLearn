import asyncio
from telethon import TelegramClient
from telethon.network import MTProtoSender
from telethon.tl.functions.users import GetUsersRequest
import os
from dotenv import load_dotenv

load_dotenv("d:/Projects/TeleLearn/backend/.env")
API_ID = int(os.environ.get("TELEGRAM_API_ID", "34979954"))
API_HASH = os.environ.get("TELEGRAM_API_HASH", "55a2f5c696725c26d9b2373e7c1ba1ad")

async def main():
    client = TelegramClient("test_sess3", API_ID, API_HASH)
    await client.start()
    
    dc_id = client.session.dc_id
    dc = await client._get_dc(dc_id)
    print("Main client connected to DC", dc_id)
    
    # Try to open a parallel sender using the same auth_key
    sender = MTProtoSender(client.session.auth_key, loggers=client._log)
    conn = client._connection(
        dc.ip_address, 
        dc.port, 
        dc.id, 
        loggers=client._log, 
        proxy=client._proxy
    )
    await sender.connect(conn)
    print("Parallel sender connected")
    
    # Try to make a request to verify it's authorized
    try:
        res = await sender.send(GetUsersRequest(id=['me']))
        print("Request succeeded!", res)
    except Exception as e:
        print("Request failed:", e)
        
    await sender.disconnect()
    await client.disconnect()

asyncio.run(main())
