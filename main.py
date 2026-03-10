import os
import time
from pathlib import Path

from flask import Flask, jsonify, send_from_directory

try:
    from flask_cors import CORS as _FlaskCORS
    _has_cors = True
except ImportError:
    _has_cors = False

from config import SECRET_KEY, TMP_DIR, GOOGLE_CLIENT_ID
from data.templates import TEMPLATES

# ── Create app ────────────────────────────────────────────────────────────
app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = SECRET_KEY
if _has_cors:
    _FlaskCORS(app)

# ── Ensure tmp dir ────────────────────────────────────────────────────────
Path(TMP_DIR).mkdir(exist_ok=True)

# ── CORS + cache headers on every response ────────────────────────────────
@app.after_request
def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"]  = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Token, X-Task-Secret"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return resp

@app.route("/", methods=["OPTIONS"])
@app.route("/<path:p>", methods=["OPTIONS"])
def _options(p=""):
    return "", 204

# ── Health + config ───────────────────────────────────────────────────────
@app.get("/health")
def health():
    return jsonify({"status": "ok", "ts": int(time.time())})

@app.get("/api/config")
def get_config():
    return jsonify({"google_client_id": GOOGLE_CLIENT_ID})

# ── Serve the SPA ─────────────────────────────────────────────────────────
@app.get("/")
def index():
    return send_from_directory("templates", "index.html")

# ── Register blueprints ───────────────────────────────────────────────────
from routes.auth       import auth_bp
from routes.templates  import templates_bp
from routes.projects   import projects_bp
from routes.recordings import recordings_bp
from routes.chat       import chat_bp
from routes.generate   import generate_bp
from routes.tasks      import tasks_bp
from routes.export     import export_bp
from routes.media      import media_bp

app.register_blueprint(auth_bp)
app.register_blueprint(templates_bp)
app.register_blueprint(projects_bp)
app.register_blueprint(recordings_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(generate_bp)
app.register_blueprint(tasks_bp)
app.register_blueprint(export_bp)
app.register_blueprint(media_bp)

# ── Register WebSocket live voice ─────────────────────────────────────────
from live.ws_handler import register as register_ws
register_ws(app)

# ── Entry point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    from config import GCP_PROJECT, GCP_LOCATION, GCS_BUCKET, TASKS_QUEUE, APP_URL
    print("✦  ARIA GCP Edition  →  http://localhost:8080")
    print(f"   Project   : {GCP_PROJECT}")
    print(f"   Location  : {GCP_LOCATION}")
    print(f"   Bucket    : {GCS_BUCKET}")
    print(f"   Queue     : {TASKS_QUEUE}")
    print(f"   App URL   : {APP_URL}")
    print(f"   Templates : {len(TEMPLATES)} loaded")
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8080)),
        debug=False,
        threaded=True,
    )
