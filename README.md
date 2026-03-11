# ARIA — Creative Storyteller

> Talk to an AI creative director. Watch your story come alive — images, video, narration, all in one voice conversation.

**Live demo:** https://aria-79255818146.us-central1.run.app  
**Category:** Creative Storyteller — Gemini Live Agent Challenge 2026  
**Built:** February–March 2026

---

## Architecture

![ARIA Architecture](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/004/423/904/datas/gallery.jpg)

---

## What It Does

ARIA is a multimodal AI storyteller that generates cinematic scenes through natural voice and text. Speak a scene description, and ARIA produces AI-generated images or video, narrates it with TTS audio, and assembles everything into a full presentation — exportable as a single MP4.

**Core features:**
- **Live Voice Control** — Real-time conversation via Gemini Live native audio
- **Image Generation** — Scene illustrations via `gemini-3.1-flash-image-preview`
- **Video Generation** — Cinematic clips via `veo-3.1-generate-preview`
- **TTS Narration** — Scene voiceover via `gemini-2.5-flash-preview-tts`
- **Cinematic Presenter** — Full-screen story playback with synchronized audio
- **Export to MP4** — All scenes + narration compiled via FFmpeg
- **Session Recording** — Record and save full ARIA sessions to Cloud Storage
- **Browser Intelligence** — ARIA can see your screen, control tabs, take screenshots
- **Project Management** — Save, load, and manage stories via Firestore

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Google Cloud Run |
| AI Inference | Vertex AI (Gemini Live, Image, Video, TTS, Chat) |
| Database | Cloud Firestore |
| Storage | Google Cloud Storage |
| Async Jobs | Cloud Tasks |
| CI/CD | Google Cloud Build |
| Backend | Python · Flask · Flask-Sock |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Video Compilation | FFmpeg |
| Browser Automation | Playwright |

---

## AI Models

| Model | Purpose |
|---|---|
| `gemini-3.1-flash-lite-preview` | Story director, chat, scene planning |
| `gemini-3.1-flash-image-preview` | AI scene image generation |
| `veo-3.1-generate-preview` | Cinematic video generation |
| `gemini-2.5-flash-preview-tts` | Narration voiceover |
| `gemini-live-2.5-flash-native-audio` | Real-time live voice intelligence |

---

## AI Models

| Model | Purpose |
|---|---|
| `gemini-3.1-flash-lite-preview` | Story director, chat, scene planning |
| `gemini-3.1-flash-image-preview` | AI scene image generation |
| `veo-3.1-generate-preview` | Cinematic video generation |
| `gemini-2.5-flash-preview-tts` | Narration voiceover |
| `gemini-live-2.5-flash-native-audio` | Real-time live voice intelligence |

---

## Project Structure

```
aria/
├── main.py                   # Flask app entry point + blueprint registration
├── config.py                 # Env vars, model names, constants
├── cloudbuild.yaml           # Automated Cloud Build deployment
├── Dockerfile
├── requirements.txt
├── env.yaml.example          # Environment variable template
├── data/
│   └── templates.py          # 30+ story templates
├── routes/
│   ├── auth.py               # /api/auth/*
│   ├── chat.py               # /api/chat, /api/narrate
│   ├── generate.py           # /api/generate/image|video, /api/upload
│   ├── tasks.py              # /api/tasks/* (Cloud Tasks workers)
│   ├── export.py             # /api/export/video|youtube
│   ├── media.py              # /api/media/<jid>, /api/job/<jid>, /api/frames/*
│   ├── projects.py           # /api/projects/*
│   ├── recordings.py         # /api/recordings/*
│   └── templates.py          # /api/templates
├── services/
│   ├── ai.py                 # Gemini clients, TTS, extract_json
│   ├── gcs.py                # GCS upload/download/signed URLs
│   ├── firestore.py          # Jobs, users, auth helpers
│   ├── email.py              # SMTP notifications
│   └── tasks.py              # Cloud Tasks dispatch + secret verify
├── live/
│   ├── ws_handler.py         # WebSocket bridge (/ws/live)
│   ├── tools.py              # LIVE_TOOLS function declarations
│   ├── prompts.py            # LIVE_SYSTEM prompt
│   └── browser.py            # Playwright + MSS screen capture
├── templates/
│   └── index.html            # SPA shell
└── static/
    ├── css/style.css
    └── js/app.js
```

---

## Local Development

**Prerequisites:** Python 3.12+, FFmpeg installed, GCP project with Vertex AI and Firestore enabled.

```bash
# 1. Clone and install
git clone https://github.com/Jerryblessed/aria.git
cd aria
pip install -r requirements.txt
playwright install chromium --with-deps

# 2. Set environment variables
cp env.yaml.example env.yaml
# Open env.yaml and fill in your values

# 3. Run
python main.py
# → http://localhost:8080
```

---

## Deploy to Google Cloud Run

Deployment is fully automated via Google Cloud Build:

```bash
gcloud builds submit --config cloudbuild.yaml --project=YOUR_PROJECT_ID
```

This builds the Docker image, pushes it to Container Registry, and deploys to Cloud Run — same URL, zero downtime on every update.

**One-time setup** (grant Cloud Build permissions to deploy):

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

---

## Environment Variables

Copy `env.yaml.example` to `env.yaml` and fill in your values. Never commit `env.yaml` — it is in `.gitignore`.

| Variable | Description |
|---|---|
| `GCP_PROJECT` | GCP project ID |
| `GCP_LOCATION` | Vertex AI region (e.g. `us-central1`) |
| `GCP_LOCATION2` | Global location (e.g. `global`) |
| `GCS_BUCKET` | Cloud Storage bucket for media |
| `CLOUD_TASKS_QUEUE` | Cloud Tasks queue name |
| `APP_URL` | Public Cloud Run URL (for task callbacks) |
| `TASK_SECRET` | HMAC secret for Cloud Tasks auth |
| `SECRET_KEY` | Flask session secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `SMTP_HOST` | SMTP server host (optional) |
| `SMTP_PORT` | SMTP server port (optional) |
| `SMTP_USER` | SMTP username / email (optional) |
| `SMTP_PASS` | SMTP password / app password (optional) |
| `SMTP_FROM` | From address for sent emails (optional) |

---

## Google Cloud Services Used

- **Cloud Run** — Serverless hosting, auto-scaling
- **Vertex AI** — All Gemini model inference
- **Cloud Firestore** — User data, projects, job state
- **Cloud Storage** — Generated media, recordings
- **Cloud Tasks** — Async queue for long-running video generation
- **Cloud Build** — Automated CI/CD pipeline

---

## Third-Party Libraries

| Library | License | Purpose |
|---|---|---|
| FFmpeg | LGPL | Multi-scene video compilation |
| Playwright | Apache 2.0 | Headless browser tab control |
| MSS | MIT | Server-side screen capture |

---

*Built for the Gemini Live Agent Challenge · February–March 2026*