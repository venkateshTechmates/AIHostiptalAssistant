import React, { useEffect, useRef, useState } from 'react';

/**
 * Animated SVG receptionist.
 *
 * - Idle: gentle breathing, periodic blink.
 * - Listening: subtle blue ring around the avatar.
 * - Speaking: mouth opens proportional to `mouthOpen` (0..1) which the parent
 *   drives from a Web Audio analyser hooked to the playing TTS audio.
 *   When no analyser is available we fall back to a sine-wave animation while
 *   `speaking` is true, so the avatar still looks alive.
 */
export default function Avatar({ speaking, listening, alert, mouthOpen = 0 }) {
  const [blink, setBlink] = useState(false);
  const [fakeMouth, setFakeMouth] = useState(0);
  const fakeStartRef = useRef(0);

  // Blink loop — random 4-6 s interval.
  useEffect(() => {
    let timer;
    const tick = () => {
      setBlink(true);
      setTimeout(() => setBlink(false), 140);
      timer = setTimeout(tick, 4000 + Math.random() * 2000);
    };
    timer = setTimeout(tick, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Fallback mouth animation when amplitude analyser isn't supplying data.
  useEffect(() => {
    if (!speaking) {
      setFakeMouth(0);
      return undefined;
    }
    fakeStartRef.current = performance.now();
    let raf;
    const loop = () => {
      const t = (performance.now() - fakeStartRef.current) / 1000;
      // Two superimposed sines for natural variation.
      const v = 0.35 + 0.3 * Math.sin(t * 9) + 0.2 * Math.sin(t * 13.7);
      setFakeMouth(Math.max(0, Math.min(1, v)));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  // Use analyser-driven amplitude when present, fall back to fakeMouth when 0.
  const open = speaking ? Math.max(mouthOpen, fakeMouth) : 0;
  const lipGap = 6 + open * 22;        // px — vertical mouth opening
  const lipWidth = 38 - open * 4;      // narrows slightly when open
  const eyeScale = blink ? 0.06 : 1;   // squashes eyes vertically
  const expression = alert ? 'concerned' : speaking ? 'speaking' : 'warm';

  return (
    <div className={`avatar avatar--${expression}${listening ? ' avatar--listening' : ''}`}>
      <svg viewBox="0 0 200 240" className="avatar__svg" aria-hidden>
        <defs>
          <linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e7f0ff" />
            <stop offset="1" stopColor="#f9fbff" />
          </linearGradient>
          <radialGradient id="cheek" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffb3a8" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffb3a8" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Background card */}
        <rect x="0" y="0" width="200" height="240" rx="18" fill="url(#bg-grad)" />

        {/* Listening pulse */}
        {listening && (
          <circle cx="100" cy="120" r="92" className="avatar__pulse" fill="none" />
        )}

        {/* Hospital uniform / neckline */}
        <path d="M 30 240 Q 30 175 100 175 Q 170 175 170 240 Z" fill="#ffffff" stroke="#dde6f1" strokeWidth="1.5" />
        {/* Lapel + ID */}
        <path d="M 78 178 L 100 200 L 122 178" fill="none" stroke="#0a6cff" strokeWidth="3" strokeLinecap="round" />
        <rect x="125" y="186" width="22" height="14" rx="2" fill="#0a6cff" />
        <rect x="128" y="190" width="16" height="2" rx="1" fill="#fff" />
        <rect x="128" y="194" width="11" height="1.6" rx="1" fill="#fff" />

        {/* Hair back */}
        <ellipse cx="100" cy="92" rx="60" ry="58" fill="#3b2820" />

        {/* Face */}
        <g className="avatar__head">
          <ellipse cx="100" cy="108" rx="50" ry="58" fill="#f3c89e" />
          {/* Cheeks */}
          <circle cx="74" cy="125" r="14" fill="url(#cheek)" />
          <circle cx="126" cy="125" r="14" fill="url(#cheek)" />

          {/* Eyebrows */}
          <path
            d={alert
              ? "M 70 86 Q 80 80 90 86 M 110 86 Q 120 80 130 86"
              : "M 70 88 Q 80 84 90 88 M 110 88 Q 120 84 130 88"}
            stroke="#3b2820"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />

          {/* Eyes (with blink via vertical scale) */}
          <g transform={`translate(80 102) scale(1 ${eyeScale})`}>
            <ellipse cx="0" cy="0" rx="6" ry="7" fill="#fff" stroke="#3b2820" strokeWidth="1.2" />
            <circle cx="0.5" cy="0.5" r="3.5" fill="#3b2820" />
            <circle cx="1.5" cy="-1.2" r="1.2" fill="#fff" />
          </g>
          <g transform={`translate(120 102) scale(1 ${eyeScale})`}>
            <ellipse cx="0" cy="0" rx="6" ry="7" fill="#fff" stroke="#3b2820" strokeWidth="1.2" />
            <circle cx="0.5" cy="0.5" r="3.5" fill="#3b2820" />
            <circle cx="1.5" cy="-1.2" r="1.2" fill="#fff" />
          </g>

          {/* Nose */}
          <path d="M 100 112 Q 96 130 100 138 Q 104 140 106 138" fill="none" stroke="#c89673" strokeWidth="1.6" strokeLinecap="round" />

          {/* Mouth (lip-sync) */}
          <g transform="translate(100 152)">
            <ellipse
              cx="0"
              cy="0"
              rx={lipWidth / 2}
              ry={Math.max(2, lipGap / 2)}
              fill="#5a1f1f"
            />
            {/* Upper lip */}
            <path
              d={`M ${-lipWidth / 2} 0 Q ${-lipWidth / 4} ${-3 - open * 1.5} 0 ${-2 - open * 1.5} Q ${lipWidth / 4} ${-3 - open * 1.5} ${lipWidth / 2} 0`}
              fill="#c84a4a"
            />
            {/* Lower lip */}
            <path
              d={`M ${-lipWidth / 2} 0 Q 0 ${lipGap / 2 + 3} ${lipWidth / 2} 0`}
              fill="#d96565"
            />
            {/* Teeth hint when open */}
            {open > 0.25 && (
              <rect
                x={-lipWidth / 2 + 5}
                y={-1}
                width={lipWidth - 10}
                height={Math.min(5, open * 6)}
                rx="1"
                fill="#fff8ee"
              />
            )}
          </g>

          {/* Smile cue */}
          {!alert && (
            <path d="M 86 162 Q 100 168 114 162" stroke="#a64545" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.5" />
          )}
        </g>

        {/* Hair front fringe */}
        <path d="M 50 70 Q 100 30 150 70 Q 138 84 100 80 Q 62 84 50 70 Z" fill="#3b2820" />

        {/* Stethoscope */}
        <path
          d="M 80 180 Q 70 210 95 218 Q 120 226 130 200"
          fill="none"
          stroke="#1a1a1a"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="132" cy="198" r="5" fill="#1a1a1a" />
        <circle cx="132" cy="198" r="2.5" fill="#5a5a5a" />
      </svg>
      <div className="avatar__label">
        {listening ? '● Listening' : speaking ? '● Speaking' : alert ? '● Emergency' : ''}
      </div>
    </div>
  );
}
