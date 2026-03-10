from google.cloud import storage as gcs_lib
from config import GCP_PROJECT, GCS_BUCKET

gcs_client = gcs_lib.Client(project=GCP_PROJECT)
bucket     = gcs_client.bucket(GCS_BUCKET)


def gcs_upload_file(local_path: str, blob_name: str, content_type: str) -> str:
    blob = bucket.blob(blob_name)
    blob.upload_from_filename(local_path, content_type=content_type)
    return blob_name


def gcs_upload_bytes(data: bytes, blob_name: str, content_type: str) -> str:
    blob = bucket.blob(blob_name)
    blob.upload_from_string(data, content_type=content_type)
    return blob_name


def gcs_download_to_tmp(blob_name: str, local_path: str) -> None:
    bucket.blob(blob_name).download_to_filename(local_path)


def gcs_signed_url(blob_name: str, expiration: int = 3600) -> str:
    from datetime import timedelta
    import google.auth
    import google.auth.transport.requests

    blob = bucket.blob(blob_name)

    # IAM-based signing — works on Cloud Run without a key file
    try:
        credentials, _ = google.auth.default()
        req = google.auth.transport.requests.Request()
        credentials.refresh(req)
        sa_email = getattr(
            credentials,
            "service_account_email",
            f"{GCP_PROJECT}@appspot.gserviceaccount.com",
        )
        return blob.generate_signed_url(
            expiration=timedelta(seconds=expiration),
            method="GET",
            service_account_email=sa_email,
            access_token=credentials.token,
            version="v4",
        )
    except Exception as e1:
        # Fallback: SA key file (local dev)
        try:
            return blob.generate_signed_url(
                expiration=timedelta(seconds=expiration),
                method="GET",
                version="v4",
            )
        except Exception as e2:
            raise RuntimeError(f"Cannot sign URL: {e1} | {e2}") from e2
