import os
import json
import threading

from flask import request
from config import GCP_PROJECT, GCP_LOCATION, TASKS_QUEUE, APP_URL, TASK_SECRET

try:
    from google.cloud import tasks_v2
    tasks_client = tasks_v2.CloudTasksClient()
    tasks_parent = tasks_client.queue_path(GCP_PROJECT, GCP_LOCATION, TASKS_QUEUE)
    print("   Cloud Tasks: connected")
except Exception as _te:
    tasks_client = None
    tasks_parent = None
    print(f"   Cloud Tasks: unavailable ({_te}) — async jobs will run inline")


def verify_task_secret() -> bool:
    return request.headers.get("X-Task-Secret") == TASK_SECRET


def dispatch_task(endpoint: str, payload: dict) -> None:
    """
    Send a task to Cloud Tasks if available, otherwise fall back to a
    background thread calling the endpoint directly (local dev).
    """
    if tasks_client and tasks_parent and APP_URL and "your-app.run.app" not in APP_URL:
        try:
            tasks_client.create_task(
                parent=tasks_parent,
                task={
                    "http_request": {
                        "http_method": tasks_v2.HttpMethod.POST,
                        "url": f"{APP_URL}{endpoint}",
                        "headers": {
                            "Content-Type":   "application/json",
                            "X-Task-Secret":  TASK_SECRET,
                        },
                        "body": json.dumps(payload).encode(),
                    }
                },
            )
            return
        except Exception as e:
            print(f"[tasks] Cloud Tasks failed ({e}), falling back to inline")

    # Inline fallback
    def _inline():
        try:
            import requests as _req
            port = os.environ.get("PORT", 8080)
            _req.post(
                f"http://127.0.0.1:{port}{endpoint}",
                json=payload,
                headers={"X-Task-Secret": TASK_SECRET},
                timeout=600,
            )
        except Exception as e:
            print(f"[tasks-inline] {e}")

    threading.Thread(target=_inline, daemon=True).start()
