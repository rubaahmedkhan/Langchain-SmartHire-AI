import smtplib
import logging
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dotenv import load_dotenv
from pathlib import Path

# Load .env from parent directory
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_EMAIL = os.getenv("SMTP_EMAIL")
SMTP_APP_PASSWORD = os.getenv("SMTP_APP_PASSWORD")

logger = logging.getLogger(__name__)


def _send_email(to_email: str, subject: str, html_body: str) -> bool:
    """Core email sending function with one retry on failure."""
    for attempt in range(2):
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = SMTP_EMAIL
            msg["To"] = to_email

            part = MIMEText(html_body, "html")
            msg.attach(part)

            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.ehlo()
                server.starttls()
                server.login(SMTP_EMAIL, SMTP_APP_PASSWORD)
                server.sendmail(SMTP_EMAIL, to_email, msg.as_string())

            logger.info(f"Email sent successfully to {to_email} | Subject: {subject}")
            return True

        except smtplib.SMTPException as e:
            logger.error(f"SMTP error on attempt {attempt + 1} sending to {to_email}: {e}")
            if attempt == 1:
                return False
        except Exception as e:
            logger.error(f"Unexpected error on attempt {attempt + 1} sending to {to_email}: {e}")
            if attempt == 1:
                return False

    return False


def send_rejection_email(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    company_name: str,
    ats_score: float,
    missing_skills_with_recommendations: list
) -> bool:
    """
    Send HTML rejection email to candidate with skill recommendations.

    missing_skills_with_recommendations: list of dicts with keys:
        skill, why_it_matters, resource_link, time_to_learn
    """
    subject = f"Your Application for {job_title} at {company_name} – Update"

    # Build skill recommendations rows
    skills_rows_html = ""
    if missing_skills_with_recommendations:
        for item in missing_skills_with_recommendations:
            skill = item.get("skill", "")
            why = item.get("why_it_matters", "")
            link = item.get("resource_link", "#")
            time_to_learn = item.get("time_to_learn", "")
            skills_rows_html += f"""
            <tr>
                <td style="padding:10px 12px; border-bottom:1px solid #f0f0f0; color:#333; font-weight:600;">{skill}</td>
                <td style="padding:10px 12px; border-bottom:1px solid #f0f0f0; color:#555;">{why}</td>
                <td style="padding:10px 12px; border-bottom:1px solid #f0f0f0;">
                    <a href="{link}" style="color:#4F46E5; text-decoration:none; font-weight:500;">Learn Now &rarr;</a>
                </td>
                <td style="padding:10px 12px; border-bottom:1px solid #f0f0f0; color:#888; text-align:center;">{time_to_learn}</td>
            </tr>"""

    skills_table_html = ""
    if skills_rows_html:
        skills_table_html = f"""
        <div style="margin-top:28px;">
            <h3 style="font-size:16px; color:#1a1a2e; margin-bottom:12px; font-weight:700;">
                Recommended Skills to Strengthen Your Profile
            </h3>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; background:#fafafa; border-radius:8px; overflow:hidden;">
                <thead>
                    <tr style="background:#4F46E5;">
                        <th style="padding:10px 12px; color:#fff; text-align:left; font-size:13px;">Skill</th>
                        <th style="padding:10px 12px; color:#fff; text-align:left; font-size:13px;">Why It Matters</th>
                        <th style="padding:10px 12px; color:#fff; text-align:left; font-size:13px;">Resource</th>
                        <th style="padding:10px 12px; color:#fff; text-align:center; font-size:13px;">Time to Learn</th>
                    </tr>
                </thead>
                <tbody>
                    {skills_rows_html}
                </tbody>
            </table>
        </div>"""

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Application Update</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6fb; font-family:'Segoe UI', Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6fb; padding:40px 0;">
        <tr>
            <td align="center">
                <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">

                    <!-- Header -->
                    <tr>
                        <td style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:36px 40px; text-align:center;">
                            <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:700; letter-spacing:0.5px;">
                                {company_name}
                            </h1>
                            <p style="margin:8px 0 0; color:rgba(255,255,255,0.85); font-size:14px;">Recruitment Team</p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding:40px;">

                            <p style="font-size:16px; color:#333; margin:0 0 16px;">Dear <strong>{candidate_name}</strong>,</p>

                            <p style="font-size:15px; color:#555; line-height:1.7; margin:0 0 16px;">
                                Thank you for taking the time to apply for the <strong>{job_title}</strong> position at <strong>{company_name}</strong>.
                                We appreciate your interest and the effort you put into your application.
                            </p>

                            <p style="font-size:15px; color:#555; line-height:1.7; margin:0 0 24px;">
                                After a thorough review of your resume using our AI-powered screening system, we regret to inform you that
                                we will not be moving forward with your application at this time. This decision was based on the current
                                requirements of the role and the match with your profile.
                            </p>

                            <!-- ATS Score Badge -->
                            <div style="background:#fef3f2; border:1px solid #fecaca; border-radius:10px; padding:20px 24px; margin-bottom:24px; text-align:center;">
                                <p style="margin:0 0 6px; font-size:13px; color:#888; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Your ATS Match Score</p>
                                <p style="margin:0; font-size:42px; font-weight:800; color:#e53e3e;">{int(ats_score)}<span style="font-size:20px; font-weight:500; color:#999;">/ 100</span></p>
                                <p style="margin:6px 0 0; font-size:13px; color:#999;">A score of 70 or above is required to proceed</p>
                            </div>

                            {skills_table_html}

                            <p style="font-size:15px; color:#555; line-height:1.7; margin:28px 0 16px;">
                                We strongly encourage you to work on the skills listed above and apply again in the future.
                                Many of these resources are completely free and can significantly boost your chances.
                            </p>

                            <p style="font-size:15px; color:#555; line-height:1.7; margin:0 0 32px;">
                                We wish you all the best in your career journey and hope to see your application again in the future.
                            </p>

                            <p style="font-size:15px; color:#333; margin:0;">
                                Warm regards,<br>
                                <strong>The Recruitment Team</strong><br>
                                <span style="color:#888; font-size:13px;">{company_name}</span>
                            </p>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background:#f8f9fc; padding:20px 40px; text-align:center; border-top:1px solid #eee;">
                            <p style="margin:0; font-size:12px; color:#aaa;">
                                This is an automated message from the {company_name} recruitment system.<br>
                                Please do not reply directly to this email.
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>"""

    return _send_email(candidate_email, subject, html_body)


def send_selection_email(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    company_name: str,
    ats_score: float
) -> bool:
    """Send HTML congratulations email to selected candidate."""
    subject = f"Congratulations! You've Been Selected – {job_title} at {company_name}"

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Congratulations!</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6fb; font-family:'Segoe UI', Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6fb; padding:40px 0;">
        <tr>
            <td align="center">
                <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">

                    <!-- Header -->
                    <tr>
                        <td style="background:linear-gradient(135deg, #11998e 0%, #38ef7d 100%); padding:36px 40px; text-align:center;">
                            <div style="font-size:48px; margin-bottom:12px;">&#127881;</div>
                            <h1 style="margin:0; color:#ffffff; font-size:26px; font-weight:700; letter-spacing:0.5px;">
                                Congratulations!
                            </h1>
                            <p style="margin:8px 0 0; color:rgba(255,255,255,0.9); font-size:15px;">You have been selected!</p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding:40px;">

                            <p style="font-size:16px; color:#333; margin:0 0 16px;">Dear <strong>{candidate_name}</strong>,</p>

                            <p style="font-size:15px; color:#555; line-height:1.7; margin:0 0 16px;">
                                We are thrilled to inform you that after a comprehensive review of your application for the
                                <strong>{job_title}</strong> position at <strong>{company_name}</strong>, you have been
                                <strong style="color:#11998e;">selected to move forward</strong> in our recruitment process!
                            </p>

                            <p style="font-size:15px; color:#555; line-height:1.7; margin:0 0 24px;">
                                Your profile demonstrated an excellent match with the requirements of the role, and our team
                                is very impressed with your qualifications and experience.
                            </p>

                            <!-- ATS Score Badge -->
                            <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:10px; padding:20px 24px; margin-bottom:28px; text-align:center;">
                                <p style="margin:0 0 6px; font-size:13px; color:#888; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Your ATS Match Score</p>
                                <p style="margin:0; font-size:42px; font-weight:800; color:#16a34a;">{int(ats_score)}<span style="font-size:20px; font-weight:500; color:#999;">/ 100</span></p>
                                <p style="margin:6px 0 0; font-size:13px; color:#888;">Outstanding match with our requirements</p>
                            </div>

                            <!-- Next Steps -->
                            <div style="background:#f8f9fc; border-left:4px solid #11998e; border-radius:0 8px 8px 0; padding:20px 24px; margin-bottom:28px;">
                                <h3 style="margin:0 0 12px; font-size:15px; color:#1a1a2e; font-weight:700;">What Happens Next?</h3>
                                <ul style="margin:0; padding-left:20px; color:#555; font-size:14px; line-height:2;">
                                    <li>Our HR team will review your application in detail</li>
                                    <li>You will be contacted within <strong>2–3 business days</strong> to schedule an interview</li>
                                    <li>Please ensure your contact details are up to date</li>
                                    <li>Feel free to prepare by researching <strong>{company_name}</strong></li>
                                </ul>
                            </div>

                            <p style="font-size:15px; color:#555; line-height:1.7; margin:0 0 32px;">
                                We are excited about the possibility of you joining our team. If you have any questions
                                in the meantime, please do not hesitate to reach out.
                            </p>

                            <p style="font-size:15px; color:#333; margin:0;">
                                Best regards,<br>
                                <strong>The Recruitment Team</strong><br>
                                <span style="color:#888; font-size:13px;">{company_name}</span>
                            </p>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background:#f8f9fc; padding:20px 40px; text-align:center; border-top:1px solid #eee;">
                            <p style="margin:0; font-size:12px; color:#aaa;">
                                This is an automated message from the {company_name} recruitment system.<br>
                                Please do not reply directly to this email.
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>"""

    return _send_email(candidate_email, subject, html_body)


