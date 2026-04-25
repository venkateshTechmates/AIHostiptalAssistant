import { useCallback, useEffect, useRef, useState } from 'react';

// Continuous-streaming voice hook with barge-in.
//
// - SpeechRecognition runs in `continuous: true` mode and auto-restarts on
//   end so the kiosk is always listening while enabled.
// - The recogniser stays ON during TTS playback so the user can INTERRUPT
//   the agent — any detected user speech immediately cancels the agent's
//   audio and the user's words are routed to the backend as normal.
// - To prevent the avatar transcribing its own playback (a real risk on
//   laptops without echo-cancellation), interim results are compared
//   against the agent's current reply: substantial overlap is treated as
//   self-echo and discarded.

const SpeechRecognitionCtor =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

// Strip punctuation/diacritic-light stuff and collapse whitespace.
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[.,!?;:'"()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Reasonable check for whether the recogniser has just transcribed a chunk
// of the agent's own reply through the speakers.
function isAgentEcho(heard, agentReply) {
  const h = normalize(heard);
  const a = normalize(agentReply);
  if (!h || !a) return false;
  if (h.length < 4) return false;
  // If at least 4 consecutive words from `h` appear in `a`, call it echo.
  const words = h.split(' ');
  if (words.length < 2) return a.includes(h);
  for (let n = Math.min(6, words.length); n >= 3; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      if (a.includes(phrase)) return true;
    }
  }
  // Fallback: high character overlap.
  return a.includes(h.slice(0, Math.min(h.length, 20)));
}

