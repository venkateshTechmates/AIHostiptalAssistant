"""FastAPI entry point for the hospital kiosk."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Load .env BEFORE importing modules that read env on import (ai, tts).
load_dotenv()

import ai  # noqa: E402
import db  # noqa: E402
import intents  # noqa: E402
import lang_detect  # noqa: E402
import patients  # noqa: E402
import stt  # noqa: E402
import tts  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("hospital-kiosk")

db.init_db()

app = FastAPI(title="NIMS Hospital Guidance Kiosk API", version="3.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

Lang = Literal["en", "te", "hi", "ta", "auto"]
ResolvedLang = Literal["en", "te", "hi", "ta"]


class IntentRequest(BaseModel):
    text: str = Field(..., description="Raw transcript or typed text from the kiosk.")
    language: Lang = "en"
    kiosk_id: str | None = None
    session_id: str | None = None


class CardRequest(BaseModel):
    card_id: str
    language: Lang = "en"
    kiosk_id: str | None = None


class TTSRequest(BaseModel):
    text: str
    language: Lang = "en"


class IntentResponse(BaseModel):
    reply: str
    intent: str
    options: list[dict[str, Any]] = []
    map_target: str | None = None
    alert: bool = False
    data: dict[str, Any] | None = None
    engine: str = "rules"
    detected_language: str | None = None


def _resolve_language(lang: str, text: str) -> str:
    """Convert 'auto' to a concrete language code via script detection."""
    if lang == "auto":
        return lang_detect.detect_language(text)
    if lang in ("en", "te", "hi", "ta"):
        return lang
    return "en"


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "time": datetime.utcnow().isoformat() + "Z",
        "ai_enabled": ai.is_enabled(),
        "tts_enabled": tts.is_enabled(),
        "languages": list(intents.SUPPORTED) + ["auto"],
    }


@app.get("/api/departments")
def list_departments(language: ResolvedLang = "en") -> list[dict[str, Any]]:
    return [
        {
            "id": d["id"],
            "name": d["name"].get(language, d["name"]["en"]),
            "floor": d["floor"],
            "map_id": d["map_id"],
        }
        for d in db.all_departments()
    ]


@app.get("/api/doctors")
def list_doctors(specialty: str | None = None, language: ResolvedLang = "en") -> list[dict[str, Any]]:
    out = []
    for d in db.all_doctors():
        if specialty and specialty.lower() not in [s.lower() for s in d["specialty_keys"]]:
            continue
        out.append(
            {
                "id": d["id"],
                "name": d["name"].get(language, d["name"]["en"]),
                "specialty": d["specialty"].get(language, d["specialty"]["en"]),
                "room": d["room"],
                "slots_today": d["slots_today"],
            }
        )
    return out


@app.post("/api/intent", response_model=IntentResponse)
def handle_intent(req: IntentRequest) -> IntentResponse:
    resolved = _resolve_language(req.language, req.text)
    session_id = req.session_id or req.kiosk_id
    log.info(
        "intent kiosk=%s session=%s lang=%s(req=%s) text=%r ai=%s",
        req.kiosk_id, session_id, resolved, req.language, req.text, ai.is_enabled(),
    )
    if ai.is_enabled():
        result = ai.chat(req.text, resolved, req.kiosk_id, session_id)
        engine = "gpt-4o"
    else:
        result = intents.route(req.text, resolved)
        engine = "rules"
    if result.get("alert"):
        log.warning("EMERGENCY ALERT kiosk=%s text=%r", req.kiosk_id, req.text)
        db.log_staff_alert(req.kiosk_id, result.get("intent", "emergency"), resolved, {"text": req.text})
    return IntentResponse(**result, engine=engine, detected_language=resolved)


@app.post("/api/card", response_model=IntentResponse)
def handle_card(req: CardRequest) -> IntentResponse:
    # Cards are tap inputs (no free-text), so 'auto' just falls back to en.
    resolved = req.language if req.language != "auto" else "en"
    log.info("card kiosk=%s lang=%s id=%s", req.kiosk_id, resolved, req.card_id)
    result = intents.card_action(req.card_id, resolved)
    if result.get("alert"):
        log.warning("EMERGENCY ALERT (card) kiosk=%s card=%s", req.kiosk_id, req.card_id)
        db.log_staff_alert(req.kiosk_id, result.get("intent", "emergency"), resolved, {"card_id": req.card_id})
    return IntentResponse(**result, engine="rules", detected_language=resolved)


@app.post("/api/tts")
def synthesize(req: TTSRequest):
    """Return MP3 audio for the given text. 204 if TTS not configured."""
    if not tts.is_enabled():
        return Response(status_code=204)
    resolved = req.language if req.language != "auto" else lang_detect.detect_language(req.text)
    audio = tts.synthesize(req.text, resolved)
    if audio is None:
        return Response(status_code=204)
    return Response(content=audio, media_type="audio/mpeg")


@app.post("/api/stt")
async def speech_to_text(
    audio: UploadFile = File(...),
    language: str = Form("auto"),
) -> dict[str, Any]:
    """Server-side STT via OpenAI Whisper.

    Used by the frontend in "Auto" mode where browser SpeechRecognition
    can't auto-detect language (it transcribes everything using whichever
    locale is set). Whisper detects the spoken language from the audio.
    """
    if not stt.is_enabled():
        return {"text": "", "language": "en", "error": "stt_disabled"}
    audio_bytes = await audio.read()
    try:
        text, detected = stt.transcribe(audio_bytes, audio.filename or "audio.webm")
    except Exception as e:
        log.warning("Whisper STT failed: %s", e)
        return {"text": "", "language": "en", "error": str(e)}
    return {"text": text, "language": detected}


# ---------------------------------------------------------------------------
# Patient registration & recognition (face-api.js descriptors)
# ---------------------------------------------------------------------------

class RecognizeRequest(BaseModel):
    descriptor: list[float]
    kiosk_id: str | None = None
    session_id: str | None = None
    language: str = "en"


@app.post("/api/patients/recognize")
def recognize_patient(req: RecognizeRequest) -> dict[str, Any]:
    """Look up a patient by face descriptor. Returns name + greeting on match."""
    match = patients.find_match(req.descriptor)
    if not match:
        return {"matched": False}
    db.log_patient_visit(
        match["id"], req.kiosk_id, req.session_id, req.language, match["distance"]
    )
    patient = db.get_patient(match["id"])
    return {
        "matched": True,
        "id": match["id"],
        "name": match["name"],
        "distance": match["distance"],
        "visit_count": patient["visit_count"] if patient else 1,
        "language": patient["language"] if patient else "en",
    }


@app.post("/api/patients/register")
async def register_patient(
    name: str = Form(...),
    age: str = Form(""),
    phone: str = Form(""),
    reason: str = Form(""),
    language: str = Form("en"),
    descriptor: str = Form(...),       # JSON-encoded list of 128 floats
    image: UploadFile = File(None),
) -> dict[str, Any]:
    import json as _json
    try:
        desc = _json.loads(descriptor)
    except Exception:
        return {"ok": False, "error": "invalid descriptor"}
    if not isinstance(desc, list) or len(desc) != 128:
        return {"ok": False, "error": "descriptor must be 128 floats"}

    image_path: str | None = None
    if image is not None:
        image_bytes = await image.read()
        if image_bytes:
            ext = "jpg"
            if image.filename and "." in image.filename:
                ext = image.filename.rsplit(".", 1)[-1].lower()
                if ext not in ("jpg", "jpeg", "png", "webp"):
                    ext = "jpg"
            image_path = patients.save_image(image_bytes, ext=ext)

    age_i: int | None = None
    if age and age.strip().isdigit():
        age_i = int(age.strip())

    patient_id = db.register_patient(
        name=name.strip(),
        age=age_i,
        phone=phone.strip() or None,
        reason=reason.strip() or None,
        language=language if language in ("en", "te", "hi", "ta") else "en",
        descriptor=desc,
        image_path=image_path,
    )
    log.info("registered patient id=%s name=%r", patient_id, name)
    return {"ok": True, "id": patient_id, "name": name, "image_path": image_path}


@app.get("/api/patients")
def list_patients() -> list[dict[str, Any]]:
    """List all registered patients (admin)."""
    return db.all_patients()


@app.get("/api/patients/{patient_id}/photo")
def patient_photo(patient_id: int):
    p = db.get_patient(patient_id)
    if not p or not p.get("image_path"):
        return Response(status_code=404)
    fpath = patients.absolute_image_path(p["image_path"])
    if not fpath:
        return Response(status_code=404)
    media = "image/jpeg"
    if fpath.suffix.lower() == ".png":
        media = "image/png"
    elif fpath.suffix.lower() == ".webp":
        media = "image/webp"
    return Response(content=fpath.read_bytes(), media_type=media)


@app.post("/api/staff-alert")
def staff_alert(payload: dict[str, Any]) -> dict[str, Any]:
    alert_id = db.log_staff_alert(payload.get("kiosk_id"), "manual", payload.get("language", "en"), payload)
    log.warning("STAFF ALERT %s", payload)
    return {"acknowledged": True, "ticket": f"ALERT-{alert_id}"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        reload_includes=["*.py"],
        reload_excludes=["*.db", "*.log", "*.xlsx", "data/*", "__pycache__/*"],
    )
