# Product Requirements Document (PRD)
## Hospital Guidance Voice Agent — Counter Screen Kiosk

**Document Version:** 3.1
**Date:** April 26, 2026
**Status:** Draft
**Owner:** Product Team

> **Changelog v3.1:** Added Telugu (తెలుగు) as a primary supported language with full speech recognition, GPT-4o conversational support, TTS output, avatar lip-sync, and localized on-screen UI. Telugu prioritized for Telangana and Andhra Pradesh deployments.

---

## 1. Executive Summary

The Hospital Guidance Voice Agent is an AI-powered, **speech-to-speech** interactive kiosk system deployed on counter-mounted touchscreen displays at hospital entrances, lobbies, and key navigation points. It features a **lifelike animated receptionist avatar** that speaks to users naturally, powered by **OpenAI GPT-4o** for conversational intelligence, with **real-time multilingual text-to-speech (TTS)** output and synchronized on-screen text captions. Patients and visitors can speak naturally, tap quick-select option cards (e.g., Emergency Ward, OPD, Pharmacy, Billing), and see/hear responses from the avatar in their chosen language. This multi-modal design serves users who prefer voice, prefer touch, are hard of hearing, or are in noisy environments.

---

## 2. Problem Statement

Hospitals are stressful, complex environments. Patients and visitors regularly face:

- Long queues at reception/information desks for simple questions
- Difficulty navigating large multi-floor facilities
- Language barriers with reception staff
- Confusion about department locations, doctor availability, and visiting hours
- Anxiety from elderly or first-time visitors who can't read directional signage
- Hearing-impaired users who can't rely on voice-only systems
- Cold, impersonal text-only kiosks that don't feel reassuring
- Reception staff overloaded with repetitive low-value queries

A **GPT-4o powered kiosk with a friendly receptionist avatar, multilingual TTS, on-screen text, and tappable options** delivers a warm, accessible, always-available first point of contact.

---

## 3. Goals & Objectives

### Primary Goals
- Reduce reception desk query volume by **40%** within 6 months of deployment
- Provide **24/7** instant guidance with a humanlike avatar experience
- Support **at least 5 languages** with full TTS output and avatar lip-sync
- Achieve **average query resolution time under 30 seconds**
- Achieve **end-to-end voice latency under 1.2 s** (user speaks → avatar replies)

### Success Metrics (KPIs)
- Daily active interactions per kiosk
- Query resolution rate (resolved without human handoff)
- User satisfaction score (post-interaction rating)
- Average conversation duration
- % of users using voice vs. tap vs. mixed
- Reduction in reception desk wait times
- Avatar engagement rate (users who complete full conversation)
- Accessibility usage (elderly, hearing-impaired, visually-impaired adoption)

---

## 4. Target Users

| User Type | Needs |
|-----------|-------|
| **Outpatients (OPD visitors)** | Find department, doctor, appointment counter |
| **Inpatient visitors** | Locate ward, room number, visiting hours |
| **Elderly patients** | Friendly avatar, slow pace, large tap targets |
| **Non-native speakers** | Multilingual speech and TTS in their language |
| **Emergency walk-ins** | Fast routing to ER, prominent emergency button |
| **Hearing-impaired users** | Avatar with text captions + tappable options |
| **Visually-impaired users** | Voice-first with TTS confirmation |
| **First-time visitors** | Reassuring, humanlike guide |

---

## 5. Interaction Model — Avatar + Voice + Visual

### 5.1 Core Principle: Four Synchronized Layers

Every interaction runs four layers simultaneously:

| Layer | Purpose |
|-------|---------|
| **Receptionist Avatar** | Animated humanlike face with lip-sync and expressions |
| **TTS Voice Output** | Natural multilingual speech in user's chosen language |
| **Live Text Captions** | On-screen synchronized text of avatar's speech |
| **Quick-Select Options** | Tappable cards for common queries and follow-ups |

### 5.2 Receptionist Avatar

A photorealistic or stylized 3D animated receptionist that visually represents the assistant.

