import asyncio
import base64
import time
import uuid
import json
import traceback

from google.genai import types
from flask_sock import Sock

from services.ai import client
from config import LIVE_MODEL
from live.tools import LIVE_TOOLS
from live.prompts import LIVE_SYSTEM
from live.browser import (
    _pw_loop, _get_tabs, _switch_tab, _open_tab, _close_tab,
    _screenshot_tab, get_screen_list, capture_mss_frame,
)

# In-memory captured frames shared across the process
captured_frames: dict = {}   # frame_id → {b64, source, ts}

sock = Sock()


def _trim_frames():
    """Keep at most 20 captured frames in memory."""
    if len(captured_frames) > 20:
        oldest = sorted(captured_frames.items(), key=lambda x: x[1]["ts"])
        for k, _ in oldest[: len(captured_frames) - 20]:
            del captured_frames[k]


def register(app):
    sock.init_app(app)

    @sock.route("/ws/live")
    def live_voice_ws(ws):
        _run_bridge(ws)


def _run_bridge(ws):
    """Synchronous entry point — runs the async bridge on the shared PW loop."""
    fut = asyncio.run_coroutine_threadsafe(_bridge(ws), _pw_loop)
    try:
        fut.result()
    except Exception as e:
        print(f"[live-ws] {e}")


