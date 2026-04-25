# Hospital Guidance Voice Agent — Counter Screen Kiosk (MVP)

A working prototype of the hospital kiosk described in [prd.md](prd.md) (v3.1).
It implements the **quad-layer interaction model** — animated **receptionist
avatar** with lip-sync, multilingual **TTS voice output**, live on-screen
**text captions**, and tappable **quick-select option cards** — using a Python
FastAPI backend (with **OpenAI GPT-4o** + **SQLite**) and a React + Vite
frontend.

## What's implemented (v3.1)

- 🤖 **GPT-4o conversational brain** with function calling — finds doctors,
  looks up directions, triggers staff alerts, searches the FAQ knowledge base
- 🗣️ **Server-side multilingual TTS** via OpenAI TTS (`tts-1`, voice `nova`)
  with browser `speechSynthesis` as offline fallback
- 👩‍⚕️ **Animated SVG receptionist** with breathing, blinking, smiling, and
  audio-driven lip-sync (Web Audio API analyser hooks the playing TTS audio)
- 🌐 **4 languages**: English, **Telugu (తెలుగు)**, Hindi (हिन्दी),
  Tamil (தமிழ்) — full STT + GPT-4o + TTS + UI strings + emergency keywords
- 🚨 Always-visible red emergency button + multilingual emergency keyword
  detection (English, Telugu, Hindi, Tamil) → screen pulses, staff alert
  is logged, wheelchair follow-up cards
- 🗺️ Animated SVG indoor map across 3 floors with route highlighting
- 💾 **SQLite knowledge base** (departments, doctors, FAQs) with **FTS5
  full-text search** for vectorless RAG
- 🛡️ Graceful degradation — no `OPENAI_API_KEY`? Falls back to a deterministic
  rule-based router and browser TTS automatically. The badge in the top bar
  shows which engine handled each turn.
- ⏱️ 45 s idle → session auto-clear (privacy)
- ♿ Large tap targets, high-contrast palette, ARIA roles, 4 supported scripts

## What's intentionally **not** in this MVP

No admin CMS, no real HIS/HMS integration, no offline cache, no analytics
dashboard, no human-handoff video, no QR-to-phone, no presence detection,
no Whisper-based STT (browser SpeechRecognition is sufficient).

## Project layout

```
backend/
  main.py            FastAPI app + endpoints (intent, card, tts, health, staff-alert)
  ai.py              GPT-4o engine with 5 function-calling tools
  intents.py         Rule-based fallback router (4 languages)
  tts.py             OpenAI TTS wrapper (mp3 audio out)
  db.py              SQLite + FTS5 knowledge store
  seed_data.py       Multilingual departments / doctors / FAQs / emergency keywords
  requirements.txt
  .env.example       Copy to .env and fill OPENAI_API_KEY
frontend/
  package.json
  vite.config.js     /api proxy → http://localhost:8001
  src/
    App.jsx          Three-column layout: avatar | chat | map
    api.js
    i18n.js          EN + TE + HI + TA strings + home cards
    styles.css       Kiosk-grade palette + avatar animations
    hooks/useVoice.js  STT + server TTS + audio analyser → lip-sync
    components/      Avatar, Transcript, QuickCards, MicButton,
                     EmergencyButton, LanguageToggle, IndoorMap
prd.md               Product requirements (v3.1)
```

## Running it

You need **Python 3.10+** and **Node 18+**.

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# macOS / Linux:       source .venv/bin/activate
pip install -r requirements.txt

# Configure your OpenAI key (or skip — the kiosk runs in fallback mode without one)
cp .env.example .env
#  ...then edit .env and paste your OPENAI_API_KEY=sk-...

python main.py
```

The API serves at `http://localhost:8001`.
Health check: `curl http://localhost:8001/api/health` should report
`"ai_enabled": true`, `"tts_enabled": true`, `"languages": ["en","te","hi","ta"]`.

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev -- --port 5174
```

Open [http://localhost:5174](http://localhost:5174) in **Chrome** or **Edge**.
Vite proxies `/api/*` to the backend on `:8001`.

> Voice note: Web Speech recognition is Chromium-only. On Firefox/Safari the
> app still works — voice input falls back to tap, and TTS audio still plays
> through the avatar (server-side TTS is browser-agnostic).

## Try it (with `OPENAI_API_KEY` set)

- Tap the mic and say *"Where is the pharmacy?"* — receptionist answers, you
  see her mouth move in sync with the OpenAI TTS audio. Pharmacy lights up
  on the map.
- *"I want to see a cardiologist"* — GPT-4o calls `find_doctors`, you get
  Dr. Mehta + Dr. Rao with slot times.
- Switch to **తెలు** and speak: *"ఎమర్జెన్సీ వార్డ్ ఎక్కడ ఉంది?"*
  — Telugu voice + Telugu UI + Telugu TTS + emergency map.
- *"I have chest pain"* — GPT-4o invokes `trigger_emergency_alert`, the
  screen pulses red, the avatar shows a concerned expression, and a STAFF
  ALERT row is written to `kiosk.db`.
- The badge next to the hospital name shows **GPT-4o** for AI-handled turns.

## Try it (with no API key)

Skip the `.env` step. The kiosk degrades gracefully:
- Intent routing falls back to the deterministic rule-based router
- TTS endpoint returns 204; the frontend uses the browser's
  `speechSynthesis` (you'll see the avatar lip-sync via fallback animation
  since browser synth doesn't expose amplitude)
- Top-bar badge shows **Local**

## Architecture notes

**Response shape is identical for AI and rules**, so the frontend never
knows which engine handled a turn:

```json
{
  "reply":   "...",
  "intent":  "navigate.opd",
  "options": [{ "id": "...", "label": "...", "icon": "..." }],
  "map_target": "opd",
  "alert":   false,
  "data":    null,
  "engine":  "gpt-4o"   // or "rules"
}
```

**Tools exposed to GPT-4o** ([backend/ai.py](backend/ai.py)):
- `get_directions(department_id)` — returns floor + directions + map node
- `find_doctors(specialty, surname)` — searches the SQLite doctor table
- `get_visiting_hours()` — returns the localised visiting-hours text
- `trigger_emergency_alert(type)` — pages staff and logs to `staff_alerts`
- `search_faqs(query)` — FTS5 keyword search over the multilingual FAQ table

**Vectorless RAG** uses SQLite's `FTS5` virtual table indexed on the
concatenation of all language variants of every FAQ — works for English,
Telugu, Hindi, and Tamil queries without an embedding model.

**Avatar lip-sync** uses a Web Audio `AnalyserNode` on the audio element
playing the OpenAI TTS mp3. RMS amplitude per animation frame drives the
mouth opening (0..1). When no analyser is available, a sine-wave fallback
keeps the avatar looking alive while speaking.

## Swapping in a real S2S model (V2)

Replace [hooks/useVoice.js](frontend/src/hooks/useVoice.js) with a WebSocket
client to the GPT-4o Realtime API and stream both partial transcripts and
audio chunks. Keep the response shape and the avatar/TTS plumbing as-is.
