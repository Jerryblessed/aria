import base64
import io
import json
import subprocess
import tempfile
import time
import traceback
from pathlib import Path

from flask import Blueprint, request, jsonify
from google.genai import types

from config import IMAGE, VIDEO, TMP_DIR
from services.ai import client, client2, NARR_SYS, tts_narrate, wav_encode
from services.firestore import job_set, job_get
from services.gcs import gcs_upload_file, gcs_download_to_tmp
from services.tasks import verify_task_secret
from services.email import send_completion_email
from live.ws_handler import captured_frames

tasks_bp = Blueprint("tasks", __name__, url_prefix="/api/tasks")
TMP = Path(TMP_DIR)
TMP.mkdir(exist_ok=True)


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        return True
    except Exception:
        return False


@tasks_bp.post("/generate-image")
def task_generate_image():
    if not verify_task_secret():
        return jsonify({"error": "Unauthorized"}), 403
    p   = request.get_json(force=True, silent=True) or {}
    jid = p.get("jid")
    d   = p.get("data", {})
    try:
        from PIL import Image as PI
        job_set(jid, status="running", progress=10)

        prompt     = d.get("prompt", "cinematic scene")
        ratio      = d.get("aspect_ratio", "16:9")
        style_seed = d.get("style_seed", "")
        if style_seed:
            prompt = f"{prompt}. Visual style: {style_seed}."

        contents = [prompt]
        refs     = d.get("reference_images", [])
        if not refs and d.get("reference_image", ""):
            refs = [d["reference_image"]]

        fid = d.get("frame_id", "")
        if fid and fid in captured_frames:
            refs.insert(0, captured_frames[fid]["b64"])

        for ref in refs[:14]:
            try:
                raw = base64.b64decode(ref.split(",")[-1])
                contents.append(PI.open(io.BytesIO(raw)).convert("RGB"))
            except Exception:
                pass

        job_set(jid, progress=30)
        r = client2.models.generate_content(
            model=IMAGE,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
                image_config=types.ImageConfig(
                    aspect_ratio=ratio,
                    image_size=d.get("resolution", "1K"),
                ),
            ),
        )
        job_set(jid, progress=80)

        lp    = str(TMP / f"{jid}.png")
        saved = False
        for pp in r.parts:
            if hasattr(pp, "inline_data") and pp.inline_data:
                pp.as_image().save(lp)
                saved = True
                break
        if not saved:
            raise RuntimeError("No image returned from model")

        bn = f"media/{jid}.png"
        gcs_upload_file(lp, bn, "image/png")
        job_set(jid, status="done", gcs_path=bn, progress=100)

        j = job_get(jid)
        if j.get("notify_email"):
            send_completion_email(j["notify_email"], "Your Story", jid, "Image")

    except Exception as e:
        traceback.print_exc()
        job_set(jid, status="error", error=str(e))
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True})


@tasks_bp.post("/generate-video")
def task_generate_video():
    if not verify_task_secret():
        return jsonify({"error": "Unauthorized"}), 403
    p   = request.get_json(force=True, silent=True) or {}
    jid = p.get("jid")
    d   = p.get("data", {})
    try:
        from PIL import Image as PI
        job_set(jid, status="running", progress=5)

        prompt     = d.get("prompt", "cinematic scene")
        ratio      = d.get("aspect_ratio", "16:9")
        style_seed = d.get("style_seed", "")
        if style_seed:
            prompt = f"{prompt}. Visual continuity: {style_seed}."

        cfg = types.GenerateVideosConfig(
            aspect_ratio=ratio,
            duration_seconds=d.get("duration", 8),
            resolution="720p",
            number_of_videos=1,
        )
        kw = dict(model=VIDEO, prompt=prompt, config=cfg)

        ref = d.get("reference_image", "")
        fid = d.get("frame_id", "")
        if not ref and fid and fid in captured_frames:
            ref = captured_frames[fid]["b64"]
        if ref:
            raw         = base64.b64decode(ref.split(",")[-1])
            kw["image"] = PI.open(io.BytesIO(raw)).convert("RGB")

        job_set(jid, progress=15)
        op   = client.models.generate_videos(**kw)
        poll = 0
        while not op.done:
            time.sleep(10)
            op   = client.operations.get(op)
            poll += 1
            job_set(jid, progress=min(15 + poll * 5, 90))

        lp  = str(TMP / f"{jid}.mp4")
        vid = op.response.generated_videos[0]
        vid.video.save(lp)

        bn = f"media/{jid}.mp4"
        gcs_upload_file(lp, bn, "video/mp4")
        job_set(jid, status="done", gcs_path=bn, progress=100)

        j = job_get(jid)
        if j.get("notify_email"):
            send_completion_email(j["notify_email"], "Your Story", jid, "Video")

    except Exception as e:
        traceback.print_exc()
        job_set(jid, status="error", error=str(e))
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True})


