# AI Recruitment Automation System — Complete Project Prompt

---

## Project Vision

Build a complete, production-ready, end-to-end AI-powered recruitment automation system.
The system has two sides:
- **HR Side** — HR logs in, writes a job description, saves it, gets a shareable link, and receives email only when a candidate is selected.
- **Candidate Side** — Candidate opens the link, uploads their resume (PDF), and instantly receives an email telling them if they are selected or rejected. If rejected, the same email includes skill recommendations with learning resources. If selected, a congratulations email goes to the candidate AND a separate email goes to HR to schedule the interview.

No human manually reads resumes. Everything is automated by an AI agent.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router, TypeScript) |
| Backend API | Python (FastAPI) |
| AI Agent | OpenAI Agent SDK — refer to `reference.md` for all SDK usage, agent creation, tool definitions, and runner code |
| Database | Supabase (PostgreSQL) |
| File Storage | Supabase Storage Bucket (for resume PDFs) |
| Authentication | Supabase Auth (separate HR and Candidate roles) |
| Email Sending | SMTP using Python `smtplib` + `email.mime` (NOT Gmail MCP, NOT SendGrid) |
| Environment Config | `.env` file at project root |

---

## Environment Variables (`.env`)

```env
OPENAI_API_KEY=your_openai_api_key
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_EMAIL=your_gmail_address@gmail.com
SMTP_PASSWORD=your_gmail_app_password
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

All credentials must be read from `.env`. No hardcoded keys anywhere in the codebase.

---

## Database Schema (Supabase)

### Table: `jobs`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
hr_id           uuid REFERENCES auth.users(id)
title           text NOT NULL
company_name    text NOT NULL
description     text NOT NULL
required_skills text[] NOT NULL
experience_years int DEFAULT 0
created_at      timestamp DEFAULT now()
is_active       boolean DEFAULT true
unique_link     text UNIQUE NOT NULL
```

### Table: `applications`
```sql
id               uuid PRIMARY KEY DEFAULT gen_random_uuid()
job_id           uuid REFERENCES jobs(id)
candidate_name   text NOT NULL
candidate_email  text NOT NULL
resume_url       text NOT NULL
ats_score        int
status           text CHECK (status IN ('pending', 'selected', 'rejected'))
missing_skills   text[]
ai_feedback      text
applied_at       timestamp DEFAULT now()
```

### Table: `hr_profiles`
```sql
id           uuid PRIMARY KEY REFERENCES auth.users(id)
name         text
company_name text
email        text UNIQUE
created_at   timestamp DEFAULT now()
```

---

## Project Folder Structure

```
project-root/
├── frontend/                  # Next.js 14
│   ├── app/
│   │   ├── page.tsx                    # Landing page
│   │   ├── hr/
│   │   │   ├── login/page.tsx          # HR login
│   │   │   ├── dashboard/page.tsx      # HR dashboard — all posted jobs + applicant count
│   │   │   ├── post-job/page.tsx       # HR writes and saves job description
│   │   │   └── job/[id]/page.tsx       # HR sees applicants for a specific job
│   │   └── apply/
│   │       └── [jobId]/page.tsx        # Candidate applies — uploads resume
│   ├── components/
│   └── .env.local
│
├── backend/                   # Python FastAPI
│   ├── main.py                         # FastAPI app entry point
│   ├── routes/
│   │   ├── jobs.py                     # Create job, get job, list jobs
│   │   └── applications.py             # Submit application, trigger AI agent
│   ├── agent/
│   │   ├── resume_agent.py             # OpenAI Agent SDK agent — reads reference.md
│   │   └── tools.py                    # Agent tools: parse_resume, compare_jd, score_resume
│   ├── email_service.py                # SMTP email sending functions
│   ├── supabase_client.py             # Supabase connection
│   ├── .env
│   └── reference.md                   # OpenAI Agent SDK reference (provided by user)
│
└── README.md
```

---

## Feature 1: HR Job Description Portal

### HR Login
- HR signs up / logs in via Supabase Auth
- Role is set to `hr` in metadata

### Post a Job (HR Dashboard)
- HR fills a form with:
  - Job Title
  - Company Name
  - Full Job Description (multi-line text area)
  - Required Skills (comma-separated tags)
  - Minimum Years of Experience
- On submit:
  - Job is saved in `jobs` table in Supabase
  - A unique link is auto-generated: `yourapp.com/apply/{job_uuid}`
  - HR sees the link on screen and can copy it
  - HR can share this link via WhatsApp, email, or post it anywhere

