import React, { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';

const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

let modelsReady = false;
let modelsLoading = null;
async function ensureModels() {
  if (modelsReady) return;
  if (modelsLoading) return modelsLoading;
  modelsLoading = (async () => {
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    modelsReady = true;
  })();
  return modelsLoading;
}

/**
 * Ambient webcam-driven face presence + recognition.
 *
 * Runs whenever `active` is true. Continuously detects faces (~2 fps).
 * When the same face is seen on multiple frames, sends its 128-D
 * descriptor to /api/patients/recognize. On a hit → onRecognized(patient).
 * After UNKNOWN_FACE_GRACE_MS of seeing an unrecognised face, fires
 * onUnknownFaceLingering() so the parent can prompt registration.
 *
 * Renders a small floating webcam preview at the bottom-right (toggleable).
 */
const RECOGNIZE_INTERVAL_MS = 2000;
const UNKNOWN_FACE_GRACE_MS = 6000;

export default function PresenceDetector({
  active = false,
  onRecognized,
  onUnknownFaceLingering,
  language = 'en',
}) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const lastDetectAtRef = useRef(0);
  const lastRecogAtRef = useRef(0);
  const recogBusyRef = useRef(false);
  const firstSeenAtRef = useRef(0);
  const lastMatchIdRef = useRef(null);
  const unknownPromptedRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState('initialising…');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!active) {
      stopAll();
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading models…');
        await ensureModels();
        if (cancelled) return;
        setStatus('starting camera…');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus('watching…');
        loop();
      } catch (e) {
        if (!cancelled) setError(String(e.message || e));
      }
    })();
    return () => { cancelled = true; stopAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const stopAll = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    streamRef.current = null;
    firstSeenAtRef.current = 0;
    unknownPromptedRef.current = false;
    lastMatchIdRef.current = null;
  };

  const loop = () => {
    const tick = async () => {
      const v = videoRef.current;
      const c = overlayRef.current;
      if (!v || v.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const now = performance.now();
      // Detect at ~2 fps for low CPU.
      if (now - lastDetectAtRef.current > 500) {
        lastDetectAtRef.current = now;
        try {
          const opts = new faceapi.TinyFaceDetectorOptions({
            inputSize: 224, scoreThreshold: 0.4,
          });
          const det = await faceapi
            .detectSingleFace(v, opts)
            .withFaceLandmarks(true)
            .withFaceDescriptor();
          if (c) {
            const ctx = c.getContext('2d');
            c.width = v.videoWidth || 320;
            c.height = v.videoHeight || 240;
            ctx.clearRect(0, 0, c.width, c.height);
            if (det) {
              const b = det.detection.box;
              ctx.lineWidth = 3;
              ctx.strokeStyle = lastMatchIdRef.current ? '#10b981' : '#f59e0b';
              ctx.strokeRect(b.x, b.y, b.width, b.height);
            }
          }
          if (det) {
            if (!firstSeenAtRef.current) firstSeenAtRef.current = Date.now();
            // Throttle recognition probes.
            if (!recogBusyRef.current && now - lastRecogAtRef.current > RECOGNIZE_INTERVAL_MS) {
              lastRecogAtRef.current = now;
              recogBusyRef.current = true;
              probe(Array.from(det.descriptor));
            }
          } else {
            // Face left frame — reset state.
            if (firstSeenAtRef.current) {
              firstSeenAtRef.current = 0;
              unknownPromptedRef.current = false;
              lastMatchIdRef.current = null;
            }
          }
        } catch {}
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const probe = async (descriptor) => {
    try {
      const res = await fetch('/api/patients/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor, language }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.matched) {
        if (lastMatchIdRef.current !== data.id) {
          lastMatchIdRef.current = data.id;
          unknownPromptedRef.current = false;
          setStatus(`hi, ${data.name}`);
          onRecognized && onRecognized(data);
        }
      } else {
        // No match. If we've seen this unknown face long enough, prompt register.
        const seenFor = Date.now() - (firstSeenAtRef.current || Date.now());
        if (!unknownPromptedRef.current && seenFor >= UNKNOWN_FACE_GRACE_MS) {
          unknownPromptedRef.current = true;
          setStatus('unknown face');
          onUnknownFaceLingering && onUnknownFaceLingering();
        }
      }
    } catch {} finally {
      recogBusyRef.current = false;
    }
  };

  if (!active) return null;

  return (
    <div className={`presence${collapsed ? ' presence--mini' : ''}`}>
      <div className="presence__head">
        <span className="presence__dot" />
        <span className="presence__title">Camera</span>
        <button
          className="presence__btn"
          onClick={() => setCollapsed((v) => !v)}
          aria-label="Toggle camera preview"
        >
          {collapsed ? '▢' : '–'}
        </button>
      </div>
      {!collapsed && (
        <div className="presence__stage">
          <video ref={videoRef} className="presence__video" muted playsInline />
          <canvas ref={overlayRef} className="presence__overlay" />
          <div className="presence__status">
            {error ? <span style={{ color: '#fca5a5' }}>⚠ {error}</span> : status}
          </div>
        </div>
      )}
    </div>
  );
}
