"""OpenAI Whisper STT wrapper.

Whisper auto-detects the spoken language from the audio itself, which is
essential for the "Auto" language button — browser SpeechRecognition can't
do this (it transcribes everything using whichever locale you set).

Returns (transcript, detected_lang) given audio bytes.
"""

from __future__ import annotations

import io
import logging
import os

log = logging.getLogger("hospital-kiosk.stt")

try:
    from openai import OpenAI  # type: ignore
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
_MODEL = os.environ.get("OPENAI_STT_MODEL", "whisper-1")
_client = OpenAI(api_key=_API_KEY) if (OpenAI and _API_KEY) else None

# Whisper returns ISO-639-1 codes (e.g. "en", "te", "hi", "ta"). Map any
# unsupported codes to the closest kiosk language.
_LANG_MAP = {
    "en": "en", "english": "en",
    "te": "te", "telugu": "te",
    "hi": "hi", "hindi": "hi",
    "ta": "ta", "tamil": "ta",
}


def is_enabled() -> bool:
    return _client is not None


def transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> tuple[str, str]:
    """Return (transcript, detected_lang). Raises on failure."""
    if not _client:
        raise RuntimeError("Whisper STT is not configured (no OPENAI_API_KEY)")
    if not audio_bytes:
        return "", "en"

    buf = io.BytesIO(audio_bytes)
    buf.name = filename  # OpenAI SDK uses the filename to infer mime type
    resp = _client.audio.transcriptions.create(
        model=_MODEL,
        file=buf,
        response_format="verbose_json",  # includes detected language
    )
    text = (getattr(resp, "text", "") or "").strip()
    raw_lang = (getattr(resp, "language", "") or "").lower()
    lang = _LANG_MAP.get(raw_lang, "en")
    log.info("whisper transcript=%r lang=%s (raw=%s)", text[:60], lang, raw_lang)
    return text, lang
