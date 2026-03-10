import os

# ── GCP ───────────────────────────────────────────────────────────────────
GCP_PROJECT   = os.environ.get("GCP_PROJECT",       "tag-file-manager")
GCP_LOCATION  = os.environ.get("GCP_LOCATION",      "us-central1")
GCP_LOCATION2 = os.environ.get("GCP_LOCATION2",     "global")
GCS_BUCKET    = os.environ.get("GCS_BUCKET",        "aria-media-bucket")
TASKS_QUEUE   = os.environ.get("CLOUD_TASKS_QUEUE", "aria-jobs")
APP_URL       = os.environ.get("APP_URL",            "https://aria-79255818146.us-central1.run.app")
TASK_SECRET   = os.environ.get("TASK_SECRET",       "aria-task-secret-2025")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")

# ── App ───────────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get("SECRET_KEY", "aria-studio-secret-2025-xk91mw")

# ── SMTP ──────────────────────────────────────────────────────────────────
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "noreply@aria.app")

# ── Models ─────────────────────────────────────────────────────────────────
BRAIN      = "gemini-3.1-flash-lite-preview"
IMAGE      = "gemini-3.1-flash-image-preview"
VIDEO      = "veo-3.1-generate-preview"
TTS        = "gemini-2.5-flash-preview-tts"
LIVE_MODEL = "gemini-live-2.5-flash-native-audio"

# ── Misc ──────────────────────────────────────────────────────────────────
TMP_DIR = "/tmp/aria"
