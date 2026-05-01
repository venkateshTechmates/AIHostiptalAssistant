import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LANGUAGES, STRINGS } from './i18n.js';
import { sendIntent, sendCard, sendStaffAlert, fetchHealth } from './api.js';
import { useVoice } from './hooks/useVoice.js';
import Transcript from './components/Transcript.jsx';
import { HomeCards, ContextCards } from './components/QuickCards.jsx';
import EmergencyButton, { EmergencyOverlay } from './components/EmergencyButton.jsx';
import LanguageToggle from './components/LanguageToggle.jsx';
import IndoorMap from './components/IndoorMap.jsx';
import Avatar from './components/Avatar.jsx';
import PatientRegistration from './components/PatientRegistration.jsx';
import PresenceDetector from './components/PresenceDetector.jsx';

const IDLE_MS = 60_000;          // session auto-clear after a full minute
const NUDGE_INTERVAL_MS = 5_000; // re-engage every 5 s while idle
const MAX_NUDGES = 3;            // before reverting to home

export default function App() {
  const [lang, setLang] = useState('en');
  const [autoDetect, setAutoDetect] = useState(false);
  const [messages, setMessages] = useState([]);
  const [options, setOptions] = useState([]);
  const [mapTarget, setMapTarget] = useState(null);
  const [alert, setAlert] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState(null);
  const [engine, setEngine] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [primed, setPrimed] = useState(false);    // first user gesture happened
  const [showRegister, setShowRegister] = useState(false);
  const [recognizedPatient, setRecognizedPatient] = useState(null);
  const [presenceOn, setPresenceOn] = useState(true);   // ambient face detection
  const recognizedIdRef = useRef(null);
  const lastReplyRef = useRef('');
  const idleTimerRef = useRef(null);
  const nudgeTimerRef = useRef(null);
  const nudgeCountRef = useRef(0);

  const t = STRINGS[lang];

  useEffect(() => {
    fetchHealth().then((h) => setAiEnabled(Boolean(h?.ai_enabled))).catch(() => {});
  }, []);

  // Voice hook — listens continuously after the first interaction.
  // In auto mode we use server-side Whisper STT (true audio-based language
  // detection); in explicit-lang modes the browser's SpeechRecognition is
  // faster and free.
  const handleTranscriptRef = useRef(() => {});
  const onTranscript = useCallback((text, hintLang) => handleTranscriptRef.current(text, hintLang), []);
  const onDetectedLanguage = useCallback((detected) => {
    if (detected && ['en', 'te', 'hi', 'ta'].includes(detected)) setLang(detected);
  }, []);
  const voice = useVoice({
    locale: t.locale,
    onTranscript,
    whisperMode: autoDetect,
    onDetectedLanguage,
  });

  // ---- session-clear after 60 s of total inactivity ---------------------
  const resetIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setMessages([]);
      setOptions([]);
      setMapTarget(null);
      setAlert(false);
      setEngine(null);
      lastReplyRef.current = '';
      voice.cancelSpeech();
    }, IDLE_MS);
  }, [voice]);

  // ---- 5 s proactive re-engagement nudge --------------------------------
  const cancelNudge = useCallback(() => {
    clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = 0;
  }, []);

  const scheduleNudge = useCallback(() => {
    cancelNudge();
    if (!primed) return;          // wait for the first user gesture
    if (alert) return;            // don't chatter during an emergency
    nudgeTimerRef.current = setTimeout(() => {
      // Don't speak over the user, the agent itself, or while thinking.
      if (voice.speaking || voice.listening || thinking) {
        scheduleNudge();
        return;
      }
      const i = Math.min(nudgeCountRef.current, t.nudges.length - 1);
      const nudge = t.nudges[i];
      nudgeCountRef.current += 1;
      voice.speak(nudge, lang);
      // The nudge plays through the avatar via TTS only — we deliberately
      // do NOT push it into `messages` so the welcome / home cards stay
      // visible while the kiosk is idle.
      if (nudgeCountRef.current >= MAX_NUDGES) {
        setTimeout(() => {
          setMessages([]);
          setOptions([]);
          setMapTarget(null);
          nudgeCountRef.current = 0;
          scheduleNudge();
        }, 4500);
      } else {
        scheduleNudge();
      }
    }, NUDGE_INTERVAL_MS);
  }, [alert, cancelNudge, lang, primed, t, thinking, voice]);

  // Reset/start nudge timer on any activity. If the agent finishes speaking,
  // start a fresh 5 s window.
  useEffect(() => {
    nudgeCountRef.current = 0;
    if (voice.speaking || voice.listening || thinking) {
      cancelNudge();
    } else {
      scheduleNudge();
    }
  }, [voice.speaking, voice.listening, thinking, scheduleNudge, cancelNudge, messages.length]);

  useEffect(() => {
    resetIdle();
    return () => idleTimerRef.current && clearTimeout(idleTimerRef.current);
  }, [resetIdle, messages, options, mapTarget]);

  // ---- response handling -------------------------------------------------
  const applyResponse = useCallback((res, userText) => {
    setError(null);
    nudgeCountRef.current = 0;
    // Auto-detect: switch UI language to whatever the backend detected.
    const replyLang =
      autoDetect && res.detected_language && res.detected_language !== lang
        ? res.detected_language
        : lang;
    if (replyLang !== lang) {
      // eslint-disable-next-line no-console
      console.info('[auto-lang] switching', lang, '->', replyLang);
      setLang(replyLang);
    }
    setMessages((prev) => {
      const next = userText
        ? [...prev, { who: 'user', text: userText }]
        : [...prev];
      if (res.reply) next.push({ who: 'agent', text: res.reply });
      return next;
    });
    setOptions(res.options || []);
    setMapTarget(res.map_target ?? null);
    setEngine(res.engine || null);
    if (res.alert) {
      setAlert(true);
      sendStaffAlert({ intent: res.intent, language: replyLang }).catch(() => {});
    }
    if (res.reply) {
      lastReplyRef.current = res.reply;
      voice.speak(res.reply, replyLang);
    }
  }, [voice, lang, autoDetect]);

  const submitText = useCallback(async (text, hintLang = null) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    cancelNudge();
    nudgeCountRef.current = 0;
    setThinking(true);
    try {
      // Prefer Whisper's audio-detected language if provided; else pass
      // 'auto' for backend-side text detection; else explicit lang.
      const apiLang = hintLang
        ? hintLang
        : autoDetect
          ? 'auto'
          : lang;
      const res = await sendIntent(trimmed, apiLang);
      applyResponse(res, trimmed);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setThinking(false);
    }
  }, [applyResponse, cancelNudge, lang, autoDetect]);

  useEffect(() => {
    handleTranscriptRef.current = (text, hintLang) => submitText(text, hintLang);
  }, [submitText]);

  const submitCard = useCallback(async (cardId, opt) => {
    cancelNudge();
    nudgeCountRef.current = 0;
    if (!primed) setPrimed(true);
    // Patient registration card: open modal locally — no backend round-trip.
    if (cardId === 'register') {
      setShowRegister(true);
      return;
    }
    setThinking(true);
    const userEcho = opt?.label || t.cards[cardId] || cardId;
    try {
      if (cardId === 'repeat' && lastReplyRef.current) {
        voice.speak(lastReplyRef.current, lang);
        setThinking(false);
        return;
      }
      const res = await sendCard(cardId, lang);
      applyResponse(res, userEcho);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setThinking(false);
    }
  }, [applyResponse, cancelNudge, lang, voice, t, primed]);

  const handleEmergency = useCallback(() => {
    if (!primed) setPrimed(true);
    submitCard('emergency');
  }, [submitCard, primed]);

  // ---- streaming-mic behaviour ------------------------------------------
  // Once the user has interacted at all, turn the mic on and keep it on.
  useEffect(() => {
    if (primed && voice.supported) voice.setListeningEnabled(true);
  }, [primed, voice]);

  const toggleMic = useCallback(() => {
    if (!primed) setPrimed(true);
    voice.setListeningEnabled(!voice.enabled);
  }, [voice, primed]);

  const handleHome = useCallback(() => {
    voice.cancelSpeech();
    cancelNudge();
    nudgeCountRef.current = 0;
    setMessages([]);
    setOptions([]);
    setMapTarget(null);
    setAlert(false);
    setError(null);
    setEngine(null);
    lastReplyRef.current = '';
  }, [voice, cancelNudge]);

  const status =
    thinking ? t.thinking
    : voice.listening ? t.listening
    : voice.speaking ? t.speaking
    : (primed && voice.enabled) ? t.streamingOn
    : null;

  const showHome = messages.length === 0 && options.length === 0;

  return (
    <div className={`app${alert ? ' app--alert' : ''}`} dir="ltr">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden>＋</span>
          <span className="topbar__name">{t.hospital}</span>
          {engine && (
            <span className={`engine-badge engine-badge--${engine === 'gpt-4o' ? 'ai' : 'rules'}`}>
              {engine === 'gpt-4o' ? t.aiBadge : t.rulesBadge}
            </span>
          )}
          {!aiEnabled && !engine && (
            <span className="engine-badge engine-badge--rules" title="No OPENAI_API_KEY">
              {t.rulesBadge}
            </span>
          )}
        </div>
        <div className="topbar__right">
          <LanguageToggle
            value={autoDetect ? 'auto' : lang}
            onChange={(code) => {
              if (code === 'auto') {
                setAutoDetect(true);
              } else {
                setAutoDetect(false);
                setLang(code);
              }
            }}
            languages={LANGUAGES}
          />
          <button
            className={`mic-pill${voice.enabled && primed ? ' mic-pill--on' : ''}${voice.listening ? ' mic-pill--live' : ''}`}
            onClick={toggleMic}
            title={voice.enabled ? t.muteMic : t.enableMic}
            aria-pressed={voice.enabled && primed}
          >
            <span className="mic-pill__dot" />
            {!primed
              ? t.enableMic
              : voice.enabled
                ? (voice.listening ? t.listening : t.streamingOn)
                : t.streamingOff}
          </button>
          <EmergencyButton onClick={handleEmergency} label={t.emergency} />
        </div>
      </header>

      <main className="main">
        <section className="main__avatar">
          <Avatar
            speaking={voice.speaking}
            listening={voice.listening}
            alert={alert}
            mouthOpen={voice.mouthOpen}
          />
        </section>

        <section className="main__chat">
          {recognizedPatient && (
            <div className="welcome-banner">
              <span style={{ fontSize: 22 }}>👋</span>
              <span>
                {lang === 'te' && `స్వాగతం, ${recognizedPatient.name}! సందర్శన #${recognizedPatient.visit_count}`}
                {lang === 'hi' && `स्वागत है, ${recognizedPatient.name}! यात्रा #${recognizedPatient.visit_count}`}
                {lang === 'ta' && `வரவேற்கிறோம், ${recognizedPatient.name}! வருகை #${recognizedPatient.visit_count}`}
                {lang === 'en' && `Welcome back, ${recognizedPatient.name}! Visit #${recognizedPatient.visit_count}`}
              </span>
            </div>
          )}
          {showHome ? (
            <div className="welcome">
              <h1 className="welcome__title">{t.welcomeTitle}</h1>
              <p className="welcome__sub">{t.welcomeSub}</p>
            </div>
          ) : (
            <Transcript messages={messages} interim={voice.interim} t={t} />
          )}

          <div className="status-row">
            {status && <div className="status">{status}</div>}
            {error && <div className="status status--error">⚠ {error}</div>}
            {!voice.supported && <div className="status status--warn">{t.voiceUnavailable}</div>}
          </div>

          <div className="controls">
            <button className="ghost-btn" onClick={handleHome}>↺ {t.home}</button>
          </div>

          {options.length > 0 && (
            <ContextCards options={options} onPick={submitCard} />
          )}

          {showHome && <HomeCards onPick={submitCard} t={t} />}
        </section>

        <aside className="main__map">
          <IndoorMap target={mapTarget} lang={lang} label={t.map} />
        </aside>
      </main>

      <EmergencyOverlay active={alert} ackLabel={t.emergencyAck} />

      <PresenceDetector
        active={presenceOn && !alert}
        language={lang}
        onRecognized={(p) => {
          // Avoid spamming the welcome banner if same patient is in front of cam.
          if (recognizedIdRef.current === p.id) return;
          recognizedIdRef.current = p.id;
          setRecognizedPatient(p);
          const targetLang = (p.language && ['en', 'te', 'hi', 'ta'].includes(p.language)) ? p.language : lang;
          if (targetLang !== lang) {
            setAutoDetect(false);
            setLang(targetLang);
          }
          if (!primed) setPrimed(true);
          // Speak a quick localised greeting via TTS — instant, no GPT-4o call.
          const greetings = {
            en: `Welcome back, ${p.name}. Visit number ${p.visit_count}.`,
            te: `స్వాగతం, ${p.name}. సందర్శన నంబర్ ${p.visit_count}.`,
            hi: `स्वागत है, ${p.name}. यात्रा संख्या ${p.visit_count}.`,
            ta: `வரவேற்கிறோம், ${p.name}. வருகை எண் ${p.visit_count}.`,
          };
          voice.speak(greetings[targetLang] || greetings.en, targetLang);
          // Banner auto-clears after 8s; reset id so they can be re-greeted on a new session.
          setTimeout(() => {
            setRecognizedPatient(null);
            recognizedIdRef.current = null;
          }, 8000);
        }}
        onUnknownFaceLingering={() => {
          // Don't pop the modal if user is already mid-conversation.
          if (showRegister || alert || messages.length > 0) return;
          setShowRegister(true);
        }}
      />

      {showRegister && (
        <PatientRegistration
          lang={lang}
          onClose={() => setShowRegister(false)}
          onRegistered={(p) => {
            setRecognizedPatient({ name: p.name, visit_count: 1 });
            setTimeout(() => setShowRegister(false), 1800);
          }}
          onRecognized={(p) => {
            setRecognizedPatient(p);
            if (p.language && ['en', 'te', 'hi', 'ta'].includes(p.language)) {
              setAutoDetect(false);
              setLang(p.language);
            }
            setTimeout(() => setShowRegister(false), 1800);
          }}
        />
      )}
    </div>
  );
}
