import copy
import time
import uuid

from flask import Blueprint, request, jsonify
from google.cloud import firestore as fs

from services.firestore import db, get_user_by_token

projects_bp = Blueprint("projects", __name__, url_prefix="/api/projects")


def _auth():
    token = request.headers.get("X-Token", "")
    return get_user_by_token(token)


@projects_bp.get("")
def list_projects():
    email, u = _auth()
    if not u:
        return jsonify({"error": "Unauthorized"}), 401
    docs = (
        db.collection("projects")
        .where(filter=fs.FieldFilter("user_email", "==", email))
        .order_by("updated_at", direction=fs.Query.DESCENDING)
        .stream()
    )
    return jsonify({"projects": [doc.to_dict() for doc in docs]})


@projects_bp.post("/save")
def save_project():
    email, u = _auth()
    if not u:
        return jsonify({"error": "Unauthorized"}), 401
    d   = request.get_json(force=True, silent=True) or {}
    pid = d.get("id") or str(uuid.uuid4())
    ex  = db.collection("projects").document(pid).get()
    ex  = ex.to_dict() if ex.exists else {}
    tl  = [{k: v for k, v in item.items() if k not in ("_prog",)} for item in d.get("timeline", [])]
    db.collection("projects").document(pid).set({
        "id":           pid,
        "user_email":   email,
        "name":         d.get("name", "Untitled Project"),
        "timeline":     tl,
        "history":      d.get("history", [])[-20:],
        "story_context":d.get("story_context", {}),
        "created_at":   ex.get("created_at", time.time()),
        "updated_at":   time.time(),
    })
    return jsonify({"id": pid, "ok": True})


@projects_bp.delete("/<pid>")
def delete_project(pid):
    email, u = _auth()
    if not u:
        return jsonify({"error": "Unauthorized"}), 401
    doc = db.collection("projects").document(pid).get()
    if not doc.exists or doc.to_dict().get("user_email") != email:
        return jsonify({"error": "Not found"}), 404
    db.collection("projects").document(pid).delete()
    return jsonify({"ok": True})


@projects_bp.post("/<pid>/duplicate")
def duplicate_project(pid):
    email, u = _auth()
    if not u:
        return jsonify({"error": "Unauthorized"}), 401
    doc = db.collection("projects").document(pid).get()
    if not doc.exists or doc.to_dict().get("user_email") != email:
        return jsonify({"error": "Not found"}), 404
    p       = doc.to_dict()
    new_pid = str(uuid.uuid4())
    np      = copy.deepcopy(p)
    np.update({"id": new_pid, "name": p["name"] + " (Copy)", "created_at": time.time(), "updated_at": time.time()})
    db.collection("projects").document(new_pid).set(np)
    return jsonify({"id": new_pid, "project": np})
