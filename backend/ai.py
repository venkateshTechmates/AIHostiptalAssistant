"""GPT-4o conversational engine with function calling.

Falls back to the rule-based router (`intents.route`) when no API key is
configured, when the request fails, or when GPT-4o produces an empty reply.
The response shape is identical to `intents.route` so the frontend never
needs to know which engine handled the turn.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import db
import intents
from seed_data import EMERGENCY_KEYWORDS, VISITING_HOURS

log = logging.getLogger("hospital-kiosk.ai")

try:
    from openai import OpenAI  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    OpenAI = None  # type: ignore

_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o")
_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
_client = OpenAI(api_key=_API_KEY) if (OpenAI and _API_KEY) else None


def is_enabled() -> bool:
    return _client is not None


# ---------------------------------------------------------------------------
# Tools exposed to GPT-4o (one per kiosk capability)
# ---------------------------------------------------------------------------

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_directions",
            "description": "Look up directions and floor for a department in the hospital. Use this whenever the user asks where something is.",
            "parameters": {
                "type": "object",
                "properties": {
                    "department_id": {
                        "type": "string",
                        "enum": ["emergency", "opd", "pharmacy", "lab", "wards", "billing", "amenities"],
                        "description": "The internal id of the department",
                    },
                },
                "required": ["department_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_doctors",
            "description": "Find doctors by specialty (e.g. cardiology, pediatrics) or by surname. Returns name, specialty, room, slots.",
            "parameters": {
                "type": "object",
                "properties": {
                    "specialty": {"type": "string", "description": "Specialty keyword, e.g. cardiology, pediatrics. Empty string for any."},
                    "surname": {"type": "string", "description": "Doctor surname if mentioned. Empty string otherwise."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_visiting_hours",
            "description": "Return the hospital ward visiting hours.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_emergency_alert",
            "description": "Page hospital staff. Call this for any medical emergency keywords (chest pain, bleeding, unconscious, fainted, etc.) so a wheelchair and team are dispatched.",
            "parameters": {
                "type": "object",
                "properties": {
                    "kiosk_id": {"type": "string"},
                    "type": {"type": "string", "description": "Short reason — e.g. 'chest_pain', 'fall', 'bleeding'."},
                },
                "required": ["type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_faqs",
            "description": "Search the hospital knowledge base (parking, insurance, admission policies, etc.) by keywords.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                },
                "required": ["query"],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Tool implementations — return JSON-serialisable dicts
# ---------------------------------------------------------------------------

def _tool_get_directions(args: dict, lang: str) -> dict:
    dept = db.get_department(args.get("department_id", ""))
    if not dept:
        return {"ok": False, "error": "unknown department"}
    return {
        "ok": True,
        "id": dept["id"],
        "name": dept["name"].get(lang, dept["name"]["en"]),
        "floor": dept["floor"],
        "directions": dept["directions"].get(lang, dept["directions"]["en"]),
        "map_target": dept["map_id"],
    }


def _tool_find_doctors(args: dict, lang: str) -> dict:
    specialty = (args.get("specialty") or "").lower().strip()
    surname = (args.get("surname") or "").lower().strip()
    docs = db.all_doctors()
    if specialty:
        docs = [d for d in docs if any(specialty in k.lower() or k.lower() in specialty for k in d["specialty_keys"])]
    if surname:
        docs = [d for d in docs if surname in d["name"]["en"].lower()]
    return {
        "ok": True,
        "doctors": [
            {
                "id": d["id"],
                "name": d["name"].get(lang, d["name"]["en"]),
                "specialty": d["specialty"].get(lang, d["specialty"]["en"]),
                "room": d["room"],
                "slots_today": d["slots_today"],
            }
            for d in docs
        ],
    }


def _tool_visiting_hours(args: dict, lang: str) -> dict:
    return {"ok": True, "text": VISITING_HOURS.get(lang, VISITING_HOURS["en"])}


def _tool_emergency_alert(args: dict, lang: str, *, kiosk_id: str | None) -> dict:
    db.log_staff_alert(kiosk_id, "emergency", lang, args)
    return {"ok": True, "alerted": True, "type": args.get("type", "unspecified")}


def _tool_search_faqs(args: dict, lang: str) -> dict:
    hits = db.search_faqs(args.get("query", ""), limit=3)
    return {
        "ok": True,
        "results": [
            {"q": h["q"].get(lang, h["q"]["en"]), "a": h["a"].get(lang, h["a"]["en"])}
            for h in hits
        ],
    }


_TOOL_FNS = {
    "get_directions": _tool_get_directions,
    "find_doctors": _tool_find_doctors,
    "get_visiting_hours": _tool_visiting_hours,
    "trigger_emergency_alert": _tool_emergency_alert,
    "search_faqs": _tool_search_faqs,
}


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_LANG_NAME = {"en": "English", "te": "Telugu (తెలుగు)", "hi": "Hindi (हिन्दी)", "ta": "Tamil (தமிழ்)"}


def _system_prompt(lang: str) -> str:
    lname = _LANG_NAME.get(lang, "English")
    return f"""You are the friendly receptionist at City General Hospital. You help visitors find departments, doctors, and answer general questions.

