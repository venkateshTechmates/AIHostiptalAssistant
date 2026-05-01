"""Unicode-script-based language detector.

Zero-dependency detector for the four kiosk languages: en, te, hi, ta.
Counts characters in each Unicode script range and returns the dominant lang.
"""

from __future__ import annotations

SUPPORTED = ("en", "te", "hi", "ta")


def _count_scripts(text: str) -> dict[str, int]:
    counts = {"te": 0, "hi": 0, "ta": 0, "en": 0, "other": 0}
    for ch in text:
        cp = ord(ch)
        if 0x0C00 <= cp <= 0x0C7F:          # Telugu
            counts["te"] += 1
        elif 0x0900 <= cp <= 0x097F:        # Devanagari (Hindi)
            counts["hi"] += 1
        elif 0x0B80 <= cp <= 0x0BFF:        # Tamil
            counts["ta"] += 1
        elif 0x0041 <= cp <= 0x007A:        # Basic Latin (A-Z, a-z)
            counts["en"] += 1
        elif ch.isspace() or ch.isdigit() or ch in ".,!?;:'\"()-":
            continue
        else:
            counts["other"] += 1
    return counts


# Transliterated language-preference keywords. If the user says these in
# English (e.g. "I want Telugu", "speak Hindi", "Tamil please"), we honour
# the request and switch the kiosk language. This is essential because
# browser STT in auto mode only captures one locale at a time, so users
# who haven't yet switched STT will speak about their preferred language
# in English rather than in that language.
_LANG_KEYWORDS = {
    "te": ("telugu", "telegu", "telungu", "తెలుగు"),
    "hi": ("hindi", "hindhi", "hindee", "हिन्दी", "हिंदी"),
    "ta": ("tamil", "tamizh", "tameel", "தமிழ்"),
    "en": ("english", "in english", "speak english"),
}


def detect_language(text: str, default: str = "en") -> str:
    """Return the dominant language code ('en' | 'te' | 'hi' | 'ta').

    Detection order:
    1. Native script wins (≥2 chars of Telugu/Hindi/Tamil → that language).
    2. Transliterated language name in the text ("I want Telugu" → 'te').
    3. Latin chars only → 'en'.
    4. Single non-Latin char → that script's language.
    """
    if not text or not text.strip():
        return default
    c = _count_scripts(text)
    for lang in ("te", "hi", "ta"):
        if c[lang] >= 2:
            return lang

    norm = text.lower()
    # Order: te/hi/ta first so an explicit non-English request beats a
    # generic English fallback. "english" check handled below.
    for lang in ("te", "hi", "ta"):
        if any(kw in norm for kw in _LANG_KEYWORDS[lang]):
            return lang
    if any(kw in norm for kw in _LANG_KEYWORDS["en"]):
        return "en"

    if c["en"] > 0:
        return "en"
    for lang in ("te", "hi", "ta"):
        if c[lang] > 0:
            return lang
    return default
