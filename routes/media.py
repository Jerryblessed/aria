import time
import uuid
import traceback

from flask import Blueprint, request, jsonify, redirect, Response

from services.firestore import job_get
from services.gcs import gcs_signed_url, bucket
from live.ws_handler import captured_frames

media_bp = Blueprint("media", __name__)


@media_bp.get("/api/job/<jid>")
def job_status(jid):
    j = job_get(jid)
    return jsonify(j) if j else (jsonify({"error": "not found"}), 404)


@media_bp.get("/api/media/<jid>")
def media_file(jid):
    j = job_get(jid)
    if not j or j.get("status") != "done":
        return jsonify({"error": "not ready"}), 404
    gcs_path = j.get("gcs_path", "")
    if not gcs_path:
        return jsonify({"error": "no file"}), 404

    # Try signed URL redirect first
    try:
        url = gcs_signed_url(gcs_path, expiration=3600)
        return redirect(url)
    except Exception as e:
        print(f"[media] signed URL failed ({e}), streaming directly")

    # Fallback: stream bytes directly
    try:
        blob = bucket.blob(gcs_path)
        data = blob.download_as_bytes()
        if gcs_path.endswith(".mp4"):
            mime = "video/mp4"
        elif gcs_path.endswith(".webm"):
            mime = "video/webm"
        else:
            mime = "image/png"
        ext = gcs_path.rsplit(".", 1)[-1]
        return Response(
            data,
            mimetype=mime,
            headers={
                "Content-Disposition": f'inline; filename="{jid}.{ext}"',
                "Content-Length":      str(len(data)),
                "Cache-Control":       "public, max-age=3600",
            },
        )
    except Exception as e2:
        traceback.print_exc()
        return jsonify({"error": f"Could not retrieve file: {str(e2)}"}), 500


# ── Captured frames (screen-to-story) ─────────────────────────────────────

@media_bp.post("/api/frames/save")
def save_frame():
    d      = request.get_json(force=True, silent=True) or {}
    b64img = d.get("image_b64", "")
    source = d.get("source", "camera")
    if not b64img:
        return jsonify({"error": "No image data"}), 400
    fid = str(uuid.uuid4())
    captured_frames[fid] = {"b64": b64img, "source": source, "ts": time.time()}
    # Keep only last 20 frames
    if len(captured_frames) > 20:
        oldest = sorted(captured_frames.items(), key=lambda x: x[1]["ts"])
        for k, _ in oldest[: len(captured_frames) - 20]:
            del captured_frames[k]
    return jsonify({"frame_id": fid, "source": source, "ok": True})


@media_bp.get("/api/frames/latest")
def get_latest_frame():
    if not captured_frames:
        return jsonify({"error": "No captured frames"}), 404
    latest = max(captured_frames.items(), key=lambda x: x[1]["ts"])
    return jsonify({"frame_id": latest[0], "source": latest[1]["source"]})
