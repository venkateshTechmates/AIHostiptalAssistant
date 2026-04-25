import React from 'react';
import { HOME_CARDS } from '../i18n.js';

export function HomeCards({ onPick, t }) {
  return (
    <div className="cards cards--home">
      {HOME_CARDS.filter(c => c.id !== 'emergency').map(c => (
        <button key={c.id} className="card" onClick={() => onPick(c.id)}>
          <span className="card__icon" aria-hidden>{c.icon}</span>
          <span className="card__label">{t.cards[c.id]}</span>
        </button>
      ))}
    </div>
  );
}

export function ContextCards({ options, onPick }) {
  if (!options || options.length === 0) return null;
  return (
    <div className="cards cards--context">
      {options.map(o => (
        <button
          key={o.id}
          className={`card card--ctx${o.kind === 'doctor' ? ' card--doctor' : ''}`}
          onClick={() => onPick(o.id, o)}
        >
          {o.icon && <span className="card__icon" aria-hidden>{o.icon}</span>}
          <span className="card__label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
