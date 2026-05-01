import React, { useRef, useState } from 'react';
import FaceCapture from './FaceCapture.jsx';

const STRINGS = {
  en: {
    title: 'Patient Registration',
    sub: 'Register your face for fast sign-in on future visits.',
    name: 'Full name',
    age: 'Age',
    phone: 'Phone',
    reason: 'Reason for visit',
    capture: 'Capture face',
    submit: 'Register',
    cancel: 'Cancel',
    success: (n) => `Welcome, ${n}! You are registered.`,
    needFace: 'Please capture your face first.',
    needName: 'Please enter your name.',
  },
  te: {
    title: 'రోగి నమోదు',
    sub: 'భవిష్యత్ సందర్శనల కోసం మీ ముఖాన్ని నమోదు చేయండి.',
    name: 'పూర్తి పేరు',
    age: 'వయస్సు',
    phone: 'ఫోన్',
    reason: 'సందర్శన కారణం',
    capture: 'ముఖాన్ని తీయండి',
    submit: 'నమోదు చేయండి',
    cancel: 'రద్దు',
    success: (n) => `స్వాగతం, ${n}! మీరు నమోదు అయ్యారు.`,
    needFace: 'దయచేసి మొదట మీ ముఖాన్ని తీయండి.',
    needName: 'దయచేసి మీ పేరు నమోదు చేయండి.',
  },
  hi: {
    title: 'रोगी पंजीकरण',
    sub: 'अगली बार जल्दी पहचान के लिए अपना चेहरा पंजीकृत करें।',
    name: 'पूरा नाम',
    age: 'आयु',
    phone: 'फ़ोन',
    reason: 'आने का कारण',
    capture: 'चेहरा कैप्चर करें',
    submit: 'पंजीकरण करें',
    cancel: 'रद्द करें',
    success: (n) => `स्वागत है, ${n}! आप पंजीकृत हैं।`,
    needFace: 'कृपया पहले अपना चेहरा कैप्चर करें।',
    needName: 'कृपया अपना नाम दर्ज करें।',
  },
  ta: {
    title: 'நோயாளி பதிவு',
    sub: 'அடுத்த வருகைக்கு வேகமாக அடையாளம் காண முகத்தை பதிவு செய்யவும்.',
    name: 'முழு பெயர்',
    age: 'வயது',
    phone: 'தொலைபேசி',
    reason: 'வந்த காரணம்',
    capture: 'முகத்தை எடு',
    submit: 'பதிவு செய்',
    cancel: 'ரத்து',
    success: (n) => `வரவேற்கிறோம், ${n}! நீங்கள் பதிவு செய்யப்பட்டுள்ளீர்கள்.`,
    needFace: 'முதலில் முகத்தை எடுக்கவும்.',
    needName: 'பெயரை உள்ளிடவும்.',
  },
};

export default function PatientRegistration({ lang = 'en', onClose, onRegistered, onRecognized }) {
  const t = STRINGS[lang] || STRINGS.en;
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [captured, setCaptured] = useState(null); // { descriptor, imageBlob }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const recognizingRef = useRef(false);
  const lastProbeAtRef = useRef(0);

  // Live recognition: every ~1.2s while a face is detected, send the
  // descriptor to /api/patients/recognize. On a hit, greet and close.
  const handleLiveDescriptor = async (descriptor) => {
    if (recognizingRef.current) return;
    if (done) return;
    const now = Date.now();
    if (now - lastProbeAtRef.current < 1200) return;
    lastProbeAtRef.current = now;
    recognizingRef.current = true;
    try {
      const res = await fetch('/api/patients/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor, language: lang }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.matched) {
          setDone({ id: data.id, name: data.name });
          onRecognized && onRecognized(data);
        }
      }
    } catch {
      // ignore — registration flow continues
    } finally {
      recognizingRef.current = false;
    }
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError(t.needName); return; }
    if (!captured) { setError(t.needFace); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('age', age.trim());
      fd.append('phone', phone.trim());
      fd.append('reason', reason.trim());
      fd.append('language', lang);
      fd.append('descriptor', JSON.stringify(captured.descriptor));
      if (captured.imageBlob) fd.append('image', captured.imageBlob, 'patient.jpg');
      const res = await fetch('/api/patients/register', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Registration failed');
        setSubmitting(false);
        return;
      }
      setDone(data);
      onRegistered && onRegistered(data);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>{t.title}</h2>
          <button className="ghost-btn" onClick={onClose}>✕</button>
        </div>
        <p className="modal__sub">{t.sub}</p>

        {done ? (
          <div className="modal__success">
            <div style={{ fontSize: 48 }}>✅</div>
            <h3>{t.success(done.name)}</h3>
            <button className="primary-btn" onClick={onClose}>OK</button>
          </div>
        ) : (
          <div className="reg-grid">
            <div className="reg-col">
              <FaceCapture
                onCapture={(c) => setCaptured(c)}
                onLiveDescriptor={handleLiveDescriptor}
                autoDetect
                captureLabel={captured ? '✓ Captured — Recapture' : t.capture}
              />
            </div>
            <div className="reg-col reg-col--form">
              <label>
                {t.name}
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </label>
              <label>
                {t.age}
                <input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" />
              </label>
              <label>
                {t.phone}
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
              </label>
              <label>
                {t.reason}
                <input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              {error && <div className="status status--error">⚠ {error}</div>}
              <div className="reg-actions">
                <button className="ghost-btn" onClick={onClose} disabled={submitting}>{t.cancel}</button>
                <button className="primary-btn" onClick={submit} disabled={submitting || !captured || !name.trim()}>
                  {submitting ? '…' : t.submit}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
