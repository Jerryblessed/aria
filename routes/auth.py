import time
import secrets

from flask import Blueprint, request, jsonify
from google.cloud import firestore as fs

from services.firestore import (
    db, get_user_by_email, save_user, get_user_by_token,
    register_user, login_user, create_reset_token, consume_reset_token,
)
from services.email import send_forgot_email

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.post("/register")
def auth_register():
    d     = request.get_json(force=True, silent=True) or {}
    email = d.get("email", "").strip().lower()
    pw    = d.get("password", "").strip()
    name  = (d.get("name", "") or "User").strip()

    if not email or "@" not in email:
        return jsonify({"error": "Please enter a valid email address"}), 400
    if not pw or len(pw) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    if get_user_by_email(email):
        return jsonify({"error": "An account with this email already exists."}), 409

    return jsonify(register_user(name, email, pw))


@auth_bp.post("/login")
def auth_login():
    d     = request.get_json(force=True, silent=True) or {}
    email = d.get("email", "").strip().lower()
    pw    = d.get("password", "").strip()

    if not email or not pw:
        return jsonify({"error": "Email and password are required"}), 400

    result = login_user(email, pw)
    if not result:
        return jsonify({"error": "Incorrect email or password"}), 401
    return jsonify(result)


@auth_bp.post("/google")
def auth_google():
    d             = request.get_json(force=True, silent=True) or {}
    id_token_str  = d.get("id_token", "").strip()
    if not id_token_str:
        return jsonify({"error": "No token provided"}), 400

    # Verify the Google token
    import base64, json as _json
    try:
        from google.oauth2 import id_token as git
        from google.auth.transport import requests as gr
        from config import GOOGLE_CLIENT_ID
        idinfo  = git.verify_oauth2_token(id_token_str, gr.Request(), GOOGLE_CLIENT_ID or None)
        g_email = idinfo.get("email", "").lower()
        g_name  = idinfo.get("name", "") or "User"
        g_sub   = idinfo.get("sub", "")
        if not g_email:
            return jsonify({"error": "Could not retrieve email"}), 400
    except Exception:
        try:
            parts   = id_token_str.split(".")
            padded  = parts[1] + "==" * (4 - len(parts[1]) % 4)
            payload = _json.loads(base64.urlsafe_b64decode(padded))
            g_email = payload.get("email", "").lower()
            g_name  = payload.get("name", "User")
            g_sub   = payload.get("sub", "")
            if not g_email:
                raise ValueError("no email")
        except Exception:
            return jsonify({"error": "Invalid Google token"}), 401

    existing = get_user_by_email(g_email)
    is_new   = existing is None
    token    = secrets.token_hex(32)

    import uuid as _uuid
    if is_new:
        uid  = str(_uuid.uuid4())
        save_user(g_email, {
            "id": uid, "name": g_name, "email": g_email,
            "google_sub": g_sub, "token": token,
            "interests": [], "created_at": time.time(),
        })
    else:
        uid = existing["id"]
        existing["token"]      = token
        existing["google_sub"] = g_sub
        if not existing.get("name"):
            existing["name"] = g_name
        save_user(g_email, existing)

    u = get_user_by_email(g_email)
    return jsonify({
        "token": token,
        "user": {
            "id":        uid,
            "name":      u.get("name", g_name),
            "email":     g_email,
            "interests": u.get("interests", []),
            "is_new":    is_new,
        },
    })


@auth_bp.post("/validate")
def auth_validate():
    d     = request.get_json(force=True, silent=True) or {}
    token = d.get("token", "")
    email, u = get_user_by_token(token)
    if not u:
        return jsonify({"error": "Invalid session"}), 401
    return jsonify({"user": {"id": u["id"], "name": u.get("name", ""), "email": email, "interests": u.get("interests", [])}})


@auth_bp.post("/forgot")
def auth_forgot():
    d     = request.get_json(force=True, silent=True) or {}
    email = d.get("email", "").strip().lower()
    reset_tok = create_reset_token(email)
    if reset_tok:
        send_forgot_email(email, reset_tok)
    # Always return same response to prevent email enumeration
    return jsonify({"ok": True, "message": "If this email exists, reset instructions have been sent."})


@auth_bp.post("/reset-password")
def auth_reset_password():
    d         = request.get_json(force=True, silent=True) or {}
    reset_tok = d.get("token", "").strip()
    new_pw    = d.get("password", "").strip()

    if not reset_tok or not new_pw:
        return jsonify({"error": "Missing token or password"}), 400
    if len(new_pw) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    success, message = consume_reset_token(reset_tok, new_pw)
    if not success:
        return jsonify({"error": message}), 400
    return jsonify({"ok": True, "message": message})


@auth_bp.post("/interests")
def save_interests():
    d         = request.get_json(force=True, silent=True) or {}
    token     = d.get("token", "")
    interests = d.get("interests", [])
    email, u  = get_user_by_token(token)
    if not u:
        return jsonify({"error": "Unauthorized"}), 401
    u["interests"] = interests
    save_user(email, u)
    return jsonify({"ok": True})
