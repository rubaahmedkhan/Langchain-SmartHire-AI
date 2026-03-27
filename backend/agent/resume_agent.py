import os
import io
import json
import logging
from pathlib import Path

import pdfplumber
from openai import AsyncOpenAI
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

logger = logging.getLogger(__name__)

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    text = ""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as exc:
        logger.error("Failed to extract text from PDF: %s", exc)
        raise ValueError(f"Could not extract text from PDF: {exc}") from exc
    return text.strip()


async def analyze_resume(
    pdf_bytes: bytes,
    job_title: str,
    job_description: str,
    required_skills: list,
    experience_years: int,
    company_name: str
) -> dict:
    resume_text = extract_text_from_pdf(pdf_bytes)
    if not resume_text:
        raise ValueError("Could not extract text from PDF – the file may be image-only or corrupted.")

    skills_str = ", ".join(required_skills)

    system_prompt = """You are an expert AI recruitment screener. Analyze the resume against the job requirements and return ONLY a valid JSON object — no markdown, no extra text.

JSON structure:
{
  "status": "selected" or "rejected",
  "ats_score": <integer 0-100>,
  "candidate_name": "<full name from resume>",
  "missing_skills": ["skill1", "skill2"],
  "ai_feedback": "<2-3 sentence professional feedback>",
  "skill_recommendations": [
    {
      "skill": "<missing skill>",
      "why_it_matters": "<why this skill is important for the role>",
      "resource_link": "<free learning URL from Coursera/YouTube/freeCodeCamp/official docs>",
      "time_to_learn": "<realistic duration>"
    }
  ]
}

Scoring rules:
- ATS score 0-100 based on: skill match (50%), experience (25%), education (15%), resume quality (10%)
- Select if ats_score >= 70, reject otherwise
- skill_recommendations only for missing skills (empty array if selected with all skills)"""

    user_prompt = f"""JOB: {job_title} at {company_name}
REQUIRED SKILLS: {skills_str}
MIN EXPERIENCE: {experience_years} years
DESCRIPTION: {job_description[:800]}

RESUME:
{resume_text[:3000]}

Analyze and return JSON only."""

    logger.info("Starting resume analysis for: %s at %s", job_title, company_name)

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        max_tokens=1200,
        response_format={"type": "json_object"},
    )

    output = response.choices[0].message.content or "{}"

    try:
        parsed = json.loads(output)
    except json.JSONDecodeError as exc:
        logger.error("Invalid JSON from OpenAI: %s", output[:300])
        raise ValueError(f"Invalid JSON response: {exc}") from exc

    logger.info("Analysis done — status: %s, score: %s", parsed.get("status"), parsed.get("ats_score"))
    return parsed
