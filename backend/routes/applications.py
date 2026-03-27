import uuid
import logging
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from supabase_client import supabase
from email_service import (
    send_selection_email,
    send_rejection_email,
    send_hr_notification_email,
)
from agent.resume_agent import analyze_resume

router = APIRouter()
logger = logging.getLogger(__name__)

RESUME_BUCKET = "resumes"
MAX_FILE_SIZE = 5 * 1024 * 1024   # 5 MB
MIN_TEXT_LENGTH = 50               # minimum readable characters in PDF
AI_TIMEOUT_SECONDS = 60            # max wait for OpenAI


def _utcnow_str() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/submit")
async def submit_application(
    job_id: str = Form(...),
    candidate_name: str = Form(...),
    candidate_email: str = Form(...),
    resume: UploadFile = File(...)
):
    # ── 1. Validate inputs ────────────────────────────────────────────────────
    candidate_name = candidate_name.strip()
    candidate_email = candidate_email.strip().lower()

    if not candidate_name:
        raise HTTPException(status_code=400, detail="Candidate name is required.")
    if not candidate_email or "@" not in candidate_email:
        raise HTTPException(status_code=400, detail="Valid email address is required.")

    # File type check
    content_type = resume.content_type or ""
    filename = resume.filename or ""
    if content_type not in ("application/pdf",) and not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    # Read file
    try:
        pdf_bytes = await resume.read()
    except Exception as exc:
        logger.error("Failed to read uploaded file: %s", exc)
        raise HTTPException(status_code=400, detail="Could not read the uploaded file.")

    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(pdf_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds 5 MB limit.")

    # ── 2. Verify job exists and is active ────────────────────────────────────
    try:
        job_response = supabase.table("jobs").select("*").eq("id", job_id).execute()
        if not job_response.data:
            raise HTTPException(status_code=404, detail="Job posting not found or link is invalid.")
        job = job_response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to fetch job %s: %s", job_id, exc)
        raise HTTPException(status_code=500, detail="Could not verify job posting.")

    if not job.get("is_active", True):
        raise HTTPException(status_code=410, detail="This job posting is no longer accepting applications.")

    # ── 3. Duplicate application check ───────────────────────────────────────
    try:
        dup = (
            supabase.table("applications")
            .select("id")
            .eq("job_id", job_id)
            .eq("candidate_email", candidate_email)
            .execute()
        )
        if dup.data:
            raise HTTPException(
                status_code=409,
                detail="You have already applied for this position. Check your email for the result."
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Duplicate check failed (continuing): %s", exc)

    job_title       = job.get("title", "Unknown Position")
    company_name    = job.get("company_name", "Our Company")
    required_skills = job.get("required_skills", [])
    experience_years= job.get("experience_years", 0)
    job_description = job.get("description", "")
    hr_email        = job.get("hr_email")

    # ── 4. Upload PDF to storage ──────────────────────────────────────────────
    application_id = str(uuid.uuid4())
    applied_at     = _utcnow_str()
    storage_path   = f"{job_id}/{application_id}.pdf"
    resume_url     = None

    try:
        supabase.storage.from_(RESUME_BUCKET).upload(
            path=storage_path,
            file=pdf_bytes,
            file_options={"content-type": "application/pdf"}
        )
        resume_url = supabase.storage.from_(RESUME_BUCKET).get_public_url(storage_path)
    except Exception as exc:
        logger.warning("Resume storage upload failed (continuing): %s", exc)

    # ── 5. Save initial record ────────────────────────────────────────────────
    try:
        insert_resp = supabase.table("applications").insert({
            "id":              application_id,
            "job_id":          job_id,
            "candidate_name":  candidate_name,
            "candidate_email": candidate_email,
            "resume_url":      resume_url,
            "status":          "pending",
            "ats_score":       None,
            "missing_skills":  [],
            "ai_feedback":     None,
            "applied_at":      applied_at,
        }).execute()
        if not insert_resp.data:
            raise RuntimeError("Insert returned no data")
    except Exception as exc:
        logger.error("Failed to insert application: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save application. Please try again.")

    # ── 6. AI analysis (with timeout) ────────────────────────────────────────
    final_status     = "pending"
    ats_score        = 0
    missing_skills   = []
    ai_feedback      = None
    skill_recs       = []
    ai_result        = None

    try:
        ai_result = await asyncio.wait_for(
            analyze_resume(
                pdf_bytes=pdf_bytes,
                job_title=job_title,
                job_description=job_description,
                required_skills=required_skills,
                experience_years=experience_years,
                company_name=company_name,
            ),
            timeout=AI_TIMEOUT_SECONDS,
        )
        final_status   = ai_result.get("status", "pending")
        ats_score      = int(ai_result.get("ats_score", 0))
        missing_skills = ai_result.get("missing_skills", [])
        ai_feedback    = ai_result.get("ai_feedback", "")
        skill_recs     = ai_result.get("skill_recommendations", [])

    except asyncio.TimeoutError:
        logger.error("AI analysis timed out for application %s", application_id)
        ai_feedback = "Analysis timed out. HR will review manually."
    except ValueError as exc:
        logger.error("PDF/AI error for application %s: %s", application_id, exc)
        ai_feedback = str(exc)
    except Exception as exc:
        logger.error("AI analysis failed for application %s: %s", application_id, exc)

    # ── 7. Update record with results ─────────────────────────────────────────
    try:
        supabase.table("applications").update({
            "status":               final_status,
            "ats_score":            ats_score,
            "missing_skills":       missing_skills,
            "ai_feedback":          ai_feedback,
            "skill_recommendations":skill_recs,
            "updated_at":           _utcnow_str(),
        }).eq("id", application_id).execute()
    except Exception as exc:
        logger.error("Failed to update application %s: %s", application_id, exc)

    # ── 8. Send emails ────────────────────────────────────────────────────────
    if ai_result is not None and final_status in ("selected", "rejected"):
        try:
            if final_status == "selected":
                send_selection_email(
                    candidate_name=candidate_name,
                    candidate_email=candidate_email,
                    job_title=job_title,
                    company_name=company_name,
                    ats_score=ats_score,
                )
                if hr_email:
                    send_hr_notification_email(
                        hr_email=hr_email,
                        candidate_name=candidate_name,
                        candidate_email=candidate_email,
                        job_title=job_title,
                        company_name=company_name,
                        ats_score=ats_score,
                        applied_at=applied_at,
                    )
            else:
                send_rejection_email(
                    candidate_name=candidate_name,
                    candidate_email=candidate_email,
                    job_title=job_title,
                    company_name=company_name,
                    ats_score=ats_score,
                    missing_skills_with_recommendations=skill_recs,
                )
        except Exception as exc:
            logger.error("Email failed for application %s: %s", application_id, exc)

    logger.info("Application %s processed: status=%s ats=%s", application_id, final_status, ats_score)

    return {
        "success":        True,
        "application_id": application_id,
        "status":         final_status,
        "ats_score":      ats_score,
        "candidate_name": candidate_name,
        "missing_skills": missing_skills,
        "ai_feedback":    ai_feedback,
        "skill_recommendations": skill_recs,
    }


@router.get("/{job_id}")
async def get_applications(job_id: str):
    try:
        response = (
            supabase.table("applications")
            .select("*")
            .eq("job_id", job_id)
            .order("applied_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.error("Failed to fetch applications for job %s: %s", job_id, exc)
        raise HTTPException(status_code=500, detail="Failed to retrieve applications.")

    return {
        "success":      True,
        "job_id":       job_id,
        "applications": response.data or [],
        "total":        len(response.data or []),
    }
