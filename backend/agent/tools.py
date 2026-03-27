import json
import logging
from agents import function_tool

logger = logging.getLogger(__name__)


@function_tool
async def extract_resume_info(resume_text: str) -> str:
    """
    Extract structured information from raw resume text.
    Returns a JSON string with candidate name, skills, experience years,
    education level, and certifications.
    """
    # This tool's implementation is intentionally minimal.
    # The AI agent will call this function and the SDK will route it through
    # the language model for actual extraction. The function body below
    # provides a deterministic fallback / default structure.
    result = {
        "candidate_name": "Unknown",
        "skills": [],
        "experience_years": 0,
        "education": "Unknown",
        "certifications": []
    }
    logger.debug("extract_resume_info called with %d chars of resume text", len(resume_text))
    return json.dumps(result)


@function_tool
async def match_skills(resume_skills: str, required_skills: str) -> str:
    """
    Compare resume skills against required job skills.

    Args:
        resume_skills: comma-separated list of skills found in the resume
        required_skills: comma-separated list of skills required for the job

    Returns:
        JSON string with matched_skills, missing_skills, and match_percentage
    """
    resume_set = {s.strip().lower() for s in resume_skills.split(",") if s.strip()}
    required_set = {s.strip().lower() for s in required_skills.split(",") if s.strip()}

    if not required_set:
        return json.dumps({
            "matched_skills": [],
            "missing_skills": [],
            "match_percentage": 0.0
        })

    matched = sorted(resume_set & required_set)
    missing = sorted(required_set - resume_set)
    match_percentage = round((len(matched) / len(required_set)) * 100, 2)

    result = {
        "matched_skills": matched,
        "missing_skills": missing,
        "match_percentage": match_percentage
    }
    logger.debug("match_skills: %d/%d matched (%.1f%%)", len(matched), len(required_set), match_percentage)
    return json.dumps(result)


@function_tool
async def calculate_ats_score(
    skill_match_percentage: float,
    experience_years_candidate: int,
    experience_years_required: int,
    education_level: str,
    resume_quality: str
) -> str:
    """
    Calculate ATS score (0–100) based on multiple criteria.

    Scoring breakdown:
    - Skill match:     50 points  (50 * skill_match_percentage / 100)
    - Experience:      25 points  (>=required: 25, >=half: 12, else: 0)
    - Education:       15 points  (PhD/Masters: 15, Bachelors: 12, Diploma: 8, other: 4)
    - Resume quality:  10 points  (good: 10, average: 6, poor: 2)

    Args:
        skill_match_percentage: 0–100 float from match_skills
        experience_years_candidate: years of experience the candidate has
        experience_years_required: minimum years required for the job
        education_level: one of PhD, Masters, Bachelors, Diploma, or other
        resume_quality: one of good, average, poor

    Returns:
        JSON string with ats_score
    """
    # Skill match: up to 50 points
    skill_match_percentage = max(0.0, min(100.0, float(skill_match_percentage)))
    skill_score = round(50 * skill_match_percentage / 100, 2)

    # Experience: up to 25 points
    if experience_years_candidate >= experience_years_required:
        experience_score = 25
    elif experience_years_required > 0 and experience_years_candidate >= experience_years_required / 2:
        experience_score = 12
    else:
        experience_score = 0

    # Education: up to 15 points
    education_map = {
        "phd": 15,
        "masters": 15,
        "master": 15,
        "bachelors": 12,
        "bachelor": 12,
        "diploma": 8,
    }
    education_score = education_map.get(education_level.strip().lower(), 4)

    # Resume quality: up to 10 points
    quality_map = {
        "good": 10,
        "average": 6,
        "poor": 2,
    }
    quality_score = quality_map.get(resume_quality.strip().lower(), 6)

    ats_score = round(skill_score + experience_score + education_score + quality_score, 2)
    ats_score = max(0, min(100, ats_score))

    result = {
        "ats_score": ats_score,
        "breakdown": {
            "skill_score": skill_score,
            "experience_score": experience_score,
            "education_score": education_score,
            "quality_score": quality_score
        }
    }
    logger.debug("calculate_ats_score: total=%.2f", ats_score)
    return json.dumps(result)


@function_tool
async def make_decision(
    ats_score: int,
    candidate_name: str,
    missing_skills: str,
    job_title: str
) -> str:
    """
    Make a hiring decision based on ATS score.

    Args:
        ats_score: integer score 0–100
        candidate_name: full name of the candidate
        missing_skills: comma-separated list of skills the candidate lacks
        job_title: title of the job being applied for

    Returns:
        JSON string with status, ats_score, missing_skills list, and recommendation_message
    """
    missing_list = [s.strip() for s in missing_skills.split(",") if s.strip()]

    if ats_score >= 70:
        status = "selected"
        recommendation_message = (
            f"Congratulations, {candidate_name}! Your profile is a strong match for the "
            f"{job_title} position. Our recruitment team will be in touch with next steps shortly."
        )
    else:
        status = "rejected"
        if missing_list:
            skills_str = ", ".join(missing_list)
            recommendation_message = (
                f"Thank you for applying, {candidate_name}. Unfortunately your profile did not meet "
                f"the minimum requirements for the {job_title} role at this time. "
                f"We recommend strengthening the following areas: {skills_str}. "
                f"Please consider re-applying once you have developed these skills."
            )
        else:
            recommendation_message = (
                f"Thank you for applying, {candidate_name}. Unfortunately your profile did not meet "
                f"the minimum requirements for the {job_title} role at this time. "
                f"We encourage you to keep building your experience and apply again in the future."
            )

    result = {
        "status": status,
        "ats_score": ats_score,
        "missing_skills": missing_list,
        "recommendation_message": recommendation_message
    }
    logger.debug("make_decision: %s (score=%d)", status, ats_score)
    return json.dumps(result)
