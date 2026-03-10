from data.templates import TEMPLATES

LIVE_TOOLS = [{"function_declarations": [
    {
        "name": "toggle_camera",
        "description": "Turns the user's webcam on or off. When enabled you receive live video frames. Always confirm.",
        "parameters": {"type": "object", "properties": {"enabled": {"type": "boolean"}}, "required": ["enabled"]},
    },
    {
        "name": "list_screens",
        "description": "Lists all available monitors the user can share. Call before capture_screen.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "capture_screen",
        "description": "Captures a specific monitor by index (1,2,3…) or 'manual' for browser picker.",
        "parameters": {"type": "object", "properties": {"screen": {"type": "string"}}, "required": ["screen"]},
    },
    {
        "name": "stop_screen",
        "description": "Stops any active screen sharing.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "capture_frame_for_story",
        "description": (
            "Captures the current camera or screen frame and saves it as a reference image "
            "for story generation. Use when the user says: 'save this', 'note this', "
            "'use what you see', 'capture this for my story', 'make a story from this', "
            "'turn this into a scene', 'use my screen for the story', 'use my camera'. "
            "After capturing, describe what you see and ask how to use it in the story."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "source": {
                    "type": "string",
                    "enum": ["camera", "screen"],
                    "description": "Which source to capture: camera or screen",
                }
            },
            "required": ["source"],
        },
    },
    {
        "name": "use_captured_frame_as_story",
        "description": (
            "Takes the most recently captured frame and sends it to ARIA to generate a story scene. "
            "Use when user says 'generate from this', 'make it a video', 'animate this', "
            "'create a scene from what you see', 'turn this into an image/video'. "
            "Specify creative_intent to guide generation."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "creative_intent": {
                    "type": "string",
                    "description": "What to do with the frame, e.g. 'generate a cinematic image'",
                }
            },
            "required": ["creative_intent"],
        },
    },

    # ── Browser Tabs ──────────────────────────────────────────────────────
    {"name": "list_tabs",   "description": "Lists all open browser tabs with index, title and URL.", "parameters": {"type": "object", "properties": {}}},
    {"name": "switch_tab",  "description": "Switches browser to a tab by index.", "parameters": {"type": "object", "properties": {"index": {"type": "integer"}}, "required": ["index"]}},
    {"name": "open_tab",    "description": "Opens a new browser tab with a given URL.", "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
    {"name": "close_tab",   "description": "Closes a browser tab by index.", "parameters": {"type": "object", "properties": {"index": {"type": "integer"}}, "required": ["index"]}},
    {"name": "screenshot_tab", "description": "Takes a screenshot of a specific browser tab for visual analysis.", "parameters": {"type": "object", "properties": {"index": {"type": "integer", "description": "Tab index, or -1 for current active tab"}}}},

    # ── UI Controls ───────────────────────────────────────────────────────
    {"name": "set_theme",   "description": "Set the app theme to dark or light mode.", "parameters": {"type": "object", "properties": {"theme": {"type": "string", "enum": ["dark", "light"]}}, "required": ["theme"]}},
    {
        "name": "set_view_mode",
        "description": (
            "Set the camera/screen view mode. "
            "Mode 'a' (Stealth): AI sees user but no preview shown. "
            "Mode 'b' (PiP): Picture-in-picture circle — user sees themselves. "
            "Mode 'c' (Split): Split screen — user sees camera/screen on left. "
            "Use 'b' or 'c' when user wants to see themselves."
        ),
        "parameters": {"type": "object", "properties": {"mode": {"type": "string", "enum": ["a", "b", "c"]}}, "required": ["mode"]},
    },
    {"name": "start_recording", "description": "Start recording the current session to video.", "parameters": {"type": "object", "properties": {}}},
    {"name": "stop_recording",  "description": "Stop the current recording and save it.",       "parameters": {"type": "object", "properties": {}}},

    # ── ARIA Story Controls ───────────────────────────────────────────────
    {"name": "aria_present",      "description": "Start the ARIA story presentation.",         "parameters": {"type": "object", "properties": {}}},
    {"name": "aria_stop_present", "description": "Stop the current ARIA presentation.",        "parameters": {"type": "object", "properties": {}}},
    {"name": "aria_clear",        "description": "Clear the entire ARIA story timeline.",       "parameters": {"type": "object", "properties": {}}},
    {"name": "aria_save_project", "description": "Save the current ARIA project to the cloud.","parameters": {"type": "object", "properties": {}}},
    {"name": "aria_switch_tab",   "description": "Switch between ARIA's Chat and Timeline tabs.", "parameters": {"type": "object", "properties": {"tab": {"type": "string", "enum": ["chat", "timeline"]}}, "required": ["tab"]}},
    {"name": "aria_open_projects","description": "Open the ARIA projects panel.",              "parameters": {"type": "object", "properties": {}}},
    {
        "name": "aria_send_chat",
        "description": (
            "Send a creative message to ARIA's AI chat system — PRIMARY way to generate story content via voice. "
            "Use for: creating scenes, generating images/videos, adding narration, building timelines."
        ),
        "parameters": {"type": "object", "properties": {"message": {"type": "string", "description": "The creative instruction to send to ARIA"}}, "required": ["message"]},
    },
    {
        "name": "aria_use_template",
        "description": (
            "Load an ARIA story template by ID. Pre-fills the chat with the template's prompt and attaches its reference image. "
            "Available IDs: " + ", ".join(t["id"] for t in TEMPLATES)
        ),
        "parameters": {"type": "object", "properties": {"template_id": {"type": "string"}}, "required": ["template_id"]},
    },
]}]