### HR Dashboard
- Shows all jobs HR has posted
- Each job card shows: Job Title, Date Posted, Number of Applicants, Selected Count, Rejected Count
- Clicking a job shows the list of all applicants with their ATS score and status

---

## Feature 2: Candidate Application Portal

### Candidate Opens Link
- `yourapp.com/apply/{jobId}` opens a clean application page
- Page shows the Job Title and Company Name
- Candidate fills:
  - Full Name
  - Email Address
  - Upload Resume (PDF only, max 5MB)
- Clicks "Submit Application"

### What Happens After Submit (Backend Flow)
1. Resume PDF is uploaded to Supabase Storage
2. Application record is created in `applications` table with status `pending`
3. FastAPI calls the **OpenAI Agent** (via Agent SDK — see `reference.md`)
4. Agent analyzes resume vs job description
5. Agent returns: `status`, `ats_score`, `missing_skills`, `ai_feedback`
6. Application record is updated in Supabase
7. Email is sent based on result (see Email section below)

---

## Feature 3: AI Agent (OpenAI Agent SDK)

**IMPORTANT: For all OpenAI Agent SDK code, refer to `reference.md` in the backend folder. Use the exact imports, agent creation pattern, tool definition pattern, and runner pattern shown in `reference.md`. Do not guess or use outdated SDK syntax.**

### Agent Job
The agent receives:
- Full resume text (extracted from PDF using `pdfplumber`)
- Full job description text
- Required skills list
- Minimum experience required

### Agent Tools to Define
```python
# Tool 1: extract_resume_info
# Extracts: candidate name, skills, experience years, education, certifications

# Tool 2: match_skills
# Compares resume skills vs required skills
# Returns: matched_skills[], missing_skills[], match_percentage

# Tool 3: calculate_ats_score
# Scores resume from 0-100 based on:
# - Skill match (50 points)
# - Experience match (25 points)
# - Education relevance (15 points)
# - Resume formatting quality (10 points)

# Tool 4: make_decision
# If ats_score >= 70 → selected
# If ats_score < 70 → rejected
# Returns: status, ats_score, missing_skills, recommendation_message
```

### Agent Decision Threshold
- **ATS Score >= 70** → `selected`
- **ATS Score < 70** → `rejected`

### Skill Recommendations (for rejected candidates)
The agent must generate personalized learning recommendations for each missing skill. For each missing skill, include:
- Skill name
- Why it matters for this job
- A free learning resource (Coursera, freeCodeCamp, W3Schools, YouTube, official docs)
- Estimated time to learn

---

## Feature 4: Email System (SMTP)

Use Python `smtplib` with Gmail SMTP. All email credentials from `.env`. Send HTML emails.

### Email 1: Rejection Email (sent to candidate)
Triggered when: `status = rejected`

**Subject:** `Your Application for [Job Title] at [Company Name] — Update`

**Email Content:**
```
Dear [Candidate Name],

Thank you for applying for the position of [Job Title] at [Company Name].

After carefully reviewing your resume, we regret to inform you that 
you have not been selected for this role at this time.

📊 Your ATS Match Score: [score]/100
Minimum required: 70/100

---

🎯 Skills to Improve — Personalized Recommendations:

1. [Missing Skill 1]
   Why it matters: [reason]
   Learn here: [resource link]
   Time to learn: [duration]

2. [Missing Skill 2]
   Why it matters: [reason]
   Learn here: [resource link]
   Time to learn: [duration]

(repeat for all missing skills)

---

We truly encourage you to upskill and apply again in the future.
Your potential matters to us.

Best regards,
[Company Name] Recruitment Team
```

**Note:** Rejection email and skill recommendations are sent in ONE single email. Do not send two separate emails to the candidate.

### Email 2: Selection Email (sent to candidate)
Triggered when: `status = selected`

**Subject:** `Congratulations! You've Been Selected — [Job Title] at [Company Name] 🎉`

**Email Content:**
```
Dear [Candidate Name],

We are thrilled to inform you that you have been SELECTED 
for the position of [Job Title] at [Company Name]!

📊 Your ATS Match Score: [score]/100 ✅

Our HR team will reach out to you shortly to schedule your interview.

Please keep your phone and email accessible over the next few days.

Congratulations once again — we look forward to meeting you!

Best regards,
[Company Name] Recruitment Team
```

