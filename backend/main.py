import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.jobs import router as jobs_router
from routes.applications import router as applications_router
from routes.hr import router as hr_router

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------
app = FastAPI(
    title="AI Recruitment System",
    description="Automated resume screening and candidate evaluation powered by AI.",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# CORS middleware
# ---------------------------------------------------------------------------
import os
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    os.getenv("FRONTEND_URL", ""),
]
ALLOWED_ORIGINS = [o for o in ALLOWED_ORIGINS if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(jobs_router, prefix="/api/jobs", tags=["jobs"])
app.include_router(applications_router, prefix="/api/applications", tags=["applications"])
app.include_router(hr_router, prefix="/api/hr", tags=["hr"])


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/", tags=["health"])
def root():
    return {"message": "AI Recruitment System API", "status": "running", "version": "1.0.0"}


@app.get("/health", tags=["health"])
def health_check():
    return {"status": "healthy"}