**Avatar capabilities:**
- **Lip-sync** matched to TTS output in any supported language
- **Facial expressions** — warm smile, attentive listening, concern (for emergencies), reassurance
- **Eye contact** — tracks user presence via camera
- **Idle animations** — subtle breathing, blinking, occasional glance to feel alive
- **Greeting gestures** — wave, nod, hand gesture toward direction
- **Configurable appearance** — gender, age, attire (hospital uniform), ethnicity (regionally appropriate)
- **Listening state** — visual cue (e.g., glowing mic, attentive pose) when user is speaking
- **Speaking state** — animated mouth and gentle head movement during TTS playback

**Technical approach:**
- 3D rigged avatar rendered via WebGL (Three.js / Unity WebGL) or pre-rendered video segments
- Real-time lip-sync from TTS phoneme/viseme stream
- Optional vendor solutions: D-ID, HeyGen, Synthesia, NVIDIA Audio2Face, or Ready Player Me

### 5.3 GPT-4o Integration (Conversational Brain)

**OpenAI GPT-4o** powers the conversation logic.

| Function | Implementation |
|----------|----------------|
| **Intent understanding** | GPT-4o parses user query in any language |
| **Knowledge retrieval** | RAG pipeline over hospital knowledge base (departments, doctors, FAQs, policies) |
| **Tool calling** | GPT-4o function-calling for HIS/HMS lookups (doctor schedule, appointments, tokens) |
| **Multilingual generation** | GPT-4o produces response in user's detected/selected language |
| **Safety guardrails** | System prompts prevent medical advice, diagnosis, prescriptions |
| **Context memory** | Session-only context (cleared after each user) |

**Example tool calls available to GPT-4o:**
- `get_doctor_schedule(specialty, date)`
- `lookup_appointment(phone_or_id)`
- `get_directions(from_kiosk_id, to_department)`
- `get_visiting_hours(ward)`
- `trigger_emergency_alert(kiosk_id, type)`
- `escalate_to_staff(reason)`

**Why GPT-4o:**
- Native multilingual capability (50+ languages)
- Low-latency multimodal understanding
- Strong tool/function calling
- Better at conversational nuance for stressed/elderly users
- *Note: For ultra-low-latency speech-to-speech, GPT-4o Realtime API can replace separate STT+LLM+TTS pipeline (see Section 10).*

### 5.4 Speech Pipeline

**Two architecture options:**

**Option A — Modular pipeline (recommended for V1):**
```
User speech → STT (Whisper) → GPT-4o (text) → TTS (multilingual) → Avatar lip-sync + Speakers
```
- Easier to debug, swap components, and customize voice
- Total latency target: under 1.5 s

**Option B — Realtime S2S pipeline (V2 upgrade):**
```
User speech → GPT-4o Realtime API → Audio out → Avatar lip-sync + Speakers
```
- Lower latency (~500–800 ms)
- More natural emotional inflection
- Selected based on cost/availability at deployment time

### 5.5 Multilingual TTS Output

Real-time end-to-end multilingual support across speech recognition, GPT-4o conversation, TTS output, avatar lip-sync, and on-screen UI text.

**Primary supported languages (V1):**

| Language | Script | Region Priority | STT | GPT-4o | TTS Voices |
|----------|--------|-----------------|-----|--------|------------|
| **English** | Latin | All deployments | ✅ | ✅ | OpenAI / ElevenLabs / Azure |
| **Telugu (తెలుగు)** | Telugu | **Telangana, Andhra Pradesh (priority)** | ✅ Whisper | ✅ Native | Azure Neural (`te-IN-ShrutiNeural`, `te-IN-MohanNeural`), Google WaveNet (`te-IN`) |
| **Hindi (हिन्दी)** | Devanagari | North India, pan-India | ✅ | ✅ | OpenAI / Azure / ElevenLabs |
| **Tamil (தமிழ்)** | Tamil | Tamil Nadu | ✅ | ✅ | Azure Neural / Google WaveNet |
| **Urdu / Other regional** | Various | Region-dependent | ✅ | ✅ | Azure Neural |

