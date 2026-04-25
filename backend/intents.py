"""Rule-based intent router (used as a fallback when GPT-4o is unavailable).

Reads departments, doctors, and FAQs from the SQLite store. Same response
shape as the AI module, so the frontend is agnostic.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

import db
from seed_data import EMERGENCY_KEYWORDS, VISITING_HOURS

# Languages supported throughout the kiosk.
SUPPORTED = ("en", "te", "hi", "ta")

_ASCII_RE = re.compile(r"^[a-z0-9 .'-]+$")


def _normalise(text: str) -> str:
    nfkc = unicodedata.normalize("NFKC", text or "")
    return " ".join(nfkc.lower().split())


def _contains_keyword(haystack: str, needle: str) -> bool:
    n = _normalise(needle)
    if not n:
        return False
    if _ASCII_RE.fullmatch(n):
        pattern = r"\b" + re.escape(n) + r"\b"
        return re.search(pattern, haystack) is not None
    return n in haystack


def _t(d: dict[str, str], lang: str) -> str:
    return d.get(lang) or d.get("en") or next(iter(d.values()))


# ---------------------------------------------------------------------------
# Localised follow-up cards
# ---------------------------------------------------------------------------

_FOLLOW_UP = {
    "en": [
        {"id": "repeat", "label": "Repeat", "icon": "🔁"},
        {"id": "qr", "label": "Send to my phone", "icon": "📱"},
        {"id": "more", "label": "Anything else?", "icon": "💬"},
        {"id": "done", "label": "Done", "icon": "✅"},
    ],
    "te": [
        {"id": "repeat", "label": "మళ్ళీ చెప్పండి", "icon": "🔁"},
        {"id": "qr", "label": "నా ఫోన్‌కి పంపండి", "icon": "📱"},
        {"id": "more", "label": "ఇంకేమైనా?", "icon": "💬"},
        {"id": "done", "label": "అయిపోయింది", "icon": "✅"},
    ],
    "hi": [
        {"id": "repeat", "label": "दोहराएँ", "icon": "🔁"},
        {"id": "qr", "label": "मेरे फ़ोन पर भेजें", "icon": "📱"},
        {"id": "more", "label": "और कुछ?", "icon": "💬"},
        {"id": "done", "label": "हो गया", "icon": "✅"},
    ],
    "ta": [
        {"id": "repeat", "label": "மீண்டும் சொல்லுங்கள்", "icon": "🔁"},
        {"id": "qr", "label": "என் தொலைபேசிக்கு அனுப்பு", "icon": "📱"},
        {"id": "more", "label": "வேறு ஏதாவது?", "icon": "💬"},
        {"id": "done", "label": "முடிந்தது", "icon": "✅"},
    ],
}

_EMERGENCY_OPTIONS = {
    "en": [
        {"id": "wheelchair_yes", "label": "Yes, wheelchair", "icon": "♿"},
        {"id": "wheelchair_no", "label": "No, I can walk", "icon": "🚶"},
        {"id": "call_staff", "label": "Call staff", "icon": "🙋"},
    ],
    "te": [
        {"id": "wheelchair_yes", "label": "అవును, వీల్‌చైర్", "icon": "♿"},
        {"id": "wheelchair_no", "label": "లేదు, నేను నడవగలను", "icon": "🚶"},
        {"id": "call_staff", "label": "సిబ్బందిని పిలవండి", "icon": "🙋"},
    ],
    "hi": [
        {"id": "wheelchair_yes", "label": "हाँ, व्हीलचेयर", "icon": "♿"},
        {"id": "wheelchair_no", "label": "नहीं, मैं चल सकता हूँ", "icon": "🚶"},
        {"id": "call_staff", "label": "स्टाफ़ बुलाएँ", "icon": "🙋"},
    ],
    "ta": [
        {"id": "wheelchair_yes", "label": "ஆம், சக்கர நாற்காலி", "icon": "♿"},
        {"id": "wheelchair_no", "label": "வேண்டாம், நடக்க முடியும்", "icon": "🚶"},
        {"id": "call_staff", "label": "ஊழியரை அழை", "icon": "🙋"},
    ],
}

_EMERGENCY_REPLY = {
    "en": "I've alerted staff. The Emergency Ward is on the ground floor, to your right past the main reception. Do you need a wheelchair?",
    "te": "నేను సిబ్బందికి తెలియజేశాను. ఎమర్జెన్సీ వార్డ్ గ్రౌండ్ ఫ్లోర్‌లో, మెయిన్ రిసెప్షన్ కుడి వైపున ఉంది. మీకు వీల్‌చైర్ అవసరమా?",
    "hi": "मैंने स्टाफ़ को सूचित कर दिया है। आपातकालीन विभाग भूतल पर है, मुख्य रिसेप्शन के दाईं ओर। क्या आपको व्हीलचेयर चाहिए?",
    "ta": "ஊழியர்களுக்கு தெரிவித்துள்ளேன். அவசர சிகிச்சை பிரிவு தரை தளத்தில், முதன்மை வரவேற்பு பகுதிக்கு வலது புறம் உள்ளது. சக்கர நாற்காலி தேவையா?",
}

_GREETING_REPLY = {
    "en": "Hello! How can I help you today? You can speak, or tap any of the options below.",
    "te": "నమస్కారం! నేను మీకు ఎలా సహాయం చేయగలను? మీరు మాట్లాడవచ్చు లేదా క్రింద ఉన్న ఏదైనా ఎంపికను నొక్కవచ్చు.",
    "hi": "नमस्ते! मैं आपकी कैसे मदद कर सकता हूँ? आप बोल सकते हैं या नीचे कोई विकल्प चुन सकते हैं।",
    "ta": "வணக்கம்! நான் உங்களுக்கு எப்படி உதவ முடியும்? பேசலாம் அல்லது கீழுள்ள விருப்பங்களை தொடலாம்.",
}

_FALLBACK_REPLY = {
    "en": "I didn't catch that. You can say things like \"OPD\", \"pharmacy\", or \"find a cardiologist\", or tap any option below.",
    "te": "నేను అర్థం చేసుకోలేకపోయాను. మీరు 'ఓపీడీ', 'ఫార్మసీ', 'కార్డియాలజిస్ట్‌ను కనుగొనండి' అని చెప్పవచ్చు లేదా క్రింద ఏదైనా ఎంపికను నొక్కవచ్చు.",
    "hi": "क्षमा करें, मैं समझ नहीं पाया। आप 'ओपीडी', 'फार्मेसी', 'डॉक्टर ढूँढें' जैसा कह सकते हैं या नीचे कोई विकल्प चुन सकते हैं।",
    "ta": "புரியவில்லை. 'OPD', 'மருந்தகம்', 'இதய மருத்துவரை கண்டுபிடி' போன்றவற்றை சொல்லலாம் அல்லது கீழே ஒரு விருப்பத்தை தட்டலாம்.",
}

_GREETINGS = {
    "hello", "hi", "hey", "hola",
    "namaste", "नमस्ते", "नमस्कार", "हेलो",
    "నమస్కారం", "హలో",
    "வணக்கம்",
}

_VISITING_KEYS = {
    "visiting hours", "visit", "visiting",
    "मिलने का समय", "मिलने",
    "సందర్శన సమయం", "సందర్శన",
    "சந்திப்பு நேரம்", "சந்திப்பு",
}


def _emergency_response(lang: str) -> dict[str, Any]:
    return {
        "reply": _EMERGENCY_REPLY.get(lang, _EMERGENCY_REPLY["en"]),
        "intent": "emergency",
        "options": _EMERGENCY_OPTIONS.get(lang, _EMERGENCY_OPTIONS["en"]),
        "map_target": "emergency",
        "alert": True,
        "data": None,
    }


def _greeting_response(lang: str) -> dict[str, Any]:
    return {
        "reply": _GREETING_REPLY.get(lang, _GREETING_REPLY["en"]),
        "intent": "greeting",
        "options": [],
        "map_target": None,
        "alert": False,
        "data": None,
    }


def _fallback_response(lang: str) -> dict[str, Any]:
    return {
        "reply": _FALLBACK_REPLY.get(lang, _FALLBACK_REPLY["en"]),
        "intent": "fallback",
        "options": [],
        "map_target": None,
        "alert": False,
        "data": None,
    }


def _visiting_hours_response(lang: str) -> dict[str, Any]:
    return {
        "reply": VISITING_HOURS.get(lang, VISITING_HOURS["en"]),
        "intent": "visiting_hours",
        "options": _FOLLOW_UP.get(lang, _FOLLOW_UP["en"]),
        "map_target": "wards",
        "alert": False,
        "data": None,
    }


def _department_response(dept: dict, lang: str) -> dict[str, Any]:
    name = _t(dept["name"], lang)
    directions = _t(dept["directions"], lang)
    return {
        "reply": f"{name}. {directions}",
        "intent": f"navigate.{dept['id']}",
        "options": _FOLLOW_UP.get(lang, _FOLLOW_UP["en"]),
        "map_target": dept["map_id"],
        "alert": False,
        "data": {"department_id": dept["id"], "floor": dept["floor"]},
    }


def _match_department(text: str, lang: str) -> dict | None:
    norm = _normalise(text)
    for dept in db.all_departments():
        # Try the user's language first, then fall through to all aliases.
        ordered: list[str] = []
        seen: set[str] = set()
        for L in (lang, *(L for L in SUPPORTED if L != lang)):
            for k in dept["aliases"].get(L, []):
                if k not in seen:
                    ordered.append(k)
                    seen.add(k)
        if any(_contains_keyword(norm, k) for k in ordered):
            return dept
    return None


def _match_doctors(text: str) -> list[dict]:
    norm = _normalise(text)
    hits: list[dict] = []
    for d in db.all_doctors():
        if any(_contains_keyword(norm, k) for k in d["specialty_keys"]):
            hits.append(d)
            continue
        last_en = d["name"]["en"].split()[-1]
        if last_en and _contains_keyword(norm, last_en):
            hits.append(d)
    seen: set[str] = set()
    out: list[dict] = []
    for d in hits:
        if d["id"] not in seen:
            seen.add(d["id"])
            out.append(d)
    return out


def _doctor_response(doctors: list[dict], lang: str) -> dict[str, Any]:
    options = []
    for d in doctors[:4]:
        slot = d["slots_today"][0] if d["slots_today"] else ""
        label = f"{_t(d['name'], lang)} — {slot}" if slot else _t(d["name"], lang)
        options.append({"id": d["id"], "label": label, "icon": "👨‍⚕️", "kind": "doctor"})

    if not doctors:
        msgs = {
            "en": "I couldn't find a doctor for that today. Want to look up another department?",
            "te": "ఈ రోజు ఆ వైద్యునిని కనుగొనలేకపోయాను. వేరే విభాగం చూడాలనుకుంటున్నారా?",
            "hi": "आज उस विशेषज्ञता में कोई डॉक्टर नहीं मिला। क्या आप कोई दूसरा विभाग देखना चाहेंगे?",
            "ta": "இன்று அந்த நிபுணர் இல்லை. வேறு பிரிவை தேட விரும்புகிறீர்களா?",
        }
        return {"reply": msgs.get(lang, msgs["en"]), "intent": "find_doctor", "options": [], "map_target": "opd", "alert": False, "data": None}

    if len(doctors) == 1:
        d = doctors[0]
        msgs = {
            "en": f"{_t(d['name'], 'en')} ({_t(d['specialty'], 'en')}) is in room {d['room']}. Next slot at {d['slots_today'][0]}.",
            "te": f"{_t(d['name'], 'te')} ({_t(d['specialty'], 'te')}) రూమ్ {d['room']} లో ఉన్నారు. తదుపరి స్లాట్ {d['slots_today'][0]} గంటలకు.",
            "hi": f"{_t(d['name'], 'hi')} ({_t(d['specialty'], 'hi')}) कक्ष {d['room']} में हैं। अगला स्लॉट {d['slots_today'][0]} बजे।",
            "ta": f"{_t(d['name'], 'ta')} ({_t(d['specialty'], 'ta')}) அறை {d['room']} இல் உள்ளார். அடுத்த நேரம் {d['slots_today'][0]}.",
        }
        return {"reply": msgs.get(lang, msgs["en"]), "intent": "find_doctor", "options": _FOLLOW_UP.get(lang, _FOLLOW_UP["en"]), "map_target": "opd", "alert": False, "data": {"doctor_id": d["id"]}}

    msgs = {
        "en": "I found a few doctors available today. Please pick one.",
        "te": "ఈ రోజు కొంతమంది వైద్యులు అందుబాటులో ఉన్నారు. దయచేసి ఒకరిని ఎంచుకోండి.",
        "hi": "मुझे आज के लिए कुछ डॉक्टर मिले हैं। कृपया एक चुनें।",
        "ta": "இன்று சில மருத்துவர்கள் கிடைக்கின்றனர். ஒருவரை தேர்ந்தெடுக்கவும்.",
    }
    return {
        "reply": msgs.get(lang, msgs["en"]),
        "intent": "find_doctor",
        "options": options,
        "map_target": "opd",
        "alert": False,
        "data": {"doctors": [{"id": d["id"], "name": _t(d["name"], lang), "specialty": _t(d["specialty"], lang), "room": d["room"], "slots_today": d["slots_today"]} for d in doctors]},
    }


def route(text: str, lang: str = "en") -> dict[str, Any]:
    if lang not in SUPPORTED:
        lang = "en"
    norm = _normalise(text)
    if not norm:
        return _fallback_response(lang)

    if any(_contains_keyword(norm, kw) for kw in EMERGENCY_KEYWORDS):
        return _emergency_response(lang)

    if any(g == norm or norm.startswith(g + " ") for g in _GREETINGS):
        return _greeting_response(lang)

    if any(_contains_keyword(norm, k) for k in _VISITING_KEYS):
        return _visiting_hours_response(lang)

    doctor_keywords = ("doctor", "dr", "see a", "appointment", "specialist",
                       "డాక్టర్", "డా.", "अपॉइंटमेंट", "डॉक्टर", "மருத்துவர்")
    if any(_contains_keyword(norm, k) for k in doctor_keywords) or _match_doctors(norm):
        hits = _match_doctors(norm)
        if hits:
            return _doctor_response(hits, lang)
        return _doctor_response(db.all_doctors(), lang)

    dept = _match_department(norm, lang)
    if dept is not None:
        return _department_response(dept, lang)

    # Last-ditch FAQ keyword search before giving up.
    faqs = db.search_faqs(norm, limit=1)
    if faqs:
        faq = faqs[0]
        return {
            "reply": _t(faq["a"], lang),
            "intent": "faq",
            "options": _FOLLOW_UP.get(lang, _FOLLOW_UP["en"]),
            "map_target": None,
            "alert": False,
            "data": {"faq_id": faq["id"]},
        }

    return _fallback_response(lang)


def card_action(card_id: str, lang: str) -> dict[str, Any]:
    if lang not in SUPPORTED:
        lang = "en"

    if card_id == "emergency":
        return _emergency_response(lang)
    if card_id == "visiting_hours":
        return _visiting_hours_response(lang)
    if card_id == "doctor":
        return _doctor_response(db.all_doctors(), lang)

    dept = db.get_department(card_id)
    if dept is not None:
        return _department_response(dept, lang)

    doc = db.get_doctor(card_id)
    if doc is not None:
        slots = ", ".join(doc["slots_today"])
        msgs = {
            "en": f"{_t(doc['name'], 'en')} is in room {doc['room']}. Today's slots: {slots}. Please collect a token at reception with your name.",
            "te": f"{_t(doc['name'], 'te')} రూమ్ {doc['room']} లో ఉన్నారు. ఈ రోజు స్లాట్‌లు: {slots}. దయచేసి రిసెప్షన్ వద్ద మీ పేరుతో టోకెన్ తీసుకోండి.",
            "hi": f"{_t(doc['name'], 'hi')} कक्ष {doc['room']} में हैं। आज के स्लॉट: {slots}। कृपया रिसेप्शन पर अपना नाम बताकर टोकन लें।",
            "ta": f"{_t(doc['name'], 'ta')} அறை {doc['room']} இல் உள்ளார். இன்றைய நேரம்: {slots}. வரவேற்பறையில் உங்கள் பெயரைச் சொல்லி டோக்கன் பெறவும்.",
        }
        return {
            "reply": msgs.get(lang, msgs["en"]),
            "intent": f"doctor.{doc['id']}",
            "options": _FOLLOW_UP.get(lang, _FOLLOW_UP["en"]),
            "map_target": "opd",
            "alert": False,
            "data": {"doctor_id": doc["id"], "room": doc["room"]},
        }

    if card_id in {"wheelchair_yes", "call_staff"}:
        msgs = {
            "en": "Okay, I've alerted staff. Please wait here, someone will be with you shortly.",
            "te": "సరే, నేను సిబ్బందికి తెలియజేశాను. దయచేసి ఇక్కడ ఉండండి, త్వరలో ఎవరైనా వస్తారు.",
            "hi": "ठीक है, मैंने स्टाफ़ को सूचित कर दिया है। कृपया यहीं प्रतीक्षा करें।",
            "ta": "சரி, ஊழியர்களுக்கு தெரிவித்துள்ளேன். தயவுசெய்து இங்கே காத்திருக்கவும்.",
        }
        return {"reply": msgs.get(lang, msgs["en"]), "intent": "staff_alerted", "options": [], "map_target": "emergency", "alert": True, "data": None}
    if card_id == "wheelchair_no":
        em = db.get_department("emergency")
        return _department_response(em, lang) if em else _fallback_response(lang)

    if card_id == "repeat":
        return {"reply": "", "intent": "repeat", "options": [], "map_target": None, "alert": False, "data": None}
    if card_id == "done":
        msgs = {"en": "Thank you. Take care.", "te": "ధన్యవాదాలు. జాగ్రత్త.", "hi": "धन्यवाद। आपका स्वस्थ होना ही हमारी प्राथमिकता है।", "ta": "நன்றி. கவனமாக இருங்கள்."}
        return {"reply": msgs.get(lang, msgs["en"]), "intent": "done", "options": [], "map_target": None, "alert": False, "data": None}
    if card_id == "more":
        return _greeting_response(lang)

    return _fallback_response(lang)