LANGUAGE: Respond ONLY in {lname}. If the user mixes English with their language (e.g. Tenglish, Hinglish), reply in {lname}. Match script: Telugu → తెలుగు lipi, Hindi → देवनागरी, Tamil → தமிழ் எழுத்து, English → Latin.

STYLE: Warm, brief (under 2 sentences for voice), reassuring. Speak like a kind receptionist, not a chatbot. No emoji in spoken text.

RULES:
- For ANY medical emergency keywords (chest pain, bleeding, unconscious, fainted, ఛాతీ నొప్పి, सीने में दर्द, மார்பு வலி, etc.) IMMEDIATELY call trigger_emergency_alert THEN reply telling the user help is on the way and where the Emergency Ward is.
- For "where is X" questions, ALWAYS call get_directions so the map can highlight the route.
- For "I want to see a [specialty]" or doctor questions, call find_doctors.
- NEVER give medical advice, diagnosis, or prescription guidance. If asked, suggest they speak to a doctor or staff.
- Use available tools rather than guessing about hospital details.

Hospital info: 7 departments — Emergency (G/F), OPD (1/F), Pharmacy (G/F, 24h), Lab (G/F), Wards (2/F), Billing (G/F), Amenities (G/F)."""


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def chat(text: str, lang: str = "en", kiosk_id: str | None = None) -> dict[str, Any]:
    """Run the conversational pipeline. Returns the same shape as intents.route."""
    if not is_enabled():
        return intents.route(text, lang)

    # Always run the rule-based emergency check too — never let an LLM hiccup
    # block a real emergency.
    norm = intents._normalise(text)
    is_em = any(intents._contains_keyword(norm, kw) for kw in EMERGENCY_KEYWORDS)

    try:
        return _run_gpt(text, lang, kiosk_id, is_em)
    except Exception as e:  # network, rate-limit, etc.
        log.warning("GPT-4o failure, falling back to rule-based router: %s", e)
        return intents.route(text, lang)


def _run_gpt(text: str, lang: str, kiosk_id: str | None, is_emergency_hint: bool) -> dict[str, Any]:
    messages: list[dict] = [
        {"role": "system", "content": _system_prompt(lang)},
        {"role": "user", "content": text},
    ]

    map_target: str | None = None
    alert: bool = is_emergency_hint
    intent: str = "ai"
    extra_options: list[dict] = []
    extra_data: dict[str, Any] | None = None

    # Run a multi-step tool loop, capped at 3 to avoid cost surprises.
    for _ in range(3):
        resp = _client.chat.completions.create(  # type: ignore[union-attr]
            model=_MODEL,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            temperature=0.4,
            max_tokens=300,
        )
        msg = resp.choices[0].message
        if msg.tool_calls:
            messages.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [tc.model_dump() for tc in msg.tool_calls],
            })
            for tc in msg.tool_calls:
                fn_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except Exception:
                    args = {}
                if fn_name == "trigger_emergency_alert":
                    result = _tool_emergency_alert(args, lang, kiosk_id=kiosk_id)
                    alert = True
                    map_target = "emergency"
                    intent = "emergency"
                elif fn_name == "get_directions":
                    result = _tool_get_directions(args, lang)
                    if result.get("ok"):
                        map_target = result["map_target"]
                        intent = f"navigate.{result['id']}"
                elif fn_name == "find_doctors":
                    result = _tool_find_doctors(args, lang)
                    intent = "find_doctor"
                    map_target = "opd"
                    if result.get("ok") and result["doctors"]:
                        extra_options = [
                            {
                                "id": d["id"],
                                "label": f"{d['name']} — {d['slots_today'][0] if d['slots_today'] else ''}".strip(" —"),
                                "icon": "👨‍⚕️",
                                "kind": "doctor",
                            }
                            for d in result["doctors"][:4]
                        ]
                        extra_data = {"doctors": result["doctors"]}
                elif fn_name == "get_visiting_hours":
                    result = _tool_visiting_hours(args, lang)
                    intent = "visiting_hours"
                    map_target = "wards"
                elif fn_name == "search_faqs":
                    result = _tool_search_faqs(args, lang)
                    intent = "faq"
                else:
                    result = {"ok": False, "error": f"unknown tool {fn_name}"}

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, ensure_ascii=False),
                })
            continue  # let GPT see the tool results
        # No tool calls — final answer
        reply = (msg.content or "").strip()
        if not reply:
            return intents.route(text, lang)
        # Default follow-up cards if GPT didn't produce structured options
        options = extra_options or intents._FOLLOW_UP.get(lang, intents._FOLLOW_UP["en"])
        return {
            "reply": reply,
            "intent": intent,
            "options": options,
            "map_target": map_target,
            "alert": alert,
            "data": extra_data,
        }

    # Hit the loop cap without a final reply — fall back to rules.
    return intents.route(text, lang)
