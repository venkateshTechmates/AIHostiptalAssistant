"""OpenAI TTS wrapper.

Returns MP3 audio bytes for a given text + language. The frontend plays the
audio in an <audio> element, then hooks a Web Audio analyser to drive the
avatar's mouth movement. If no API key is configured, the endpoint signals
the frontend to use the browser's `speechSynthesis` instead.
"""

from __future__ import annotations

import logging
import os

log = logging.getLogger("hospital-kiosk.tts")

try:
    from openai import OpenAI  # type: ignore
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
_MODEL = os.environ.get("OPENAI_TTS_MODEL", "tts-1")
_VOICE = os.environ.get("OPENAI_TTS_VOICE", "nova")  # warm female default

_client = OpenAI(api_key=_API_KEY) if (OpenAI and _API_KEY) else None


def is_enabled() -> bool:
    return _client is not None


def synthesize(text: str, lang: str = "en") -> bytes | None:
    """Return MP3 bytes, or None if the TTS engine is not configured."""
    if not _client or not text.strip():
        return None
    try:
        resp = _client.audio.speech.create(
            model=_MODEL,
            voice=_VOICE,
            input=text,
            response_format="mp3",
        )
        # OpenAI returns an HttpxBinaryResponseContent — read raw bytes.
        return resp.read() if hasattr(resp, "read") else bytes(resp.content)
    except Exception as e:
        log.warning("TTS failure for lang=%s: %s", lang, e)
        return None
