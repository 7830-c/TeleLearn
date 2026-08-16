import os
from dotenv import load_dotenv
from cryptography.fernet import Fernet

load_dotenv()

# The key must be 32 url-safe base64-encoded bytes. 
# Generate one with `Fernet.generate_key()` if not provided.
ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    # Fallback for local development if not provided
    ENCRYPTION_KEY = Fernet.generate_key()
    os.environ["ENCRYPTION_KEY"] = ENCRYPTION_KEY.decode("utf-8")
else:
    if isinstance(ENCRYPTION_KEY, str):
        ENCRYPTION_KEY = ENCRYPTION_KEY.encode("utf-8")

fernet = Fernet(ENCRYPTION_KEY)

def encrypt_session(session_string: str) -> str:
    """Encrypts a Telegram session string."""
    if not session_string:
        return ""
    return fernet.encrypt(session_string.encode("utf-8")).decode("utf-8")

def decrypt_session(encrypted_string: str) -> str:
    """Decrypts a Telegram session string."""
    if not encrypted_string:
        return ""
    try:
        return fernet.decrypt(encrypted_string.encode("utf-8")).decode("utf-8")
    except Exception as e:
        print(f"Error decrypting session string: {e}")
        return ""
