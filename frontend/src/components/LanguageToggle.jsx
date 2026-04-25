import React from 'react';

export default function LanguageToggle({ value, onChange, languages }) {
  return (
    <div className="lang" role="group" aria-label="Language">
      {languages.map((l) => (
        <button
          key={l.code}
          className={`lang__btn${value === l.code ? ' lang__btn--on' : ''}`}
          onClick={() => onChange(l.code)}
          aria-pressed={value === l.code}
          title={l.name}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