**Language capabilities:**
- **Natural-sounding voices** — OpenAI TTS, ElevenLabs, Azure Neural Voices, Google WaveNet
- **Auto language detection** from user's first spoken sentence
- **Manual language toggle** as persistent on-screen card (English / తెలుగు / हिन्दी / தமிழ்)
- **Avatar lip-sync** adapts to language-specific phonemes (Telugu visemes mapped to avatar mouth shapes)
- **Voice persona** consistent across languages — calm, warm, professional, gender-configurable
- **Code-mixing** — handles common patterns like "Telugu + English" (Tenglish) and "Hindi + English" (Hinglish), which are natural in Indian conversation
- **Number and date localization** — Telugu numerals, time formats (e.g., "ఉదయం 10 గంటలు")

### 5.6 Synchronized On-Screen Text Display
- **Live captions** of avatar's speech, word-by-word highlight
- **Live transcript** of user's spoken input (with confirm option)
- **Conversation history** scrollable during session
- **Large, readable typography** (minimum 24pt body)
- **High-contrast mode** toggle
- All text in user's selected language
- Cleared automatically after session timeout (privacy)

### 5.7 On-Screen Quick-Select Options

The screen always shows context-aware tappable cards alongside the avatar.

**Default home-screen options (always visible):**

| Card | Icon | Action |
|------|------|--------|
| 🚨 **Emergency Ward** | Red, prominent, top-left | Immediate directions + staff alert |
| 🏥 **OPD / Outpatient** | Stethoscope | Department list |
| 💊 **Pharmacy** | Pill | Pharmacy location + timings |
| 🧪 **Lab / Diagnostics** | Test tube | Lab counter directions |
| 🛏️ **Inpatient / Wards** | Bed | Ward locator + visiting hours |
| 💳 **Billing & Insurance** | Card | Counter location + TPA info |
| 👨‍⚕️ **Find a Doctor** | Doctor icon | Doctor search by name/specialty |
| 📅 **My Appointment** | Calendar | Appointment lookup |
| ☕ **Amenities** | Cafe icon | Restroom, cafeteria, ATM, parking |
| 🌐 **Language** | Globe | Language toggle |
| 🙋 **Talk to Staff** | Person | Human handoff |

**Context-aware options** (appear during conversation):
- After "I want to see a cardiologist" → cards: [Dr. Mehta — 10am], [Dr. Rao — 2pm], [See all], [Tomorrow instead]
- After "Where is OPD?" → cards: [Floor 1 — General OPD], [Floor 2 — Specialty OPD], [Show map]
- After any answer → cards: [Repeat], [Send to my phone (QR)], [Anything else?], [Done]

### 5.8 Multi-Modal Interaction Examples

**Example 1 — Telugu voice-led with avatar:**
> User: *"ఎమర్జెన్సీ వార్డ్ ఎక్కడ ఉంది?"* (Where is the emergency ward?)
> Avatar (smiles warmly, gestures right, speaks in Telugu via TTS): *"ఎమర్జెన్సీ వార్డ్ గ్రౌండ్ ఫ్లోర్‌లో, మెయిన్ రిసెప్షన్ కుడి వైపున ఉంది. సుమారు 50 మీటర్ల దూరంలో."*
> Screen: Telugu caption + Map with route + cards: [దారి చూపించండి], [ఫోన్‌కి పంపండి], [వీల్‌చైర్ కావాలా?]

**Example 2 — Telugu mixed with English (Tenglish):**
> User: *"Doctor Sharma appointment ఉంది, ఎక్కడికి వెళ్ళాలి?"*
> Avatar (in Telugu): *"మీ ఫోన్ నంబర్ లేదా అపాయింట్‌మెంట్ ID చెప్పగలరా?"*
> Screen: cards: [ఫోన్ నంబర్ ఎంటర్ చేయండి], [QR స్కాన్ చేయండి], [నా దగ్గర లేదు]

