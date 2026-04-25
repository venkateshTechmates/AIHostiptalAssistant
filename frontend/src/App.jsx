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

const IDLE_MS = 60_000;          // session auto-clear after a full minute
const NUDGE_INTERVAL_MS = 5_000; // re-engage every 5 s while idle
const MAX_NUDGES = 3;            // before reverting to home

export default function App() {
  const [lang, setLang] = useState('en');
  const [messages, setMessages] = useState([]);
  const [options, setOptions] = useState([]);
  const [mapTarget, setMapTarget] = useState(null);
  const [alert, setAlert] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState(null);
  const [engine, setEngine] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [primed, setPrimed] = useState(false);    // first user gesture happened
  const lastReplyRef = useRef('');
  const idleTimerRef = useRef(null);
  const nudgeTimerRef = useRef(null);
  const nudgeCountRef = useRef(0);

  const t = STRINGS[lang];

  useEffect(() => {
    fetchHealth().then((h) => setAiEnabled(Boolean(h?.ai_enabled))).catch(() => {});
  }, []);

  // Voice hook — listens continuously after the first interaction.
  const handleTranscriptRef = useRef(() => {});
  const onTranscript = useCallback((text) => handleTranscriptRef.current(text), []);
  const voice = useVoice({ locale: t.locale, onTranscript });

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
      sendStaffAlert({ intent: res.intent, language: lang }).catch(() => {});
    }
    if (res.reply) {
      lastReplyRef.current = res.reply;
      voice.speak(res.reply, lang);
    }
  }, [voice, lang]);

  const submitText = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    cancelNudge();
    nudgeCountRef.current = 0;
    setThinking(true);
    try {
      const res = await sendIntent(trimmed, lang);
      applyResponse(res, trimmed);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setThinking(false);
    }
  }, [applyResponse, cancelNudge, lang]);

  useEffect(() => {
    handleTranscriptRef.current = (text) => submitText(text);
  }, [submitText]);

  const submitCard = useCallback(async (cardId, opt) => {
    cancelNudge();
    nudgeCountRef.current = 0;
    setThinking(true);
    if (!primed) setPrimed(true);
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
          <LanguageToggle value={lang} onChange={setLang} languages={LANGUAGES} />
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
    </div>
  );
}
