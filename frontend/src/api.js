// Thin client around the FastAPI backend. Vite proxies /api → :8000 in dev.

const KIOSK_ID = 'kiosk-lobby-01';

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kiosk_id: KIOSK_ID, ...body }),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

export function sendIntent(text, language) {
  return postJSON('/api/intent', { text, language });
}

export function sendCard(cardId, language) {
  return postJSON('/api/card', { card_id: cardId, language });
}

export function sendStaffAlert(detail) {
  return postJSON('/api/staff-alert', { detail });
}

export async function fetchHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