### Email 3: HR Notification Email (sent to HR)
Triggered when: `status = selected` ONLY
**DO NOT send any email to HR when a candidate is rejected.**

**Subject:** `New Selected Candidate — [Job Title] | Schedule Interview`

**Email Content:**
```
Dear HR Team,

A candidate has successfully passed the AI screening for the following position:

📋 Job Title: [Job Title]
👤 Candidate Name: [Candidate Name]
📧 Candidate Email: [Candidate Email]
📊 ATS Score: [score]/100
📅 Applied At: [timestamp]

✅ Action Required: Please schedule an interview with this candidate.

You can view full application details in your HR Dashboard.

Regards,
AI Recruitment System
```

---

## Feature 5: HR Dashboard Details

After logging in, HR sees:
- Total jobs posted
- Total applications received
- Total selected / rejected
- Each job listing with a "View Applicants" button

Applicant table per job shows:
- Candidate Name
- Email
- ATS Score (shown as a colored badge: green >= 70, red < 70)
- Status (Selected / Rejected)
- Applied At timestamp
- Resume download link

---

## Frontend Pages Detail (Next.js)

### Landing Page (`/`)
- Hero section: "AI-Powered Recruitment — Fast, Fair, Automated"
- Two CTA buttons: "I am HR — Post a Job" and "I am a Candidate — Apply Now"
- Brief explanation of how the system works (3 steps for each side)

### HR Login (`/hr/login`)
- Email + Password login using Supabase Auth
- Sign up option for new HR accounts

### HR Post Job (`/hr/post-job`)
- Form: Job Title, Company Name, Description, Required Skills, Experience
- Submit saves to Supabase and shows generated link
- Copy link button

### HR Dashboard (`/hr/dashboard`)
- List of all posted jobs
- Stats per job

### Candidate Apply Page (`/apply/[jobId]`)
- Shows job title and company
- Form: Name, Email, Resume PDF upload
- Submit button with loading state: "Analyzing your resume..."
- After submit: show success message "Your application has been submitted. Check your email for results."

---

## API Endpoints (FastAPI)

```
POST   /api/jobs/create              — HR creates a job
GET    /api/jobs/{job_id}            — Get job details (public, for apply page)
GET    /api/jobs/hr/{hr_id}          — Get all jobs by HR
POST   /api/applications/submit      — Candidate submits application, triggers AI agent
GET    /api/applications/{job_id}    — HR views all applicants for a job
```

---

## Error Handling

- If PDF cannot be parsed → return error "Resume could not be read. Please upload a valid PDF."
- If OpenAI Agent fails → log error, mark application as `pending`, alert HR via email
- If SMTP email fails → log error with candidate email, retry once
- All errors logged to console with timestamps

---

## Security Rules

- HR dashboard routes are protected — redirect to login if not authenticated
- Supabase RLS (Row Level Security) enabled:
  - HR can only see their own jobs and applications
  - Applications table is insert-only for candidates (no read access)
- Resume files in Supabase Storage are private — accessible only via signed URLs

---

## Important Implementation Notes

1. **OpenAI Agent SDK** — Always refer to `reference.md` for correct SDK syntax. The agent must use the exact import style, `Agent`, `Runner`, and tool decorator pattern shown in `reference.md`. Do not use old `openai.ChatCompletion` style.

2. **PDF Parsing** — Use `pdfplumber` library to extract text from uploaded resumes before sending to agent.

3. **SMTP** — Use Gmail App Password (not regular Gmail password). Port 587 with STARTTLS.

4. **One Email Rule** — Rejection + Skill Recommendations = ONE email to candidate. Never split into two emails.

5. **HR Email Rule** — HR notification email is sent ONLY when status is `selected`. Never send HR any email about rejections.

6. **Unique Job Link** — Generate using `str(uuid.uuid4())` and store in `unique_link` column. Candidate apply page URL: `/apply/{unique_link}`.

7. **ATS Score Display** — Show score as colored badge on HR dashboard. Green if >= 70, red if < 70.

8. **Loading State** — When candidate submits, show spinner with message "Our AI is analyzing your resume..." while backend processes.

9. **Supabase Storage** — Store resumes in a private bucket named `resumes`. File path: `{job_id}/{application_id}.pdf`.

10. **Environment** — Never commit `.env` to git. Add `.env` to `.gitignore`.



  uvicorn main:app --reload