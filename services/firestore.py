import time
import uuid
import hashlib
import secrets

from google.cloud import firestore as fs
from config import GCP_PROJECT

db = fs.Client(project=GCP_PROJECT)


# ── Job helpers ───────────────────────────────────────────────────────────

def job_new(job_type: str, notify_email: str = "") -> str:
    jid = str(uuid.uuid4())
    db.collection("jobs").document(jid).set({
        "status":       "pending",
        "type":         job_type,
        "gcs_path":     None,
        "error":        None,
        "progress":     0,
        "notify_email": notify_email,
        "created_at":   time.time(),
    })
    return jid


def job_set(jid: str, **kwargs) -> None:
    db.collection("jobs").document(jid).update(kwargs)


def job_get(jid: str) -> dict:
    doc = db.collection("jobs").document(jid).get()
    return doc.to_dict() if doc.exists else {}


# ── User helpers ──────────────────────────────────────────────────────────

def _hash_pw(password: str) -> str:
    return hashlib.sha256((password + "aria_salt_xk2025").encode()).hexdigest()


def get_user_by_email(email: str) -> dict | None:
    doc = db.collection("users").document(email).get()
    return doc.to_dict() if doc.exists else None


def save_user(email: str, data: dict) -> None:
    db.collection("users").document(email).set(data)


def get_user_by_token(token: str) -> tuple[str | None, dict | None]:
    if not token:
        return None, None
    for doc in (
        db.collection("users")
        .where(filter=fs.FieldFilter("token", "==", token))
        .limit(1)
        .stream()
    ):
        u = doc.to_dict()
        return u.get("email", doc.id), u
    return None, None


def register_user(name: str, email: str, password: str) -> dict:
    """Create a new user and return the token + user dict."""
    uid   = str(uuid.uuid4())
    token = secrets.token_hex(32)
    data  = {
        "id":            uid,
        "name":          name,
        "email":         email,
        "password_hash": _hash_pw(password),
        "token":         token,
        "interests":     [],
        "created_at":    time.time(),
    }
    save_user(email, data)
    return {"token": token, "user": {"id": uid, "name": name, "email": email, "interests": [], "is_new": True}}


def login_user(email: str, password: str) -> dict | None:
    """Validate credentials; return fresh token payload or None."""
    u = get_user_by_email(email)
    if not u or u.get("password_hash") != _hash_pw(password):
        return None
    token       = secrets.token_hex(32)
    u["token"]  = token
    save_user(email, u)
    return {"token": token, "user": {"id": u["id"], "name": u.get("name", ""), "email": email, "interests": u.get("interests", [])}}


def create_reset_token(email: str) -> str | None:
    """Attach a reset token to the user; return it, or None if user not found."""
    u = get_user_by_email(email)
    if not u:
        return None
    reset_tok          = secrets.token_hex(16)
    u["reset_token"]   = reset_tok
    u["reset_expires"] = time.time() + 3600
    save_user(email, u)
    return reset_tok


def consume_reset_token(reset_tok: str, new_password: str) -> tuple[bool, str]:
    """Apply a password reset; return (success, message)."""
    for doc in db.collection("users").stream():
        u = doc.to_dict()
        if u.get("reset_token") == reset_tok:
            if u.get("reset_expires", 0) < time.time():
                return False, "Reset link has expired. Please request a new one."
            u["password_hash"] = _hash_pw(new_password)
            u["token"]         = secrets.token_hex(32)
            u.pop("reset_token",   None)
            u.pop("reset_expires", None)
            save_user(doc.id, u)
            return True, "Password updated. You can now sign in."
    return False, "Invalid or expired reset link."