**Example 3 — Tap-led (English):**
> User taps 🚨 **Emergency Ward**
> Avatar (concerned expression, speaks): *"Heading to Emergency. It's on the ground floor to your right. Do you need a wheelchair?"*
> Screen: Map + cards: [Yes, wheelchair], [No, I can walk], [Call staff]

**Example 4 — Hindi voice-led:**
> User: *"मुझे कार्डियोलॉजिस्ट से मिलना है।"*
> Avatar (in Hindi): *"डॉ. मेहता सुबह 10 बजे और डॉ. राव दोपहर 2 बजे उपलब्ध हैं।"*
> Screen: Hindi caption + cards: [डॉ. मेहता — 10 बजे], [डॉ. राव — 2 बजे], [सभी डॉक्टर देखें]

---

## 6. Key Features

### 6.1 Hospital Navigation
- Department locator with **visual indoor map**
- Step-by-step turn-by-turn directions (avatar speaks + on-screen arrows)
- Floor and wing-based guidance
- **QR code on screen** to send directions to user's phone
- Estimated walking time
- Wheelchair-accessible route option

### 6.2 Emergency Handling (Priority Feature)
- **Always-visible red emergency button** on every screen
- GPT-4o detects emergency keywords ("chest pain," "bleeding," "unconscious," "fainted")
- Avatar shifts to concerned, urgent expression
- Immediate routing to nearest ER with audio + visual alert
- **Auto-pages staff** with kiosk location
- Audible alert sound + flashing screen
- Multilingual emergency phrases recognized

### 6.3 Doctor & Appointment Information
- Doctor search by name or specialty (voice or tap)
- OPD timings and consultation room numbers
- Token/queue number lookup (HIS integration via GPT-4o function call)
- Appointment confirmation via phone number or appointment ID
- On-screen list of doctors with photos and timings

### 6.4 General Hospital Information
- Visiting hours by ward (with on-screen schedule grid)
- Pharmacy and lab timings
- Billing, insurance, and TPA counters
- Hospital amenities map (cafeteria, ATM, prayer room, parking, restrooms)
- Admission and discharge procedures
- Emergency contact numbers

### 6.5 Multilingual Support
- **Telugu (తెలుగు)** as a first-class supported language for Telangana and Andhra Pradesh deployments — full STT, GPT-4o conversation, TTS, avatar lip-sync, and on-screen UI
- Real-time conversation in **at least 5 languages** with full TTS and avatar lip-sync
- Default language set per kiosk based on location (e.g., Hyderabad kiosks default to Telugu)
- **Auto-detection** of spoken language with on-screen confirmation
- Language toggle as a persistent on-screen card showing native scripts: English / తెలుగు / हिन्दी / தமிழ்
- All on-screen text, option cards, error messages, and announcements localized including Telugu
- Telugu numerals and time formats supported
- Code-mixed speech handled (Tenglish / Hinglish)

### 6.6 Accessibility
- **Hearing-impaired:** Avatar with full text captions + all options tappable
- **Visually-impaired:** Voice + TTS-first with audio cues, screen reader for option cards
- **Elderly:** Slow-speech mode, larger text, patient timeouts, friendly avatar
- **Wheelchair users:** Lower screen mount, accessible-route directions
- High-contrast mode and font-size adjustment

### 6.7 Human Handoff
- Persistent "Talk to Staff" card on screen
- Connects via video/audio to reception desk
- Auto-handoff when GPT-4o confidence is low or query is sensitive (medical advice)
- Staff can see live transcript of user's session

### 6.8 Privacy & Hygiene
- Voice + avatar reduces touch surface
- No persistent storage of conversation audio or transcripts beyond session
- GPT-4o calls use Zero Data Retention (ZDR) where supported
- Auto-clear screen after **45 seconds of inactivity**

---

## 7. Functional Requirements

### 7.1 Core Conversation Flow
1. **Idle state** — avatar in friendly idle pose, prompt: "Tap any option or say hello to begin"
2. **Activation** — wake-word ("Hello"), tap, or presence detection (camera)
3. **Avatar greeting + language confirmation** (auto-detect or tap)
4. **Intent capture** — voice or tap on quick-select card
5. **GPT-4o processes** → optional tool call → response in user's language
6. **Avatar speaks via TTS** with lip-sync + text captions + visual aids (map, doctor list, QR)
7. **Follow-up Q&A** with contextual option cards
8. **Closure** — satisfaction prompt, return to idle

