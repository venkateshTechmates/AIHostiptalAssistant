import React from 'react';

export default function MicButton({ listening, speaking, supported, onPress, label }) {
  if (!supported) {
    return (
      <button className="mic mic--disabled" disabled aria-disabled="true">
        <span className="mic__icon">🎤</span>
        <span className="mic__label">{label}</span>
      </button>
    );
  }
  const cls = `mic${listening ? ' mic--on' : ''}${speaking ? ' mic--speaking' : ''}`;
  return (
    <button className={cls} onClick={onPress} aria-pressed={listening}>
      <span className="mic__icon" aria-hidden>{listening ? '●' : '🎤'}</span>
      <span className="mic__label">{label}</span>
      {listening && <span className="mic__ring" aria-hidden />}
    </button>
  );
}