def send_hr_notification_email(
    hr_email: str,
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    company_name: str,
    ats_score: float,
    applied_at: str
) -> bool:
    """Send HR notification email when a candidate applies."""
    subject = f"New Application Received – {job_title} | ATS Score: {int(ats_score)}"

    score_color = "#16a34a" if ats_score >= 70 else "#e53e3e"
    status_label = "SELECTED" if ats_score >= 70 else "REJECTED"
    status_bg = "#f0fdf4" if ats_score >= 70 else "#fef3f2"
    status_border = "#86efac" if ats_score >= 70 else "#fecaca"

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Application Notification</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6fb; font-family:'Segoe UI', Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6fb; padding:40px 0;">
        <tr>
            <td align="center">
                <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">

                    <!-- Header -->
                    <tr>
                        <td style="background:linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding:30px 40px; text-align:center;">
                            <h1 style="margin:0; color:#ffffff; font-size:20px; font-weight:700; letter-spacing:0.5px;">
                                &#128203; New Application Alert
                            </h1>
                            <p style="margin:8px 0 0; color:rgba(255,255,255,0.7); font-size:13px;">{company_name} – HR Dashboard</p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding:36px 40px;">

                            <p style="font-size:15px; color:#555; margin:0 0 24px;">
                                A new candidate has submitted their application and has been automatically screened by the AI recruitment system.
                            </p>

                            <!-- Candidate Details Card -->
                            <div style="background:#f8f9fc; border-radius:10px; padding:24px; margin-bottom:24px;">
                                <h3 style="margin:0 0 16px; font-size:15px; color:#1a1a2e; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">
                                    Candidate Details
                                </h3>
                                <table width="100%" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td style="padding:8px 0; font-size:14px; color:#888; width:160px;">Full Name</td>
                                        <td style="padding:8px 0; font-size:14px; color:#333; font-weight:600;">{candidate_name}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:8px 0; font-size:14px; color:#888;">Email Address</td>
                                        <td style="padding:8px 0; font-size:14px;">
                                            <a href="mailto:{candidate_email}" style="color:#4F46E5; text-decoration:none;">{candidate_email}</a>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding:8px 0; font-size:14px; color:#888;">Applied For</td>
                                        <td style="padding:8px 0; font-size:14px; color:#333; font-weight:600;">{job_title}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:8px 0; font-size:14px; color:#888;">Applied At</td>
                                        <td style="padding:8px 0; font-size:14px; color:#333;">{applied_at}</td>
                                    </tr>
                                </table>
                            </div>

                            <!-- ATS Score and Status -->
                            <div style="display:flex; gap:16px; margin-bottom:24px;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td width="48%" style="vertical-align:top; padding-right:8px;">
                                            <div style="background:#f8f9fc; border-radius:10px; padding:20px; text-align:center;">
                                                <p style="margin:0 0 6px; font-size:12px; color:#888; text-transform:uppercase; letter-spacing:1px; font-weight:600;">ATS Score</p>
                                                <p style="margin:0; font-size:38px; font-weight:800; color:{score_color};">{int(ats_score)}<span style="font-size:16px; font-weight:400; color:#999;">/100</span></p>
                                            </div>
                                        </td>
                                        <td width="4%"></td>
                                        <td width="48%" style="vertical-align:top; padding-left:8px;">
                                            <div style="background:{status_bg}; border:1px solid {status_border}; border-radius:10px; padding:20px; text-align:center;">
                                                <p style="margin:0 0 6px; font-size:12px; color:#888; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Decision</p>
                                                <p style="margin:0; font-size:22px; font-weight:800; color:{score_color};">{status_label}</p>
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <p style="font-size:14px; color:#888; line-height:1.6; margin:0 0 0;">
                                The candidate has been automatically notified via email. Please log in to your HR dashboard to view the full AI analysis report, including matched skills, missing skills, and detailed feedback.
                            </p>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background:#f8f9fc; padding:20px 40px; text-align:center; border-top:1px solid #eee;">
                            <p style="margin:0; font-size:12px; color:#aaa;">
                                This notification was generated automatically by the {company_name} AI Recruitment System.<br>
                                Please do not reply to this email.
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>"""

    return _send_email(hr_email, subject, html_body)
