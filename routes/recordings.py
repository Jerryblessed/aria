import base64
import time
import uuid
import traceback

from flask import Blueprint, request, jsonify, redirect

from google.cloud import firestore as fs

from services.firestore import db, get_user_by_token
from services.gcs import gcs_upload_bytes, gcs_signed_url, bucket

recordings_bp = Blueprint("recordings", __name__, url_prefix="/api/recordings")


def _auth():
    token = request.headers.get("X-Token", "")
    return get_user_by_token(token)


@recordings_bp.post("/save")
def save_recording():
    d    = request.get_json(force=True, silent=True) or {}
    token = request.headers.get("X-Token", "") or d.get("token", "")
    email, u = get_user_by_token(token)
    if not u:
        return jsonify({"error": "Please sign in to save recordings"}), 401

    b64data  = d.get("data", "")
    name     = d.get("name", f"ARIA_Recording_{int(time.time())}.webm")
    duration = d.get("duration", 0)

    if not b64data:
        return jsonify({"error": "No recording data provided"}), 400

    try:
        raw       = base64.b64decode(b64data.split(",")[-1])
        rid       = str(uuid.uuid4())
        blob_name = f"recordings/{rid}.webm"
        gcs_upload_bytes(raw, blob_name, "video/webm")

        meta = {
            "id":         rid,
            "name":       name,
            "size":       len(raw),
            "duration":   duration,
            "created":    time.time(),
            "gcs_path":   blob_name,
            "user_email": email,
        }
        db.collection("recordings").document(rid).set(meta)

        try:
            url = gcs_signed_url(blob_name, expiration=3600)
        except Exception:
            url = f"/api/recordings/{rid}"

        meta["url"] = url
        return jsonify({"ok": True, "id": rid, "name": name, "size": len(raw), "duration": duration, "url": url})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@recordings_bp.get("")
def list_recordings():
    email, u = _auth()
    if not u:
        return jsonify({"recordings": []})

    limit = int(request.args.get("limit", "20"))
    try:
        q = (
            db.collection("recordings")
            .where(filter=fs.FieldFilter("user_email", "==", email))
            .order_by("created", direction=fs.Query.DESCENDING)
            .limit(limit)
        )
        recordings = []
        for doc in q.stream():
            dd = doc.to_dict()
            try:
                dd["url"] = gcs_signed_url(dd["gcs_path"], expiration=3600)
            except Exception:
                dd["url"] = f"/api/recordings/{dd['id']}"
            recordings.append(dd)
        return jsonify({"recordings": recordings})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"recordings": [], "error": str(e)}), 200


@recordings_bp.get("/<rid>")
def get_recording(rid):
    doc = db.collection("recordings").document(rid).get()
    if not doc.exists:
        return jsonify({"error": "Not found"}), 404
    meta = doc.to_dict()
    try:
        return redirect(gcs_signed_url(meta["gcs_path"], expiration=3600))
    except Exception:
        return jsonify({"error": "Could not generate URL"}), 500


@recordings_bp.delete("/<rid>")
def delete_recording(rid):
    email, u = _auth()
    if not u:
        return jsonify({"error": "Unauthorized"}), 401
    doc = db.collection("recordings").document(rid).get()
    if not doc.exists:
        return jsonify({"error": "Not found"}), 404
    meta = doc.to_dict()
    if meta.get("user_email") != email:
        return jsonify({"error": "Forbidden"}), 403
    try:
        bucket.blob(meta.get("gcs_path", "")).delete()
    except Exception:
        pass
    db.collection("recordings").document(rid).delete()
    return jsonify({"ok": True})