### 7.2 Integrations
- **OpenAI GPT-4o API** — Conversational engine (with function calling)
- **OpenAI Whisper** (or similar) — Speech-to-text
- **TTS engine** — OpenAI TTS / ElevenLabs / Azure Neural Voices
- **Avatar engine** — D-ID / HeyGen / custom WebGL
- **HIS/HMS** — Doctor schedules, OPD tokens, departments
- **Appointment system** — Patient lookup
- **Indoor mapping/wayfinding system**
- **Staff alert/paging system** for emergencies
- **CMS** for content updates
- **Analytics dashboard** for admin

### 7.3 Admin & Content Management
- Web-based CMS to update:
  - Department info, doctor lists, timings
  - Quick-select option cards (add/remove/reorder)
  - FAQs and announcements (fed into GPT-4o RAG)
  - Multilingual content
  - Emergency keyword list
  - Avatar appearance/persona settings
- Role-based access for admins
- Audit logs

---

## 8. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Voice latency** | User speech-end → avatar speech-start under 1.2 s |
| **Avatar lip-sync** | Phoneme-to-viseme alignment within 50 ms accuracy |
| **UI sync latency** | Text and option cards appear within 200 ms of voice |
| **Performance** | Map render under 2 s; option card tap response under 100 ms |
| **Availability** | 99.5% uptime per kiosk |
| **Privacy** | No audio/PHI storage; HIPAA / local equivalent compliance; GPT-4o ZDR mode |
| **Security** | Encrypted communication (TLS); tamper-resistant kiosk OS |
| **Scalability** | Support 50+ concurrent kiosks per hospital from central backend |
| **Offline mode** | Cached navigation, FAQs, and emergency directions; basic avatar pre-rendered fallback |
| **Hygiene** | Voice-first reduces touch; auto-screen-clean reminder every 4 hours |

---

## 9. Hardware Requirements

- **Display:** 27"–32" capacitive touchscreen (1080p+, anti-glare) — larger size for avatar visibility
- **GPU:** Mid-tier GPU (e.g., NVIDIA RTX 3050+) for smooth avatar rendering
- **Microphone:** Far-field directional mic array (4+ mics) with noise cancellation
- **Speakers:** Stereo speakers with adaptive volume based on ambient noise
- **Camera:** For presence detection, eye-contact tracking, and emotion sensing
- **QR scanner:** Optional, for appointment lookup
- **Mounting:** Floor-stand or wall-mount, ADA-compliant height
- **Connectivity:** Ethernet preferred (low-latency for GPT-4o calls), Wi-Fi fallback
- **Power:** UPS battery backup (minimum 30 mins)
- **Privacy:** Physical mic-mute indicator LED, camera shutter

---

## 10. Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend (Kiosk)** | React + WebGL (Three.js) or Flutter on Windows IoT / Android Kiosk OS |
| **Avatar Engine** | D-ID / HeyGen / Ready Player Me / custom Three.js + viseme lip-sync |
| **Speech-to-Text** | OpenAI Whisper API (or Whisper local for offline) |
| **Conversational AI** | **OpenAI GPT-4o** with function calling + RAG over hospital KB |
| **Text-to-Speech** | OpenAI TTS / ElevenLabs / Azure Neural Voices (multilingual) |
| **Realtime upgrade (V2)** | OpenAI GPT-4o Realtime API for end-to-end S2S |
| **Backend** | Node.js / Python microservices (FastAPI) |
| **Database** | SQLite (MVP, vectorless FTS5 keyword search) → PostgreSQL + vector DB at scale |
| **Mapping** | Custom indoor map renderer (SVG-based) with route overlay |
| **Real-time sync** | WebSocket for voice + avatar + text + option-card sync |
| **Analytics** | Self-hosted Grafana / cloud dashboard |

---

