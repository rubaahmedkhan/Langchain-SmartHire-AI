# Case Study: SmartHire AI — Intelligent Resume Screening Platform

---

## Overview

**Project Name:** SmartHire AI
**Type:** Full-Stack AI Web Application
**Role:** Full-Stack Developer (Solo Project)
**Duration:** Personal Project
**Tech Stack:** Next.js 14 · FastAPI · OpenAI GPT-4o-mini · Supabase · Tailwind CSS

---

## Problem Statement

Traditional recruitment processes are slow, expensive, and inconsistent. HR teams at growing companies spend 60–80% of their hiring time manually screening resumes — a task that is:

- **Time-consuming:** A single job posting can receive 200+ applications
- **Inconsistent:** Different reviewers evaluate resumes differently
- **Delayed:** Candidates wait days or weeks for feedback
- **Unscalable:** One HR manager cannot efficiently handle high-volume hiring

The core question was: **Can AI automate the first layer of resume screening while still giving candidates meaningful, personalized feedback?**

---

## Solution

SmartHire AI is an end-to-end recruitment automation platform that enables HR teams to post jobs and instantly screen every incoming resume using AI — with results delivered to candidates via email within minutes.

The platform has two distinct user flows:

**For HR Teams:**
- Register and log in to a secure HR portal
- Create job postings with title, description, required skills, and minimum experience
- Each job gets a unique shareable application link
- View all applicants with their AI scores and feedback on the dashboard

**For Candidates:**
- Open the job link (no account required)
- Submit name, email, and upload resume (PDF)
- AI analyzes the resume instantly
- Receive a detailed result email — selected or rejected — with score and feedback

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js 14)                  │
│  Home Page → HR Login/Signup → Dashboard → Apply Page    │
│                   Tailwind CSS · TypeScript               │
└────────────────────────┬────────────────────────────────┘
                         │ REST API calls
┌────────────────────────▼────────────────────────────────┐
│                   BACKEND (FastAPI)                       │
│   /api/hr/register    /api/jobs/create                   │
│   /api/jobs/{id}      /api/applications/submit           │
└────────┬──────────────────────────┬─────────────────────┘
         │                          │
┌────────▼────────┐      ┌──────────▼──────────────────┐
│ Supabase        │      │  AI Resume Agent             │
│ PostgreSQL DB   │      │  OpenAI GPT-4o-mini          │
│ Auth · Storage  │      │  PDF Extraction (pdfplumber) │
│ (Resume files)  │      │  JSON structured output      │
└─────────────────┘      └──────────┬──────────────────┘
                                     │
                          ┌──────────▼──────────────────┐
                          │  Email Service               │
                          │  Gmail SMTP                  │
                          │  Selection / Rejection Email │
                          └─────────────────────────────┘
```

---

## Key Features Built

### 1. AI Resume Screening Engine
The core of the platform is a custom AI agent (`resume_agent.py`) built with the OpenAI Async API:

- **PDF text extraction** using `pdfplumber` — handles multi-page resumes
- **Structured prompt engineering** — system prompt forces GPT-4o-mini to return strict JSON
- **ATS Scoring Algorithm** (0–100):
  - Skill match: 50%
  - Experience level: 25%
  - Education background: 15%
  - Resume quality/formatting: 10%
- **Auto decision:** Score ≥ 70 → Selected, Score < 70 → Rejected
- **Skill gap analysis** — lists missing skills with free learning resources (Coursera, YouTube, docs) and estimated time to learn
- Temperature set to 0.2 for consistent, deterministic responses

### 2. Unique Apply Links
Each job posting generates a `unique_link` UUID. HR shares this link publicly. Candidates access it without creating an account — reducing friction in the application process.

### 3. Duplicate Prevention
Database-level constraint prevents the same candidate email from applying twice to the same job, maintaining data integrity.

### 4. Instant Email Results
Using Gmail SMTP, candidates receive personalized emails within minutes of applying — including their ATS score, AI feedback, and (if rejected) a list of skill recommendations with learning resources.

### 5. HR Dashboard
A protected Next.js dashboard shows all job postings and applicants per job. HR managers see each candidate's score, status, missing skills, and AI-generated feedback at a glance.

---

## Database Design

**Supabase (PostgreSQL) — 3 core tables:**

| Table | Purpose |
|---|---|
| `hr_users` | Stores HR profiles linked to Supabase Auth |
| `jobs` | Job postings with skills, experience, unique link |
| `applications` | Candidate submissions with AI scores and feedback |

**Supabase Storage:**
A `resumes` bucket stores uploaded PDF files, with URLs saved per application record.

---

## Deployment Architecture

| Layer | Platform |
|---|---|
| Frontend | Vercel (auto-deploy from GitHub) |
| Backend | Hugging Face Spaces (Docker container) |
| Database | Supabase (managed PostgreSQL) |
| Storage | Supabase Storage |

The backend is containerized with Docker and deployed on Hugging Face Spaces, which provides free GPU/CPU hosting for ML-adjacent apps. The frontend on Vercel connects to the FastAPI backend via environment-configured API URL.

---

## Challenges & How I Solved Them

### Challenge 1: Inconsistent AI Output
**Problem:** GPT-4o-mini sometimes returned markdown-wrapped JSON or extra text, breaking JSON parsing.
**Solution:** Used OpenAI's `response_format: {"type": "json_object"}` parameter + strict system prompt instructions to always return raw JSON only.

### Challenge 2: PDF Parsing Failures
**Problem:** Some resumes are image-scanned PDFs with no extractable text.
**Solution:** Implemented error detection — if `pdfplumber` returns empty text, the system raises a clear `ValueError` before calling OpenAI, saving API costs and giving users a clear error message.

### Challenge 3: Candidate UX Without Auth
**Problem:** Requiring candidates to create accounts would reduce application rates.
**Solution:** Designed the apply flow to be completely account-free — candidates only need the job link, name, email, and resume file.

### Challenge 4: CORS & Cross-Origin Requests
**Problem:** Next.js frontend and FastAPI backend run on different origins.
**Solution:** Configured FastAPI CORS middleware to allow requests from the Vercel frontend domain in production.

---

## Results & Impact

- **Automated screening** replaces hours of manual resume review with seconds
- **Consistent scoring** eliminates human bias in initial screening
- **Instant feedback loop** — candidates know their status in minutes, not weeks
- **Scalable** — the same system handles 5 or 500 applications with identical speed
- **Actionable rejections** — rejected candidates receive specific skill gaps and free learning resources, turning a negative experience into a growth opportunity

---

## What I Learned

1. **Prompt Engineering at Scale** — Designing prompts that produce reliable, parseable structured output requires careful iteration. Small wording changes can cause large output format differences.

2. **Async Python** — Building with `AsyncOpenAI` and FastAPI's async request handling allowed the AI analysis to run without blocking other requests.

3. **Full-Stack Integration** — Coordinating authentication state between Next.js SSR, Supabase Auth, and a separate FastAPI backend required careful token handling and API design.

4. **User-Centric Design** — Removing the candidate account requirement was a deliberate UX decision that dramatically reduces friction in the application flow.

---

## Tech Stack Summary

| Category | Technology |
|---|---|
| Frontend Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Language (Frontend) | TypeScript |
| Backend Framework | FastAPI (Python) |
| AI Model | OpenAI GPT-4o-mini |
| PDF Parsing | pdfplumber |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| File Storage | Supabase Storage |
| Email | Gmail SMTP |
| Containerization | Docker |
| Frontend Deployment | Vercel |
| Backend Deployment | Hugging Face Spaces |

---

*SmartHire AI — Automating the first layer of hiring so humans can focus on the last.*
