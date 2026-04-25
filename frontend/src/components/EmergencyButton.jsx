import React from 'react';

export default function EmergencyButton({ onClick, label }) {
  return (
    <button className="emergency-btn" onClick={onClick} aria-label={label}>
      <span className="emergency-btn__icon" aria-hidden>🚨</span>
      <span className="emergency-btn__label">{label}</span>
    </button>
  );
}

export function EmergencyOverlay({ active, ackLabel }) {
  if (!active) return null;
  return (
    <div className="emergency-overlay" role="alert">
      <div className="emergency-overlay__pulse" />
      <div className="emergency-overlay__msg">{ackLabel}</div>
    </div>
  );
}