@tasks_bp.post("/export-video")
def task_export_video():
    if not verify_task_secret():
        return jsonify({"error": "Unauthorized"}), 403
    p      = request.get_json(force=True, silent=True) or {}
    jid    = p.get("jid")
    items  = p.get("items", [])
    tmpdir = Path(tempfile.mkdtemp())

    try:
        job_set(jid, status="running", progress=5)
        if not _ffmpeg_available():
            job_set(jid, status="error", error="ffmpeg not installed")
            return jsonify({"error": "ffmpeg"}), 500

        input_args    = []
        filter_parts  = []
        audio_inputs  = []
        n             = 0   # video stream counter  (for [v0], [v1] labels)
        an            = 0   # audio stream counter
        total_inputs  = 0   # actual ffmpeg -i index (video + audio interleaved)

        for i, item in enumerate(items):
            url   = item.get("media_path", "")
            dur   = max(item.get("duration", 6), 2)
            title = item.get("title", "Scene")
            narr  = item.get("narration", "")

            # ── Video / image track ───────────────────────────────────────
            media_added = False
            if url and url.startswith("/api/media/"):
                media_jid = url.split("/")[-1]
                j2        = job_get(media_jid)
                if j2 and j2.get("gcs_path"):
                    ext = ".mp4" if j2.get("type") == "video" else ".png"
                    lm  = str(tmpdir / f"media_{i}{ext}")
                    gcs_download_to_tmp(j2["gcs_path"], lm)
                    pp      = Path(lm)
                    vid_idx = total_inputs  # ← actual ffmpeg input index

                    if pp.suffix == ".mp4":
                        probe = subprocess.run(
                            ["ffprobe", "-v", "quiet", "-print_format", "json",
                             "-show_streams", str(pp)],
                            capture_output=True, text=True, timeout=15,
                        )
                        try:
                            streams = json.loads(probe.stdout).get("streams", [])
                            vdur    = next(
                                (float(s.get("duration", dur))
                                 for s in streams if s.get("codec_type") == "video"),
                                dur,
                            )
                            dur = max(vdur, 2)
                        except Exception:
                            pass
                        input_args += ["-i", str(pp)]
                        filter_parts.append(
                            f"[{vid_idx}:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
                            f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v{n}]"
                        )
                    else:
                        input_args += ["-loop", "1", "-t", str(dur), "-i", str(pp)]
                        filter_parts.append(
                            f"[{vid_idx}:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
                            f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v{n}]"
                        )

                    total_inputs += 1
                    n            += 1
                    media_added   = True

            if not media_added:
                safe_title = title.replace("'", "\\'").replace(":", "\\:")[:60]
                safe_narr  = (narr[:80] if narr else "").replace("'", "\\'").replace(":", "\\:")
                tout       = str(tmpdir / f"title_{i}.mp4")
                subprocess.run(
                    ["ffmpeg", "-y", "-f", "lavfi",
                     "-i", f"color=c=0x060811:size=1920x1080:duration={dur}",
                     "-vf", (
                         f"drawtext=text='{safe_title}':fontsize=72:fontcolor=white:"
                         f"x=(w-text_w)/2:y=(h-text_h)/2-40,"
                         f"drawtext=text='{safe_narr}':fontsize=32:fontcolor=0x8890b0:"
                         f"x=(w-text_w)/2:y=(h-text_h)/2+60"
                     ),
                     "-c:v", "libx264", "-pix_fmt", "yuv420p", tout],
                    capture_output=True, timeout=30,
                )
                if Path(tout).exists():
                    vid_idx = total_inputs
                    input_args += ["-i", tout]
                    filter_parts.append(
                        f"[{vid_idx}:v]scale=1920:1080,setsar=1,fps=24[v{n}]"
                    )
                    total_inputs += 1
                    n            += 1

            # ── Narration audio (TTS) ─────────────────────────────────────
            audio_path = None
            if narr and narr.strip():
                try:
                    wav_bytes  = tts_narrate(narr)
                    audio_path = str(tmpdir / f"narr_{i}.wav")
                    with open(audio_path, "wb") as af:
                        af.write(wav_bytes)
                except Exception as ae:
                    print(f"[export-tts scene {i}] {ae}")

            if audio_path and Path(audio_path).exists():
                padded = str(tmpdir / f"narr_{i}_padded.wav")
                subprocess.run(
                    ["ffmpeg", "-y", "-i", audio_path,
                     "-af", f"apad=whole_dur={dur}", "-t", str(dur), padded],
                    capture_output=True, timeout=30,
                )
                aud_file = padded if Path(padded).exists() else audio_path
                aud_idx  = total_inputs
                input_args += ["-i", aud_file]
                audio_inputs.append(aud_idx)
                total_inputs += 1
                an           += 1
            else:
                silent = str(tmpdir / f"silent_{i}.wav")
                subprocess.run(
                    ["ffmpeg", "-y", "-f", "lavfi",
                     "-i", f"anullsrc=r=24000:cl=mono:d={dur}", "-t", str(dur), silent],
                    capture_output=True, timeout=15,
                )
                aud_idx = total_inputs
                input_args += ["-i", silent]
                audio_inputs.append(aud_idx)
                total_inputs += 1
                an           += 1

            job_set(jid, progress=5 + int(50 * (i + 1) / len(items)))

        if n == 0:
            job_set(jid, status="error", error="No valid media found")
            return jsonify({"error": "no media"}), 500

        # ── Build filter_complex ──────────────────────────────────────────
        # video_ci: [v0][v1][v2]…  — labels from filter_parts above
        # audio_ci: [4:a][6:a]…   — actual interleaved input indices
        video_ci = "".join(f"[v{k}]" for k in range(n))
        audio_ci = "".join(f"[{idx}:a]" for idx in audio_inputs)

        fc = (
            ";".join(filter_parts)
            + f";{video_ci}concat=n={n}:v=1:a=0[outv]"
            + (f";{audio_ci}concat=n={an}:v=0:a=1[outa]" if an else "")
        )

        op       = str(tmpdir / f"{jid}.mp4")
        map_args = ["-map", "[outv]"]
        if an:
            map_args += ["-map", "[outa]"]

        cmd = (
            ["ffmpeg", "-y"] + input_args
            + ["-filter_complex", fc]
            + map_args
            + ["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p"]
            + ([] if not an else ["-c:a", "aac", "-b:a", "128k", "-shortest"])
            + [op]
        )

        job_set(jid, progress=75)
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if res.returncode != 0:
            print(f"[ffmpeg stderr]\n{res.stderr[-600:]}")
            job_set(jid, status="error", error=f"ffmpeg: {res.stderr[-300:]}")
            return jsonify({"error": "ffmpeg failed"}), 500

        bn = f"media/{jid}.mp4"
        gcs_upload_file(op, bn, "video/mp4")
        job_set(jid, status="done", gcs_path=bn, progress=100)

        j = job_get(jid)
        if j.get("notify_email"):
            send_completion_email(j["notify_email"], "Your Story", jid, "Compiled Video")

    except Exception as e:
        traceback.print_exc()
        job_set(jid, status="error", error=str(e))
        return jsonify({"error": str(e)}), 500
    finally:
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)

    return jsonify({"ok": True})