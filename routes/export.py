from flask import Blueprint, request, jsonify

from services.firestore import job_new, get_user_by_token
from services.tasks import dispatch_task

export_bp = Blueprint("export", __name__, url_prefix="/api/export")


def _notify_email():
    token = request.headers.get("X-Token", "")
    _, u  = get_user_by_token(token)
    return u.get("email", "") if u else ""


@export_bp.post("/video")
def export_video():
    d     = request.get_json(force=True, silent=True) or {}
    items = d.get("items", [])
    if not items:
        return jsonify({"error": "Nothing to export"}), 400
    jid = job_new("compiled_video", notify_email=_notify_email())
    dispatch_task("/api/tasks/export-video", {"jid": jid, "items": items})
    return jsonify({"job_id": jid})


@export_bp.post("/youtube")
def export_youtube():
    d     = request.get_json(force=True, silent=True) or {}
    title = d.get("project_title", "My ARIA Story")
    items = d.get("items", [])
    desc  = "\n".join([
        f"• {i.get('title', '')}: {i.get('narration', '')[:80]}"
        for i in items
    ])
    return jsonify({
        "title":       title,
        "description": f"Created with ARIA Creative Storyteller\n\n{desc}",
        "tags":        ["ARIA", "storytelling", "cinematic"],
        "category":    "Film & Animation",
        "instructions":"1. Export to Video  2. Download MP4  3. Upload at studio.youtube.com",
    })
