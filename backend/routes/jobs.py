import uuid
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from typing import List

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from supabase_client import supabase

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------
class CreateJobRequest(BaseModel):
    title: str
    company_name: str
    description: str
    required_skills: List[str]
    experience_years: int
    hr_id: str
    hr_email: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/create")
async def create_job(payload: CreateJobRequest):
    """Create a new job posting and return it with a unique application link."""
    unique_link = str(uuid.uuid4())

    job_data = {
        "title": payload.title,
        "company_name": payload.company_name,
        "description": payload.description,
        "required_skills": payload.required_skills,
        "experience_years": payload.experience_years,
        "hr_id": payload.hr_id,
        "hr_email": payload.hr_email,
        "unique_link": unique_link,
        "is_active": True,
    }

    try:
        response = supabase.table("jobs").insert(job_data).execute()
    except Exception as exc:
        logger.error("Failed to create job in Supabase: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create job posting.")

    if not response.data:
        raise HTTPException(status_code=500, detail="Job creation returned no data.")

    created_job = response.data[0]
    logger.info("Job created: id=%s title=%s", created_job.get("id"), payload.title)
    return {
        "success": True,
        "job": created_job,
        "unique_link": unique_link,
        "application_url": f"/apply/{unique_link}"
    }


@router.get("/{job_id}")
async def get_job(job_id: str):
    """Return public job details by unique_link or id."""
    try:
        # First try unique_link (used in apply links)
        response = supabase.table("jobs").select("*").eq("unique_link", job_id).execute()
        if not response.data:
            # Fallback: try by id
            response = supabase.table("jobs").select("*").eq("id", job_id).execute()
    except Exception as exc:
        logger.error("Failed to fetch job %s: %s", job_id, exc)
        raise HTTPException(status_code=500, detail="Failed to retrieve job details.")

    if not response.data:
        raise HTTPException(status_code=404, detail="Job not found.")

    return {"success": True, "job": response.data[0]}


@router.get("/hr/{hr_id}")
async def get_hr_jobs(hr_id: str):
    """Return all jobs posted by a specific HR user, with applicant counts."""
    try:
        jobs_response = (
            supabase.table("jobs")
            .select("*")
            .eq("hr_id", hr_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.error("Failed to fetch jobs for hr_id=%s: %s", hr_id, exc)
        raise HTTPException(status_code=500, detail="Failed to retrieve jobs.")

    jobs = jobs_response.data or []

    # Attach applicant count to each job
    enriched_jobs = []
    for job in jobs:
        job_id = job.get("id")
        try:
            count_response = (
                supabase.table("applications")
                .select("id", count="exact")
                .eq("job_id", job_id)
                .execute()
            )
            applicant_count = count_response.count if count_response.count is not None else 0
        except Exception as exc:
            logger.warning("Could not fetch applicant count for job %s: %s", job_id, exc)
            applicant_count = 0

        enriched_jobs.append({**job, "applicant_count": applicant_count})

    return {"success": True, "jobs": enriched_jobs, "total": len(enriched_jobs)}
