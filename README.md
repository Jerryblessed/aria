# ARIA — Creative Storyteller

AI-powered cinematic story generator built on Google Cloud + Gemini.

## Stack
- **Backend**: Flask + Flask-Sock (WebSockets)
- **AI**: Gemini 2.5 Flash (chat), Veo 2 (video), Gemini image gen, Gemini Live (voice)
- **Storage**: Google Cloud Storage, Firestore
- **Infra**: Cloud Run, Cloud Tasks

## Project Structure
```
aria/
├── main.py            # App entry point — Flask app + blueprint registration
├── config.py          # All env vars and model names
├── data/
│   └── templates.py   # 30+ story templates
├── routes/            # One Blueprint per domain
│   ├── auth.py        # /api/auth/*
│   ├── chat.py        # /api/chat, /api/narrate
│   ├── generate.py    # /api/generate/image|video, /api/upload
│   ├── tasks.py       # /api/tasks/* (Cloud Tasks workers)
│   ├── export.py      # /api/export/video|youtube
│   ├── media.py       # /api/media/<jid>, /api/job/<jid>, /api/frames/*
│   ├── projects.py    # /api/projects/*
│   ├── recordings.py  # /api/recordings/*
│   └── templates.py   # /api/templates
├── services/          # Shared service clients
│   ├── ai.py          # Gemini clients, TTS, extract_json
│   ├── gcs.py         # GCS upload/download/signed URLs
│   ├── firestore.py   # Jobs, users, auth helpers
│   ├── email.py       # SMTP (completion + password reset)
│   └── tasks.py       # Cloud Tasks dispatch + secret verify
├── live/              # Gemini Live voice bridge
│   ├── ws_handler.py  # WebSocket bridge (/ws/live)
│   ├── tools.py       # LIVE_TOOLS function declarations
│   ├── prompts.py     # LIVE_SYSTEM prompt
│   └── browser.py     # Playwright + MSS screen capture
├── templates/
│   └── index.html     # SPA shell
└── static/
    ├── css/style.css  # All styles
    └── js/app.js      # Full frontend application
```

## Local Dev
```bash
pip install -r requirements.txt
export GCP_PROJECT=your-project
export GCS_BUCKET=your-bucket
python main.py
# → http://localhost:8080
```

## Deploy to Cloud Run
```bash
gcloud builds submit --config cloudbuild.yaml
```

## Environment Variables
| Variable | Default | Description |
|---|---|---|
| `GCP_PROJECT` | `tag-file-manager` | GCP project ID |
| `GCS_BUCKET` | `aria-media-bucket` | Media storage bucket |
| `CLOUD_TASKS_QUEUE` | `aria-jobs` | Cloud Tasks queue name |
| `APP_URL` | *(Cloud Run URL)* | Public app URL (for task callbacks) |
| `TASK_SECRET` | `aria-task-secret-2025` | HMAC secret for task auth |
| `SECRET_KEY` | *(set in prod)* | Flask session secret |
| `SMTP_HOST/PORT/USER/PASS` | — | Email (optional) |
| `GOOGLE_CLIENT_ID` | — | For Google Sign-In (optional) |
