import React, { useMemo } from 'react';

// Simple two-floor SVG map. Each room has an id matching `map_id` from the
// backend; setting `target` highlights the room and draws a route from the
// kiosk (the "you are here" star) to the destination.

const ROOMS = {
  // Ground floor (floor 0)
  reception:   { floor: 0, x: 220, y: 220, w: 120, h: 80, label: { en: 'Reception',   hi: 'रिसेप्शन' } },
  emergency:   { floor: 0, x:  20, y:  20, w: 160, h: 120, label: { en: 'Emergency',  hi: 'आपातकाल' }, danger: true },
  pharmacy:    { floor: 0, x: 380, y: 220, w: 110, h:  80, label: { en: 'Pharmacy',   hi: 'फार्मेसी' } },
  billing:     { floor: 0, x: 380, y: 110, w: 110, h:  80, label: { en: 'Billing',    hi: 'बिलिंग' } },
  lab:         { floor: 0, x:  20, y: 220, w: 160, h:  80, label: { en: 'Lab',        hi: 'लैब' } },
  amenities:   { floor: 0, x: 220, y: 110, w: 120, h:  80, label: { en: 'Cafe / ATM', hi: 'कैफ़े / एटीएम' } },
  // First floor
  opd:         { floor: 1, x:  40, y:  40, w: 220, h: 110, label: { en: 'General OPD',     hi: 'जनरल ओपीडी' } },
  specialty:   { floor: 1, x: 290, y:  40, w: 200, h: 110, label: { en: 'Specialty OPD',   hi: 'विशेषज्ञ ओपीडी' } },
  radiology:   { floor: 1, x:  40, y: 180, w: 220, h: 100, label: { en: 'Radiology',       hi: 'रेडियोलॉजी' } },
  pharmacy_f1: { floor: 1, x: 290, y: 180, w: 200, h: 100, label: { en: 'Sub-Pharmacy',    hi: 'उप फार्मेसी' } },
  // Second floor
  wards:       { floor: 2, x:  40, y:  40, w: 450, h: 100, label: { en: 'Inpatient Wards', hi: 'इनपेशेंट वार्ड' } },
  icu:         { floor: 2, x:  40, y: 170, w: 220, h: 110, label: { en: 'ICU',             hi: 'आईसीयू' } },
  ot:          { floor: 2, x: 290, y: 170, w: 200, h: 110, label: { en: 'Operation Theatre', hi: 'ऑपरेशन थिएटर' } },
};

const KIOSK = { floor: 0, x: 280, y: 320 }; // "You are here" anchor

const FLOORS = [0, 1, 2];

function targetFloor(target) {
  if (!target || !ROOMS[target]) return 0;
  return ROOMS[target].floor;
}

function center(room) {
  return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
}

function routePath(target) {
  if (!target || !ROOMS[target]) return null;
  const room = ROOMS[target];
  if (room.floor !== 0) {
    // Show route from kiosk to lifts (a stair icon near reception) on ground floor
    return `M ${KIOSK.x} ${KIOSK.y} L 340 320 L 340 270 L 280 270 L 280 220`;
  }
  const c = center(room);
  // L-shaped path from kiosk to room centre via reception
  return `M ${KIOSK.x} ${KIOSK.y} L 280 270 L ${c.x} 270 L ${c.x} ${c.y}`;
}

export default function IndoorMap({ target, lang, label }) {
  const tFloor = targetFloor(target);
  const floors = useMemo(() => FLOORS, []);

  return (
    <div className="map">
      <div className="map__title">{label}</div>
      <div className="map__floors">
        {floors.map((f) => {
          const isActive = f === tFloor;
          return (
            <div key={f} className={`map__floor${isActive ? ' map__floor--active' : ''}`}>
              <div className="map__floor-label">
                {f === 0 ? (lang === 'hi' ? 'भूतल' : 'Ground') : (lang === 'hi' ? `मंज़िल ${f}` : `Floor ${f}`)}
              </div>
              <svg viewBox="0 0 510 360" className="map__svg" aria-hidden>
                <rect x="2" y="2" width="506" height="356" rx="8" className="map__bg" />
                {Object.entries(ROOMS)
                  .filter(([, r]) => r.floor === f)
                  .map(([id, r]) => {
                    const highlight = id === target;
                    const cls = `map__room${r.danger ? ' map__room--danger' : ''}${highlight ? ' map__room--target' : ''}`;
                    return (
                      <g key={id}>
                        <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="6" className={cls} />
                        <text
                          x={r.x + r.w / 2}
                          y={r.y + r.h / 2 + 4}
                          textAnchor="middle"
                          className="map__room-label"
                        >
                          {r.label[lang] || r.label.en}
                        </text>
                      </g>
                    );
                  })}
                {/* Kiosk marker only on ground floor */}
                {f === 0 && (
                  <g>
                    <circle cx={KIOSK.x} cy={KIOSK.y} r="10" className="map__kiosk" />
                    <text x={KIOSK.x} y={KIOSK.y + 28} textAnchor="middle" className="map__kiosk-label">
                      {lang === 'hi' ? 'आप यहाँ' : 'You are here'}
                    </text>
                  </g>
                )}
                {/* Route on ground floor */}
                {f === 0 && target && (
                  <path d={routePath(target)} className="map__route" fill="none" />
                )}
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}
