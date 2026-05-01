import React, { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';

// Models served from the official face-api.js GitHub Pages CDN.
// (Switch to /models on your own host in production.)
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
 * Webcam preview with continuous face detection. Shows a green box around
 * the detected face. `onCapture` is called when the user clicks Capture
 * with: { descriptor: [128 floats], imageBlob: Blob }.
 */
export default function FaceCapture({ onCapture, onLiveDescriptor, autoDetect = false, captureLabel = 'Capture' }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const lastDetectTsRef = useRef(0);
  const [status, setStatus] = useState('Loading face models…');
  const [hasFace, setHasFace] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Boot: load models, request webcam, start preview loop.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureModels();
        if (cancelled) return;
        setStatus('Requesting camera…');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus('Look at the camera');
        runDetectLoop();
      } catch (e) {
        if (!cancelled) setError(String(e.message || e));
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runDetectLoop = () => {
    const tick = async () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || v.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // Throttle expensive detector to ~3 fps.
      const now = performance.now();
      if (now - lastDetectTsRef.current > 350) {
        lastDetectTsRef.current = now;
        try {
          const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 256, scoreThreshold: 0.4 });
          const detection = await faceapi
            .detectSingleFace(v, opts)
            .withFaceLandmarks(true)        // tiny landmark net
            .withFaceDescriptor();
          const ctx = c.getContext('2d');
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          ctx.clearRect(0, 0, c.width, c.height);
          if (detection) {
            const box = detection.detection.box;
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#22c55e';
            ctx.strokeRect(box.x, box.y, box.width, box.height);
            setHasFace(true);
            // Auto-detect: report descriptor up so parent can recognize.
            if (autoDetect && onLiveDescriptor) {
              onLiveDescriptor(Array.from(detection.descriptor));
            }
          } else {
            setHasFace(false);
          }
        } catch (e) {
          // detection blip — keep going
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const handleCapture = async () => {
    if (busy) return;
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    setBusy(true);
    setStatus('Capturing…');
    try {
      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
      const detection = await faceapi
        .detectSingleFace(v, opts)
        .withFaceLandmarks(true)
        .withFaceDescriptor();
      if (!detection) {
        setStatus('No face detected — please face the camera');
        setBusy(false);
        return;
      }
      // Snap a JPEG of the current video frame.
      const cap = document.createElement('canvas');
      cap.width = v.videoWidth;
      cap.height = v.videoHeight;
      cap.getContext('2d').drawImage(v, 0, 0, cap.width, cap.height);
      const blob = await new Promise((resolve) => cap.toBlob(resolve, 'image/jpeg', 0.85));
      onCapture && onCapture({
        descriptor: Array.from(detection.descriptor),
        imageBlob: blob,
      });
      setStatus('Captured ✓');
    } catch (e) {
      setStatus('Capture failed');
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="face-capture">
      <div className="face-capture__stage">
        <video ref={videoRef} className="face-capture__video" muted playsInline />
        <canvas ref={canvasRef} className="face-capture__overlay" />
      </div>
      <div className="face-capture__status">
        {error ? <span style={{ color: '#dc2626' }}>⚠ {error}</span>
          : <span>{status}{hasFace ? ' • face detected' : ''}</span>}
      </div>
      {onCapture && (
        <button
          className="primary-btn"
          onClick={handleCapture}
          disabled={busy || !hasFace}
        >
          📸 {captureLabel}
        </button>
      )}
    </div>
  );
}
