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

export function useVoice({ locale = 'en-US', onTranscript, whisperMode = false, onDetectedLanguage } = {}) {
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

  // Whisper-mode (auto-detect) recording state
  const micStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const vadCtxRef = useRef(null);
  const vadAnalyserRef = useRef(null);
  const vadRafRef = useRef(0);
  const isRecordingRef = useRef(false);
  const speechStartedRef = useRef(false);
  const silenceTimerRef = useRef(0);

  const [enabled, setEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [mouthOpen, setMouthOpen] = useState(0);

  const supported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    (whisperMode ? Boolean(navigator?.mediaDevices?.getUserMedia) : Boolean(SpeechRecognitionCtor));

  // ----- Recognition setup (browser SR — non-Whisper mode) -------------
  useEffect(() => {
    if (whisperMode) return undefined;             // Whisper path skips SR
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
  }, [locale, whisperMode]);

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
    if (whisperMode) return;
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
  }, [onTranscript, scheduleRestart, locale, whisperMode]);

  // ----- Whisper-mode (auto-detect) recording ---------------------------
  // Voice-activity-driven recorder: capture audio while user speaks, stop
  // on ~1.2s of silence, send blob to /api/stt, then resume.

  const stopWhisperRecording = useCallback(() => {
    cancelAnimationFrame(vadRafRef.current);
    vadRafRef.current = 0;
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = 0;
    isRecordingRef.current = false;
    speechStartedRef.current = false;
    setListening(false);
    try { recorderRef.current?.state === 'recording' && recorderRef.current.stop(); } catch { /* noop */ }
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    micStreamRef.current = null;
    recorderRef.current = null;
    try { vadCtxRef.current?.close(); } catch { /* noop */ }
    vadCtxRef.current = null;
    vadAnalyserRef.current = null;
  }, []);

  const sendWhisperBlob = useCallback(async (blob) => {
    if (!blob || blob.size < 1200) return; // ignore < ~50ms of audio
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'utterance.webm');
      fd.append('language', 'auto');
      const res = await fetch('/api/stt', { method: 'POST', body: fd });
      if (!res.ok) return;
      const data = await res.json();
      const text = (data.text || '').trim();
      if (!text) return;
      if (data.language && onDetectedLanguage) onDetectedLanguage(data.language);
      if (onTranscript) onTranscript(text, data.language || null);
    } catch (e) {
      // network blip — drop the utterance, VAD loop continues
      console.warn('[whisper] /api/stt failed', e);
    }
  }, [onTranscript, onDetectedLanguage]);

  const startWhisperRecording = useCallback(async () => {
    if (!whisperMode || isRecordingRef.current) return;
    if (!navigator?.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = stream;

      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      vadCtxRef.current = ctx;
      vadAnalyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const SPEECH_THRESHOLD = 0.025;       // RMS amplitude
      const SILENCE_MS = 1200;
      const MIN_SPEECH_MS = 350;
      let speechStartTs = 0;

      const startUtterance = () => {
        if (recorderRef.current?.state === 'recording') return;
        recordChunksRef.current = [];
        const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordChunksRef.current.push(e.data); };
        mr.onstop = () => {
          const chunks = recordChunksRef.current;
          recordChunksRef.current = [];
          if (!chunks.length) return;
          const blob = new Blob(chunks, { type: 'audio/webm' });
          // Only send if utterance was at least MIN_SPEECH_MS long.
          if (Date.now() - speechStartTs >= MIN_SPEECH_MS) sendWhisperBlob(blob);
        };
        mr.start(250);
        recorderRef.current = mr;
        speechStartTs = Date.now();
        setListening(true);
      };

      const endUtterance = () => {
        const mr = recorderRef.current;
        if (mr && mr.state === 'recording') {
          try { mr.stop(); } catch { /* noop */ }
        }
        setListening(false);
        speechStartedRef.current = false;
      };

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);

        // While agent speaks, treat user audio as potential barge-in but
        // only after a clear, sustained user voice burst.
        if (speakingRef.current && rms < SPEECH_THRESHOLD * 1.5) {
          // skip — likely echo or quiet
        } else if (rms > SPEECH_THRESHOLD) {
          if (speakingRef.current) cancelSpeechRef.current && cancelSpeechRef.current();
          if (!speechStartedRef.current) {
            speechStartedRef.current = true;
            startUtterance();
          }
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = 0;
        } else if (speechStartedRef.current && !silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            silenceTimerRef.current = 0;
            endUtterance();
          }, SILENCE_MS);
        }

        vadRafRef.current = requestAnimationFrame(tick);
      };

      isRecordingRef.current = true;
      vadRafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.warn('[whisper] getUserMedia failed', e);
      desiredRef.current = false;
      setEnabled(false);
    }
  }, [sendWhisperBlob, whisperMode]);

  // ----- Mute toggle / external start-stop ------------------------------
  const setListeningEnabled = useCallback((on) => {
    desiredRef.current = on;
    setEnabled(on);
    if (whisperMode) {
      if (on) startWhisperRecording();
      else stopWhisperRecording();
      return;
    }
    const r = recogRef.current;
    if (!r) return;
    if (on) scheduleRestart(0);
    else {
      clearTimeout(restartTimerRef.current);
      try { r.stop(); } catch { /* noop */ }
    }
  }, [scheduleRestart, whisperMode, startWhisperRecording, stopWhisperRecording]);

  // Restart recording when whisperMode flips on after the user has primed.
  useEffect(() => {
    if (whisperMode && desiredRef.current && !isRecordingRef.current) {
      startWhisperRecording();
    }
    if (!whisperMode && isRecordingRef.current) {
      stopWhisperRecording();
    }
    return undefined;
  }, [whisperMode, startWhisperRecording, stopWhisperRecording]);

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

  const browserSpeak = useCallback((text, langOverride) => new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    const targetLocale = langOverride || locale;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = targetLocale;
    // Slow, deliberate cadence — railway-announcer feel.
    utter.rate = 0.86;
    utter.pitch = 1.0;
    utter.volume = 1.0;
    const baseLang = targetLocale.split('-')[0];
    // Score voices and pick the best native one. Prefer:
    //  1. Exact locale match (te-IN over te-...)
    //  2. "Natural"/"Neural"/"Online" voices (Microsoft Edge/Win11 high-quality)
    //  3. Any voice whose language code begins with our base lang
    const scoreVoice = (v) => {
      let s = 0;
      if (v.lang === targetLocale) s += 100;
      else if (v.lang.startsWith(baseLang)) s += 40;
      const n = (v.name || '').toLowerCase();
      if (n.includes('natural')) s += 30;
      if (n.includes('neural')) s += 25;
      if (n.includes('online')) s += 15;
      // Common Windows Indian voices.
      if (n.includes('heera')) s += 20;     // Telugu
      if (n.includes('shruti')) s += 20;    // Telugu (Azure)
      if (n.includes('mohan')) s += 18;     // Telugu (Azure)
      if (n.includes('kalpana')) s += 18;   // Hindi
      if (n.includes('hemant')) s += 18;    // Hindi
      if (n.includes('valluvar')) s += 18;  // Tamil
      if (n.includes('pallavi')) s += 18;   // Tamil
      return s;
    };
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const ranked = voices
        .filter((v) => v.lang === targetLocale || v.lang.startsWith(baseLang))
        .map((v) => ({ v, s: scoreVoice(v) }))
        .sort((a, b) => b.s - a.s);
      const best = ranked[0]?.v;
      if (best) utter.voice = best;
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
    // Map kiosk lang code -> BCP-47 locale for browser TTS voice selection.
    const localeFor = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN', ta: 'ta-IN' };
    const browserLocale = localeFor[language] || locale;
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
        // Backend returned 204 (or non-200) → use OS-native voice for the lang.
        await browserSpeak(text, browserLocale);
      }
    } catch {
      await browserSpeak(text, browserLocale);
    }
    speakingRef.current = false;
    if (desiredRef.current) scheduleRestart(0);
  }, [browserSpeak, cancelSpeech, playAudio, safeStart, scheduleRestart, locale]);

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
