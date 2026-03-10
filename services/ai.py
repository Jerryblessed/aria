import io
import re
import json
import wave
import base64

from google import genai
from google.genai import types
from config import GCP_PROJECT, GCP_LOCATION, GCP_LOCATION2, BRAIN, TTS

# ── Client instances ──────────────────────────────────────────────────────
client  = genai.Client(vertexai=True, project=GCP_PROJECT, location=GCP_LOCATION)
client2 = genai.Client(vertexai=True, project=GCP_PROJECT, location=GCP_LOCATION2)

# ── Prompts ───────────────────────────────────────────────────────────────
ARIA_SYS = """You are ARIA, a professional creative storytelling AI. Style: Clear, warm, wholesome.

CONTENT POLICY: Never produce blasphemous, adult, profane, violent, occult, or offensive content.
Decline politely and suggest a wholesome alternative.

CAPTURED FRAME INSTRUCTIONS:
When you receive an image annotated as a captured screenshot or camera frame:
- For SCREENSHOTS: Describe what is on screen briefly, then generate requested story content.
- For CAMERA FRAMES: Describe the person/scene briefly, then generate portrait story or narrative.
Always honour the user's creative_intent passed with the frame.

RESPONSE FORMAT: Single valid JSON object only — no markdown, no preamble.
{
  "mode": "chat" | "clarify" | "timeline" | "generate_image" | "generate_video" | "generate_text_scene",
  "aria_message": "1-2 clear sentences.",
  "clarifying_questions": [],
  "timeline_item": {
    "title": "",
    "narration": "50-70 words, present tense, vivid, sensory.",
    "generation_prompt": "Detailed visual prompt for image/video generation.",
    "aspect_ratio": "16:9",
    "text_overlay": "",
    "style_seed": "",
    "sort_order": 0,
    "duration_seconds": 8
  },
  "story_context": {"characters": [], "visual_style": "", "color_palette": ""},
  "presentation_config": {"order": "as_added", "total_duration_seconds": 0, "narrate": true}
}

RULES:
1. Files / images without clear action → mode "clarify"
2. NEVER generate media unless user says "generate", "create", "make image/video"
3. Ambiguous → always ask first (clarify)
4. Keep aria_message to 1-2 sentences
5. Output ONLY valid JSON."""

NARR_SYS = "You are a warm, professional narrator. Pace: Measured. Tone: Sincere, inspiring.\n\nTRANSCRIPT:\n"


# ── Helpers ───────────────────────────────────────────────────────────────

def extract_json(text: str) -> dict:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.MULTILINE)
    t = re.sub(r"\s*```$",          "", t, flags=re.MULTILINE).strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", t)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    raise ValueError(f"No JSON found in response: {t[:200]}")


def wav_encode(pcm: bytes, rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(sample_width)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def tts_narrate(script: str) -> bytes:
    """Generate narration audio for a script; returns raw WAV bytes."""
    r = client2.models.generate_content(
        model=TTS,
        contents=NARR_SYS + script,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
                )
            ),
        ),
    )
    pcm = r.candidates[0].content.parts[0].inline_data.data
    return wav_encode(pcm)