## 11. UX Principles

- **Humanlike warmth** — avatar should feel like a kind receptionist, not a robot
- **Calm and reassuring** — hospital environments are stressful
- **Brevity in voice** — spoken responses under 15 seconds; screen carries detail
- **Quad-modality reinforcement** — every answer is delivered via avatar + TTS + text + cards
- **Emergency-first** — red emergency card always visible
- **No medical advice** — GPT-4o system prompt strictly prevents diagnosis or symptoms
- **Patience** — long pauses, elderly speech, hesitation accommodated
- **Privacy-first** — no recording beyond session
- **Forgiveness** — easy to say "go back," "start over," or tap home

---

## 12. Out of Scope (V1)

- Medical diagnosis or symptom checker
- Prescription information or drug recommendations
- Patient medical record access
- Payment processing
- Telemedicine consultation
- Sign language video avatar (planned for V2)
- Biometric/face recognition for patient ID
- Avatar with emotion-mirroring (V2)

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| GPT-4o API downtime | Fallback to cached FAQ + tap-only mode |
| Speech recognition fails in noisy lobby | Directional mics + always-visible tap options as fallback |
| Avatar lip-sync looks unnatural | Use proven vendor (D-ID/HeyGen); fall back to static avatar with mouth animation |
| Patient asks medical question | GPT-4o system prompt redirects to staff; auto-handoff |
| Privacy concerns with voice/video | No persistent storage; ZDR mode on GPT-4o; auto-clear |
| Outdated hospital data | CMS with weekly review workflow; RAG re-indexing |
| Kiosk becomes unresponsive | Auto-restart, remote monitoring, on-call IT |
| Latency too high | Edge caching, prefetch common intents, V2 upgrade to Realtime API |
| Hearing-impaired user excluded | Avatar + full text + tap mode works without audio |
| Avatar uncanny valley | Stylized look option; user testing before launch |
| Telugu STT accuracy on regional dialects | Fine-tune Whisper on Telugu medical/hospital corpus; provide tap fallback |
| Telugu TTS sounds robotic | Use premium Azure Neural / Google WaveNet Telugu voices; user-test before launch |
| GPT-4o API cost overrun | Caching, rate limits, fallback to smaller model for simple intents |

---

## 14. Rollout Plan

**Phase 1 — Pilot (8 weeks):**
- 2 kiosks in one hospital lobby (Telangana / Andhra Pradesh deployment)
- **English + Telugu (తెలుగు)** with full TTS and avatar lip-sync
- GPT-4o integration with hospital RAG
- Core navigation, FAQ, emergency button, on-screen options
- Basic avatar (static or D-ID stock)
- Telugu UI strings, Telugu emergency keywords, Telugu doctor name pronunciation

**Phase 2 — Integration & Polish (12 weeks):**
- HIS integration via GPT-4o function calling
- Appointment lookup, doctor schedules
- Add Hindi + Tamil (3+ total languages)
- Custom-branded receptionist avatar
- Emergency keyword detection + staff paging (multilingual including Telugu)
- Tenglish / code-mixed speech handling
- Analytics dashboard

**Phase 3 — Scale & Realtime Upgrade (16 weeks):**
- Multi-location rollout
- Migration to GPT-4o Realtime API for sub-second S2S
- Advanced avatar — emotion mirroring, gestures
- Sign language video avatar
- Personalization (returning visitor recognition via appointment ID)
- Hospital ops insights

---

## 15. Open Questions

- Which avatar vendor — D-ID, HeyGen, custom WebGL, or NVIDIA Audio2Face?
- GPT-4o cloud API vs. Azure OpenAI deployment for HIPAA compliance?
- Will the agent integrate with national health ID systems (e.g., ABHA in India)?
- Should appointment booking and payment be supported on-screen?
- Data retention policy for anonymous interaction logs?
- Approval pathway for medical-adjacent content from hospital administration?
- Avatar appearance — culturally adaptive per region, or single brand identity?
- Should the agent proactively detect distress (crying, panic) via voice tone/camera?

---

**End of Document**
