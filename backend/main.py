"""FastAPI entry point for the hospital kiosk."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Load .env BEFORE importing modules that read env on import (ai, tts).
load_dotenv()

import ai  # noqa: E402
import db  # noqa: E402
import intents  # noqa: E402
import tts  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("hospital-kiosk")

db.init_db()

app = FastAPI(title="Hospital Guidance Kiosk API", version="3.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

Lang = Literal["en", "te", "hi", "ta"]


class IntentRequest(BaseModel):
    text: str = Field(..., description="Raw transcript or typed text from the kiosk.")
    language: Lang = "en"
    kiosk_id: str | None = None


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


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "time": datetime.utcnow().isoformat() + "Z",
        "ai_enabled": ai.is_enabled(),
        "tts_enabled": tts.is_enabled(),
        "languages": list(intents.SUPPORTED),
    }


@app.get("/api/departments")
def list_departments(language: Lang = "en") -> list[dict[str, Any]]:
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
def list_doctors(specialty: str | None = None, language: Lang = "en") -> list[dict[str, Any]]:
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
    log.info("intent kiosk=%s lang=%s text=%r ai=%s", req.kiosk_id, req.language, req.text, ai.is_enabled())
    if ai.is_enabled():
        result = ai.chat(req.text, req.language, req.kiosk_id)
        engine = "gpt-4o"
    else:
        result = intents.route(req.text, req.language)
        engine = "rules"
    if result.get("alert"):
        log.warning("EMERGENCY ALERT kiosk=%s text=%r", req.kiosk_id, req.text)
        db.log_staff_alert(req.kiosk_id, result.get("intent", "emergency"), req.language, {"text": req.text})
    return IntentResponse(**result, engine=engine)


@app.post("/api/card", response_model=IntentResponse)
def handle_card(req: CardRequest) -> IntentResponse:
    log.info("card kiosk=%s lang=%s id=%s", req.kiosk_id, req.language, req.card_id)
    result = intents.card_action(req.card_id, req.language)
    if result.get("alert"):
        log.warning("EMERGENCY ALERT (card) kiosk=%s card=%s", req.kiosk_id, req.card_id)
        db.log_staff_alert(req.kiosk_id, result.get("intent", "emergency"), req.language, {"card_id": req.card_id})
    return IntentResponse(**result, engine="rules")


@app.post("/api/tts")
def synthesize(req: TTSRequest):
    """Return MP3 audio for the given text. 204 if TTS not configured (frontend then uses browser TTS)."""
    if not tts.is_enabled():
        return Response(status_code=204)
    audio = tts.synthesize(req.text, req.language)
    if audio is None:
        return Response(status_code=204)
    return Response(content=audio, media_type="audio/mpeg")


@app.post("/api/staff-alert")
def staff_alert(payload: dict[str, Any]) -> dict[str, Any]:
    alert_id = db.log_staff_alert(payload.get("kiosk_id"), "manual", payload.get("language", "en"), payload)
    log.warning("STAFF ALERT %s", payload)
    return {"acknowledged": True, "ticket": f"ALERT-{alert_id}"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
