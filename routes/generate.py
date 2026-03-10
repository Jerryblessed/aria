import base64
import uuid
import time

from flask import Blueprint, request, jsonify

from services.firestore import job_new, get_user_by_token
from services.tasks import dispatch_task

generate_bp = Blueprint("generate", __name__)


def _notify_email():
    token = request.headers.get("X-Token", "")
    _, u  = get_user_by_token(token)
    return u.get("email", "") if u else ""


@generate_bp.post("/api/generate/image")
def gen_image():
    d   = request.get_json(force=True, silent=True) or {}
    jid = job_new("image", notify_email=_notify_email())
    dispatch_task("/api/tasks/generate-image", {"jid": jid, "data": d})
    return jsonify({"job_id": jid})


@generate_bp.post("/api/generate/video")
def gen_video():
    d   = request.get_json(force=True, silent=True) or {}
    jid = job_new("video", notify_email=_notify_email())
    dispatch_task("/api/tasks/generate-video", {"jid": jid, "data": d})
    return jsonify({"job_id": jid})


@generate_bp.post("/api/upload")
def upload_media():
    d       = request.get_json(force=True, silent=True) or {}
    files   = d.get("files", [])
    results = []
    from services.gcs import gcs_upload_bytes
    from services.firestore import db
    for f in files:
        try:
            jid  = str(uuid.uuid4())
            raw  = base64.b64decode(f["data_b64"].split(",")[-1])
            mime = f.get("type", "image/jpeg")
            ext  = "mp4" if "video" in mime else "png"
            bn   = f"media/{jid}.{ext}"
            gcs_upload_bytes(raw, bn, mime)
            kind = "video" if "video" in mime else "image"
            db.collection("jobs").document(jid).set({
                "status": "done", "type": kind, "gcs_path": bn,
                "error": None, "progress": 100, "notify_email": "",
                "created_at": time.time(),
            })
            results.append({"job_id": jid, "name": f.get("name", ""), "type": kind})
        except Exception as e:
            results.append({"error": str(e), "name": f.get("name", "")})
    return jsonify({"results": results})
