import base64
import json
import traceback

from flask import Blueprint, request, jsonify, Response, stream_with_context
from google.genai import types

from services.ai import client2, BRAIN, ARIA_SYS, NARR_SYS, extract_json, wav_encode, tts_narrate
from live.ws_handler import captured_frames

chat_bp = Blueprint("chat", __name__)


@chat_bp.post("/api/narration/edit")
def edit_narration():
    d     = request.get_json(force=True, silent=True) or {}
    mode  = d.get("mode", "auto")
    text  = d.get("text", "")
    scene = d.get("scene_title", "")
    if mode == "manual":
        return jsonify({"narration": text})
    prompt = (
        f"Rewrite this narration for scene '{scene}' in a clear, professional cinematic style "
        f"(50-70 words, present tense, wholesome, vivid): {text}"
    )
    try:
        r = client2.models.generate_content(
            model=BRAIN, contents=prompt,
            config=types.GenerateContentConfig(max_output_tokens=200, temperature=0.9),
        )
        return jsonify({"narration": r.text.strip()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@chat_bp.post("/api/narrate")
def narrate():
    d      = request.get_json(force=True, silent=True) or {}
    script = d.get("script", "").strip()
    if not script:
        return jsonify({"error": "empty script"}), 400
    try:
        wav_bytes = tts_narrate(script)
        b64       = base64.b64encode(wav_bytes).decode()
        return jsonify({"audio": f"data:audio/wav;base64,{b64}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@chat_bp.post("/api/chat")
def chat():
    d          = request.get_json(force=True, silent=True) or {}
    msg        = d.get("message", "").strip()
    hist       = d.get("history", [])[-14:]
    img64      = d.get("image_b64", "")
    frame_id   = d.get("frame_id", "")
    story_ctx  = d.get("story_context", {})
    has_files  = d.get("has_files", False)
    use_search = d.get("use_search", True)

    def gen():
        try:
            contents = []
            for h in hist:
                role = "model" if h.get("role") in ("model", "assistant") else "user"
                txt  = str(h.get("content", "")).strip()
                if txt:
                    contents.append(types.Content(role=role, parts=[types.Part(text=txt)]))

            parts = []
            if story_ctx:
                parts.append(types.Part(text=f"[STORY CONTEXT: {json.dumps(story_ctx)}]"))
            if has_files:
                parts.append(types.Part(text="[NOTE: User has uploaded files. Ask what to do — use mode: clarify]"))

            # Resolve captured frame
            resolved_img  = img64
            frame_source  = ""
            if frame_id and frame_id in captured_frames:
                fd            = captured_frames[frame_id]
                resolved_img  = fd["b64"]
                frame_source  = fd["source"]

            if msg:
                parts.append(types.Part(text=msg))

            if resolved_img:
                try:
                    raw = base64.b64decode(resolved_img.split(",")[-1])
                    if frame_source == "screen":
                        parts.append(types.Part(text="[CAPTURED SCREENSHOT FROM USER'S SCREEN — use as visual reference for story generation]"))
                    elif frame_source == "camera":
                        parts.append(types.Part(text="[CAPTURED CAMERA FRAME FROM USER'S WEBCAM — use as visual reference for story/portrait generation]"))
                    parts.append(types.Part(inline_data=types.Blob(mime_type="image/jpeg", data=raw)))
                except Exception as ie:
                    print(f"[chat] image err: {ie}")

            if not parts:
                parts = [types.Part(text="[user attached media — ask what to do]")]
            contents.append(types.Content(role="user", parts=parts))

            tools = []
            if use_search:
                try:
                    tools = [types.Tool(google_search=types.GoogleSearch())]
                except Exception:
                    tools = []

            r = client2.models.generate_content(
                model=BRAIN,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=ARIA_SYS,
                    response_mime_type="application/json",
                    temperature=0.85,
                    max_output_tokens=1500,
                    tools=tools if tools else None,
                ),
            )

            raw_text = ""
            if r and r.candidates:
                for c in r.candidates:
                    if c.content and c.content.parts:
                        for p in c.content.parts:
                            if hasattr(p, "text") and p.text:
                                raw_text += p.text
            if not raw_text and hasattr(r, "text"):
                raw_text = r.text or ""
            if not raw_text:
                raise ValueError("Empty response from model")

            grounded      = False
            search_queries = []
            try:
                for c in r.candidates or []:
                    meta = getattr(c, "grounding_metadata", None)
                    if meta:
                        grounded = True
                        for chunk in getattr(meta, "search_entry_point", []) or []:
                            if hasattr(chunk, "rendered_content"):
                                search_queries.append(chunk.rendered_content[:80])
            except Exception:
                pass

            payload = extract_json(raw_text)
            if grounded:
                payload["_grounded"] = True
            if search_queries:
                payload["_search_queries"] = search_queries[:3]
            yield f"data: {json.dumps({'ok': True, 'payload': payload})}\n\n"

        except ValueError as ve:
            print(f"[chat] value error: {ve}")
            _fb = {"ok": False, "error": str(ve), "payload": {"mode": "chat", "aria_message": "I didn't catch that - could you rephrase?"}}
            yield "data: " + json.dumps(_fb) + "\n\n"
        except Exception as e:
            traceback.print_exc()
            yield f"data: {json.dumps({'ok': False, 'error': str(e)[:120], 'payload': {'mode': 'chat', 'aria_message': 'Something went wrong — please try again.'}})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(gen()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":    "no-cache, no-transform",
            "X-Accel-Buffering":"no",
            "Connection":       "keep-alive",
        },
    )
