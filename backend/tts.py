"""OpenAI TTS wrapper.

Uses `gpt-4o-mini-tts` (newer, supports `instructions` for voice styling) by
default. The kiosk's voice is tuned to mimic the iconic Indian Railway
station-announcer cadence — slow, formal, public-address style — via the
`OPENAI_TTS_INSTRUCTIONS` env var with a sensible default.

Returns MP3 bytes for a given text. The frontend plays the audio and hooks
a Web Audio analyser to drive the avatar's lip-sync. If no API key is
configured, the endpoint signals the frontend to use the browser's
`speechSynthesis` instead.
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
_MODEL = os.environ.get("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
_VOICE = os.environ.get("OPENAI_TTS_VOICE", "sage")  # formal, calm, clear
_SPEED = float(os.environ.get("OPENAI_TTS_SPEED", "0.92"))  # railway announcers speak slow

# Languages OpenAI TTS handles natively well (English).
# For Telugu, Hindi, Tamil we deliberately let the BROWSER handle TTS so it
# uses the OS-installed native voice (e.g. Microsoft Heera Telugu on Windows,
# or Lekha for Hindi). This sounds far more natural than an English-trained
# voice mispronouncing Indian-language phonemes.
_NATIVE_LANGS = {"en"}
_NON_NATIVE_LANGS = set((os.environ.get("OPENAI_TTS_NON_NATIVE", "te,hi,ta") or "").split(","))
_INSTRUCTIONS = os.environ.get(
    "OPENAI_TTS_INSTRUCTIONS",
    (
        "Speak in the calm, formal, deliberate cadence of an Indian Railway station "
        "announcer. Slow pace. Clear diction. Crisp, slightly drawn-out vowels. "
        "Polite, professional, public-address tone — as if announcing on a station "
        "PA system. Pause briefly between phrases. No emotion or filler — just clear "
        "information delivered warmly and authoritatively."
    ),
)

# `gpt-4o-mini-tts` supports `instructions`; the legacy `tts-1` family does not.
_INSTRUCTIONS_MODELS = {"gpt-4o-mini-tts"}

_client = OpenAI(api_key=_API_KEY) if (OpenAI and _API_KEY) else None


def is_enabled() -> bool:
    return _client is not None


def synthesize(text: str, lang: str = "en") -> bytes | None:
    """Return MP3 bytes, or None if the TTS engine is not configured.

    For Indian languages (te/hi/ta by default), returns None so the frontend
    falls back to browser `speechSynthesis` with the OS-native voice.
    """
    if not _client or not text.strip():
        return None
    if lang in _NON_NATIVE_LANGS:
        log.info("Skipping OpenAI TTS for lang=%s — using browser native voice", lang)
        return None
    kwargs = {
        "model": _MODEL,
        "voice": _VOICE,
        "input": text,
        "response_format": "mp3",
        "speed": _SPEED,
    }
    if _MODEL in _INSTRUCTIONS_MODELS and _INSTRUCTIONS:
        kwargs["instructions"] = _INSTRUCTIONS
    try:
        resp = _client.audio.speech.create(**kwargs)
        return resp.read() if hasattr(resp, "read") else bytes(resp.content)
    except TypeError:
        # Older SDK without `speed` or `instructions` — retry without them.
        kwargs.pop("instructions", None)
        kwargs.pop("speed", None)
        try:
            resp = _client.audio.speech.create(**kwargs)
            return resp.read() if hasattr(resp, "read") else bytes(resp.content)
        except Exception as e:
            log.warning("TTS retry failure for lang=%s: %s", lang, e)
            return None
    except Exception as e:
        log.warning("TTS failure for lang=%s: %s", lang, e)
        # If the new model isn't available, fall back to tts-1.
        if _MODEL != "tts-1":
            try:
                resp = _client.audio.speech.create(
                    model="tts-1",
                    voice=_VOICE if _VOICE in ("alloy", "echo", "fable", "onyx", "nova", "shimmer") else "nova",
                    input=text,
                    response_format="mp3",
                    speed=_SPEED,
                )
                return resp.read() if hasattr(resp, "read") else bytes(resp.content)
            except Exception as e2:
                log.warning("TTS fallback also failed: %s", e2)
        return None