export function useVoice({ locale = 'en-US', onTranscript } = {}) {
  const recogRef = useRef(null);
  const audioCtxRef = useRef(null);
  const audioElRef = useRef(null);
  const sourceRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(0);
  const desiredRef = useRef(false);
  const speakingRef = useRef(false);
  const restartTimerRef = useRef(0);
  const lastAgentReplyRef = useRef('');
  const cancelSpeechRef = useRef(null);

  const [enabled, setEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [mouthOpen, setMouthOpen] = useState(0);

  const supported =
    Boolean(SpeechRecognitionCtor) &&
    typeof window !== 'undefined' &&
    'speechSynthesis' in window;

  // ----- Recognition setup ----------------------------------------------
  useEffect(() => {
    if (!SpeechRecognitionCtor) return undefined;
    const r = new SpeechRecognitionCtor();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.lang = locale;
    recogRef.current = r;
    return () => {
      try { r.abort(); } catch { /* noop */ }
    };
  }, [locale]);

  const safeStart = useCallback(() => {
    const r = recogRef.current;
    if (!r) return;
    if (!desiredRef.current) return;
    try { r.start(); } catch { /* already started */ }
  }, []);

  const scheduleRestart = useCallback((delay = 200) => {
    clearTimeout(restartTimerRef.current);
    restartTimerRef.current = setTimeout(safeStart, delay);
  }, [safeStart]);

  useEffect(() => {
    const r = recogRef.current;
    if (!r) return;
    r.onstart = () => setListening(true);
    r.onend = () => {
      setListening(false);
      setInterim('');
      scheduleRestart(120);
    };
    r.onerror = (e) => {
      setListening(false);
      setInterim('');
      const fatal = e?.error === 'not-allowed' || e?.error === 'service-not-allowed';
      if (!fatal) scheduleRestart(400);
      else { desiredRef.current = false; setEnabled(false); }
    };
    r.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const seg = event.results[i];
        if (seg.isFinal) finalText += seg[0].transcript;
        else interimText += seg[0].transcript;
      }
      const heard = (interimText + ' ' + finalText).trim();

      // While the agent is speaking, discriminate between self-echo and a
      // genuine user barge-in.
      if (speakingRef.current) {
        if (isAgentEcho(heard, lastAgentReplyRef.current)) {
          return; // ignore — that was our own voice playing back
        }
        if (heard.length >= 3) {
          // Real barge-in — cancel the agent immediately.
          cancelSpeechRef.current && cancelSpeechRef.current();
        } else {
          return; // too short to act on
        }
      }

      if (interimText) setInterim(interimText);
      if (finalText && onTranscript) {
        const cleaned = finalText.trim();
        if (cleaned) onTranscript(cleaned);
      }
    };
    // Auto-start once handlers are wired so a brand-new recogniser (e.g.
    // after a language change) immediately joins the streaming loop.
    if (desiredRef.current) scheduleRestart(0);
  }, [onTranscript, scheduleRestart, locale]);

  // ----- Mute toggle / external start-stop ------------------------------
  const setListeningEnabled = useCallback((on) => {
    desiredRef.current = on;
    setEnabled(on);
    const r = recogRef.current;
    if (!r) return;
    if (on) scheduleRestart(0);
    else {
      clearTimeout(restartTimerRef.current);
      try { r.stop(); } catch { /* noop */ }
    }
  }, [scheduleRestart]);

  const start = useCallback(() => setListeningEnabled(true), [setListeningEnabled]);
  const stop = useCallback(() => setListeningEnabled(false), [setListeningEnabled]);

  // ----- TTS playback + amplitude → mouthOpen --------------------------
  const stopAnalyser = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setMouthOpen(0);
  }, []);

  const cancelSpeech = useCallback(() => {
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
        audioElRef.current.src = '';
      } catch { /* noop */ }
    }
    stopAnalyser();
    speakingRef.current = false;
    setSpeaking(false);
  }, [stopAnalyser]);

  // Expose cancelSpeech to the recogniser handler via ref (closure-safe).
  useEffect(() => {
    cancelSpeechRef.current = cancelSpeech;
  }, [cancelSpeech]);

  const playAudio = useCallback((blob) => new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    let audio = audioElRef.current;
    if (!audio) {
      audio = new Audio();
      audioElRef.current = audio;
    }
    audio.src = url;
    audio.crossOrigin = 'anonymous';

    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      if (ctx) {
        if (!sourceRef.current) {
          sourceRef.current = ctx.createMediaElementSource(audio);
          analyserRef.current = ctx.createAnalyser();
          analyserRef.current.fftSize = 256;
          sourceRef.current.connect(analyserRef.current);
          analyserRef.current.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
      }
    } catch { /* analyser optional */ }

    const an = analyserRef.current;
    const data = an ? new Uint8Array(an.frequencyBinCount) : null;
    const tick = () => {
      if (an && data) {
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setMouthOpen(Math.max(0, Math.min(1, rms * 6)));
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    audio.onplay = () => {
      setSpeaking(true);
      speakingRef.current = true;
      rafRef.current = requestAnimationFrame(tick);
    };
    audio.onended = () => {
      setSpeaking(false);
      speakingRef.current = false;
      stopAnalyser();
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onerror = () => {
      setSpeaking(false);
      speakingRef.current = false;
      stopAnalyser();
      URL.revokeObjectURL(url);
      resolve();
    };
    // pause(): treats barge-in cancellations as a normal end so we don't
    // wait forever on the promise.
    audio.onpause = () => {
      setSpeaking(false);
      speakingRef.current = false;
      stopAnalyser();
      resolve();
    };
    audio.play().catch(() => {
      setSpeaking(false);
      speakingRef.current = false;
      resolve();
    });
  }), [stopAnalyser]);

  const browserSpeak = useCallback((text) => new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = locale;
    utter.rate = 0.98;
    utter.pitch = 1.0;
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find((v) => v.lang === locale)
        || voices.find((v) => v.lang.startsWith(locale.split('-')[0]));
      if (v) utter.voice = v;
      window.speechSynthesis.speak(utter);
    };
    utter.onstart = () => { setSpeaking(true); speakingRef.current = true; };
    utter.onend = () => { setSpeaking(false); speakingRef.current = false; setMouthOpen(0); resolve(); };
    utter.onerror = () => { setSpeaking(false); speakingRef.current = false; setMouthOpen(0); resolve(); };
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        pickVoice();
      };
    } else {
      pickVoice();
    }
  }), [locale]);

  const speak = useCallback(async (text, language) => {
    if (!text) return;
    cancelSpeech();
    lastAgentReplyRef.current = text;
    speakingRef.current = true;
    // Keep the recogniser ON for barge-in. Make sure it's running.
    if (desiredRef.current) safeStart();
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language: language || 'en' }),
      });
      if (res.status === 200) {
        const blob = await res.blob();
        await playAudio(blob);
      } else {
        await browserSpeak(text);
      }
    } catch {
      await browserSpeak(text);
    }
    speakingRef.current = false;
    if (desiredRef.current) scheduleRestart(0);
  }, [browserSpeak, cancelSpeech, playAudio, safeStart, scheduleRestart]);

  return {
    supported,
    enabled,
    listening,
    speaking,
    interim,
    mouthOpen,
    start,
    stop,
    speak,
    cancelSpeech,
    setListeningEnabled,
  };
}
