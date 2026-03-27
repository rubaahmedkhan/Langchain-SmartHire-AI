import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from supabase_client import supabase

router = APIRouter()
logger = logging.getLogger(__name__)


class HRRegisterRequest(BaseModel):
    id: str
    name: str
    company_name: str
    email: EmailStr


@router.post("/register")
async def register_hr(payload: HRRegisterRequest):
    """Save HR user profile to hr_users table after Supabase Auth signup."""
    try:
        response = supabase.table("hr_users").upsert({
            "id": payload.id,
            "name": payload.name,
            "company_name": payload.company_name,
            "email": payload.email,
        }).execute()
    except Exception as exc:
        logger.error("Failed to insert HR user: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save HR profile.")

    logger.info("HR user registered: id=%s email=%s", payload.id, payload.email)
    return {"success": True, "user_id": payload.id}
