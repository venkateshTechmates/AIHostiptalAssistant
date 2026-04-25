import React, { useEffect, useRef } from 'react';

export default function Transcript({ messages, interim, t }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, interim]);

  return (
    <div className="transcript" aria-live="polite">
      {messages.map((m, i) => (
        <div key={i} className={`bubble bubble--${m.who}`}>
          <div className="bubble__who">{m.who === 'user' ? t.youSaid : t.agent}</div>
          <div className="bubble__text">{m.text}</div>
        </div>
      ))}
      {interim && (
        <div className="bubble bubble--user bubble--interim">
          <div className="bubble__who">{t.youSaid}</div>
          <div className="bubble__text">{interim}…</div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
