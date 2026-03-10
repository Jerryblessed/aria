import smtplib
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_URL


def _smtp_send(msg: MIMEMultipart) -> None:
    """Send email in a background thread — never blocks a request."""
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(msg["From"], msg["To"], msg.as_string())
    except Exception as e:
        print(f"[email] {e}")


def _send_async(msg: MIMEMultipart) -> None:
    threading.Thread(target=_smtp_send, args=(msg,), daemon=True).start()


def send_completion_email(to: str, project_name: str, jid: str, job_type: str) -> None:
    if not SMTP_USER or not to:
        return
    msg = MIMEMultipart()
    msg["From"]    = SMTP_FROM
    msg["To"]      = to
    msg["Subject"] = f"\u2726 ARIA \u2014 Your {job_type} is ready!"
    body = (
        f"Hi there,\n\nYour ARIA story asset is ready!\n\n"
        f"Project: {project_name or 'Your Story'}\nType: {job_type}\n\n"
        f"Open ARIA: {APP_URL}\nDownload: {APP_URL}/api/media/{jid}\n\n\u2014 ARIA"
    )
    msg.attach(MIMEText(body, "plain"))
    _send_async(msg)


def send_forgot_email(to: str, reset_token: str) -> None:
    if not SMTP_USER or not to:
        return
    reset_url = f"{APP_URL}?reset={reset_token}"
    msg = MIMEMultipart()
    msg["From"]    = SMTP_FROM
    msg["To"]      = to
    msg["Subject"] = "\u2726 ARIA \u2014 Reset your password"
    body = (
        f"Hi,\n\nWe received a request to reset your ARIA password.\n\n"
        f"Click the link below to reset it (expires in 1 hour):\n{reset_url}\n\n"
        f"If you didn't request this, you can safely ignore this email.\n\n\u2014 ARIA"
    )
    msg.attach(MIMEText(body, "plain"))
    _send_async(msg)