async def _bridge(ws):
    mss_handle   = {"task": None, "stop": False}
    latest_frame = {"b64": None, "source": "camera"}
    _done        = asyncio.Event()
    loop         = asyncio.get_event_loop()

    def ws_send(payload: dict):
        try:
            ws.send(json.dumps(payload))
        except Exception:
            pass

    try:
        config = {
            "response_modalities": ["AUDIO"],
            "tools":               LIVE_TOOLS,
            "system_instruction":  LIVE_SYSTEM,
        }
        async with client.aio.live.connect(model=LIVE_MODEL, config=config) as session:

            # ── keepalive ─────────────────────────────────────────────────
            async def keepalive():
                while not _done.is_set():
                    await asyncio.sleep(20)
                    if _done.is_set():
                        break
                    try:
                        silence = b"\x00" * 320
                        await session.send_realtime_input(
                            audio=types.Blob(data=silence, mime_type="audio/pcm;rate=16000")
                        )
                    except Exception:
                        break

            # ── MSS capture loop ──────────────────────────────────────────
            async def mss_stream_loop(screen_index: int):
                mss_handle["stop"] = False
                while not mss_handle["stop"] and not _done.is_set():
                    try:
                        frame = await loop.run_in_executor(None, capture_mss_frame, screen_index)
                        if frame:
                            latest_frame["b64"]    = frame
                            latest_frame["source"] = "screen"
                            await session.send_realtime_input(
                                video=types.Blob(data=base64.b64decode(frame), mime_type="image/jpeg")
                            )
                            await loop.run_in_executor(None, ws_send, {"mss_frame": frame})
                    except Exception as e:
                        print(f"[mss] {e}")
                        break
                    await asyncio.sleep(0.8)

            # ── browser → Gemini ──────────────────────────────────────────
            async def from_browser():
                while not _done.is_set():
                    try:
                        raw = await loop.run_in_executor(None, ws.receive)
                    except Exception:
                        break
                    if not raw:
                        break

                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue

                    # Audio chunk
                    if "audio" in msg:
                        try:
                            await session.send_realtime_input(
                                audio=types.Blob(data=base64.b64decode(msg["audio"]), mime_type="audio/pcm;rate=16000")
                            )
                        except Exception as e:
                            print(f"[audio send] {e}")

                    # Camera / manual-screen frame from browser
                    if "video" in msg:
                        latest_frame["b64"]    = msg["video"]
                        latest_frame["source"] = "camera"
                        try:
                            await session.send_realtime_input(
                                video=types.Blob(data=base64.b64decode(msg["video"]), mime_type="image/jpeg")
                            )
                        except Exception as e:
                            print(f"[video send] {e}")
                        await loop.run_in_executor(None, ws_send, {"video_echo": msg["video"]})

                    if "get_screens" in msg:
                        screens = await loop.run_in_executor(None, get_screen_list)
                        await loop.run_in_executor(None, ws_send, {"screen_list": screens})

                    if "start_mss" in msg:
                        mss_handle["stop"] = True
                        if mss_handle["task"]:
                            mss_handle["task"].cancel()
                        await asyncio.sleep(0.1)
                        idx = int(msg["start_mss"])
                        mss_handle["task"] = asyncio.create_task(mss_stream_loop(idx))
                        await loop.run_in_executor(None, ws_send, {"status": f"Sharing Monitor {idx}…"})

                    if "stop_mss" in msg:
                        mss_handle["stop"] = True
                        if mss_handle["task"]:
                            mss_handle["task"].cancel()
                            mss_handle["task"] = None

                    # Playwright tab control
                    if "list_tabs"     in msg:
                        tabs = await _get_tabs()
                        await loop.run_in_executor(None, ws_send, {"tab_list": tabs})
                    if "switch_tab"    in msg:
                        r = await _switch_tab(int(msg["switch_tab"]))
                        await loop.run_in_executor(None, ws_send, {"status": r})
                    if "open_tab"      in msg:
                        r = await _open_tab(msg["open_tab"])
                        await loop.run_in_executor(None, ws_send, {"status": r})
                    if "close_tab"     in msg:
                        r = await _close_tab(int(msg["close_tab"]))
                        await loop.run_in_executor(None, ws_send, {"status": r})
                    if "screenshot_tab" in msg:
                        frame = await _screenshot_tab(int(msg.get("screenshot_tab", -1)))
                        if frame:
                            await session.send_realtime_input(
                                video=types.Blob(data=base64.b64decode(frame), mime_type="image/jpeg")
                            )
                            await loop.run_in_executor(None, ws_send, {"status": "Screenshot sent to AI."})

                    if "tool_resp" in msg:
                        tr = msg["tool_resp"]
                        try:
                            await session.send_tool_response(function_responses=[
                                types.FunctionResponse(
                                    id=tr["id"], name=tr["name"],
                                    response={"result": tr.get("result", "ok")},
                                )
                            ])
                        except Exception as e:
                            print(f"[tool_resp] {e}")

                _done.set()

            # ── Gemini → browser ──────────────────────────────────────────
            async def to_browser():
                while not _done.is_set():
                    try:
                        async for response in session.receive():
                            if _done.is_set():
                                break

                            sc = response.server_content
                            if sc:
                                if sc.interrupted:
                                    await loop.run_in_executor(None, ws_send, {"interrupt": True})
                                if sc.model_turn:
                                    for part in sc.model_turn.parts:
                                        if part.inline_data:
                                            b64 = base64.b64encode(part.inline_data.data).decode()
                                            await loop.run_in_executor(None, ws_send, {"audio": b64})

                            if response.tool_call:
                                for fc in response.tool_call.function_calls:
                                    args  = dict(fc.args)
                                    name  = fc.name
                                    fc_id = fc.id

                                    # Server-side: capture_frame_for_story
                                    if name == "capture_frame_for_story":
                                        source  = args.get("source", "camera")
                                        frame64 = latest_frame.get("b64")
                                        if frame64:
                                            fid = str(uuid.uuid4())
                                            captured_frames[fid] = {"b64": frame64, "source": source, "ts": time.time()}
                                            _trim_frames()
                                            await loop.run_in_executor(None, ws_send,
                                                {"captured_frame": {"frame_id": fid, "source": source}})
                                            result_msg = (
                                                f"Frame captured from {source}. frame_id={fid}. "
                                                "Describe what you see and ask how to use it in the story."
                                            )
                                        else:
                                            result_msg = f"No {source} frame available yet. Ask user to enable their {source} first."
                                        await session.send_tool_response(function_responses=[
                                            types.FunctionResponse(id=fc_id, name=name, response={"result": result_msg})
                                        ])
                                        continue

                                    # Server-side: use_captured_frame_as_story
                                    if name == "use_captured_frame_as_story":
                                        intent = args.get("creative_intent", "generate a cinematic image scene")
                                        if captured_frames:
                                            latest_cf = max(captured_frames.items(), key=lambda x: x[1]["ts"])
                                            fid = latest_cf[0]
                                            src = latest_cf[1]["source"]
                                            await loop.run_in_executor(None, ws_send,
                                                {"send_frame_to_story": {"frame_id": fid, "message": intent, "source": src}})
                                            result_msg = f"Sending captured {src} frame to ARIA with intent: {intent}"
                                        else:
                                            result_msg = "No captured frame found. Call capture_frame_for_story first."
                                        await session.send_tool_response(function_responses=[
                                            types.FunctionResponse(id=fc_id, name=name, response={"result": result_msg})
                                        ])
                                        continue

                                    # All other tools → forward to browser
                                    await loop.run_in_executor(None, ws_send,
                                        {"tool": {"id": fc_id, "name": name, "args": args}})

                    except Exception as e:
                        err = str(e)
                        if "1005" not in err and "1000" not in err:
                            print(f"[to_browser] {e}")
                        break

                _done.set()

            await asyncio.gather(from_browser(), to_browser(), keepalive())

    except Exception as e:
        print(f"[bridge error] {e}")
        traceback.print_exc()
        try:
            ws.send(json.dumps({"status": f"Connection error: {str(e)[:80]}"}))
        except Exception:
            pass
    finally:
        _done.set()
        if mss_handle["task"]:
            mss_handle["task"].cancel()
