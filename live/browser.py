import asyncio
import base64
import threading

_pw_loop     = asyncio.new_event_loop()
threading.Thread(target=_pw_loop.run_forever, daemon=True).start()

_pw_instance = None
_pw_browser  = None
_pw_context  = None


async def _ensure_browser() -> bool:
    global _pw_instance, _pw_browser, _pw_context
    try:
        from playwright.async_api import async_playwright
        if _pw_browser and _pw_browser.is_connected():
            return True
        _pw_instance = await async_playwright().start()
        _pw_browser  = await _pw_instance.chromium.launch(headless=True, args=["--start-maximized"])
        _pw_context  = await _pw_browser.new_context()
        await _pw_context.new_page()
        return True
    except Exception as e:
        print(f"[playwright] {e}")
        return False


async def _get_tabs() -> list[dict]:
    if not await _ensure_browser():
        return []
    result = []
    for i, page in enumerate(_pw_context.pages):
        try:
            title = await page.title() or "New Tab"
        except Exception:
            title = "Tab"
        result.append({
            "index":  i,
            "title":  title,
            "url":    page.url,
            "active": i == len(_pw_context.pages) - 1,
        })
    return result


async def _switch_tab(idx: int) -> str:
    if not await _ensure_browser():
        return "Browser unavailable"
    pages = _pw_context.pages
    if 0 <= idx < len(pages):
        await pages[idx].bring_to_front()
        return f"Switched to tab {idx}"
    return "Tab not found"


async def _open_tab(url: str) -> str:
    if not await _ensure_browser():
        return "Browser unavailable"
    url = (url or "").strip()
    if not url or not url.startswith(("http://", "https://")):
        return "Error: Invalid URL. Must start with http:// or https://"
    try:
        page = await _pw_context.new_page()
        await page.goto(url, timeout=15000)
        await page.bring_to_front()
        return f"Opened {url}"
    except Exception as e:
        return f"Error opening tab: {str(e)[:80]}"


async def _close_tab(idx: int) -> str:
    if not await _ensure_browser():
        return "Browser unavailable"
    pages = _pw_context.pages
    if 0 <= idx < len(pages):
        await pages[idx].close()
        return f"Closed tab {idx}"
    return "Tab not found"


async def _screenshot_tab(idx: int) -> str | None:
    if not await _ensure_browser():
        return None
    pages = _pw_context.pages
    if idx == -1:
        idx = len(pages) - 1
    if 0 <= idx < len(pages):
        try:
            await pages[idx].bring_to_front()
            png = await pages[idx].screenshot(type="jpeg", quality=70)
            return base64.b64encode(png).decode()
        except Exception:
            pass
    return None


def run_async(coro):
    """Run a coroutine on the shared Playwright event loop and block until done."""
    return asyncio.run_coroutine_threadsafe(coro, _pw_loop).result(timeout=15)


# ── MSS server-side screen capture ───────────────────────────────────────

def get_screen_list() -> list[dict]:
    try:
        import mss as _mss
        with _mss.mss() as sct:
            screens = [
                {"index": str(i + 1), "label": f"Monitor {i + 1} ({m['width']}×{m['height']})"}
                for i, m in enumerate(sct.monitors[1:])
            ]
            screens.append({"index": "manual", "label": "Pick a window or app…"})
            return screens
    except Exception:
        return [{"index": "manual", "label": "Pick a window or app…"}]


def capture_mss_frame(screen_index: int) -> str | None:
    """Capture a monitor via MSS and return a base64 JPEG string, or None on failure."""
    try:
        import io
        import mss as _mss
        from PIL import Image as PI

        with _mss.mss() as sct:
            monitor = sct.monitors[screen_index]
            img     = sct.grab(monitor)
            pil     = PI.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")
            pil.thumbnail((960, 540))
            buf = io.BytesIO()
            pil.save(buf, format="JPEG", quality=60)
            return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None
