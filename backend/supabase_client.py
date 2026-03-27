from supabase import create_client, Client
from dotenv import load_dotenv
from pathlib import Path
import os

env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
