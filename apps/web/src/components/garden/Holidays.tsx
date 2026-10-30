import type { HolidayId } from '@logbook/core';

/**
 * Holidays in the garden (D108, D109), in the newest bed while each lasts: jack-o'-lanterns, a
 * Christmas tree with presents, fireworks, a birthday cake, or Easter eggs to find among the plants.
 * Decorations are hidden from screen readers; the eggs are buttons. What moves (candle flames, tree
 * lights, sparks) stays still when motion is reduced (app.css).
 */

/** A holiday's decorations, at the front of the bed's ground, on the right (app.css). Easter's are its eggs. */
export function HolidayDecor({ id }: { id: Exclude<HolidayId, 'easter'> }) {
  return (
    <li className="garden-holiday" data-holiday={id} aria-hidden="true">
      {id === 'halloween' && (
        <>
          <JackOLantern />
          <JackOLantern />
          <JackOLantern />
        </>
      )}
      {id === 'christmas' && (
        <>
          <ChristmasTree />
          <Present colour="#c8102e" ribbon="#f2c94c" />
          <Present colour="#1f6b3a" ribbon="#f4f1ea" />
        </>
      )}
      {id === 'newyear' && (
        <>
          <Firework colour="#f2c94c" />
          <Firework colour="#ff7aa8" />
          <Firework colour="#7fd3ff" />
        </>
      )}
      {id === 'birthday' && (
        <>
          <Balloon colour="#ff5a8a" />
          <Cake />
          <Balloon colour="#4fa3ff" />
        </>
      )}
    </li>
  );
}

const EGG_PAINT: [string, string][] = [
  ['#ffb3cf', '#c2185b'],
  ['#b9e8ff', '#1f6fa8'],
  ['#fff0a8', '#b07a00'],
  ['#c8f2cf', '#2f7356'],
];

/** A painted egg among the plants, to tap and find. */
export function EasterEgg({ index, found, onFind }: { index: number; found: boolean; onFind: (egg: number) => void }) {
  const [shell, stripe] = EGG_PAINT[index % EGG_PAINT.length]!;
  return (
    <li className="garden-egg-spot">
      <button type="button" className="garden-egg" data-found={found || undefined} aria-label={found ? 'An egg you found' : 'A painted egg: find it'} aria-pressed={found} onClick={() => onFind(index)}>
        <svg viewBox="0 0 24 30" aria-hidden="true" focusable="false">
          <path d="M12 2C6.5 2 3 11 3 18a9 9 0 0 0 18 0c0-7-3.5-16-9-16z" fill={shell} stroke={stripe} strokeWidth={1.2} />
          <path d="M3.6 15c3 2 5.6-1 8.4 0s5.4 2 8.4 0M4 21c2.6 1.6 5.4-1 8 0s5.4 1.6 8 0" fill="none" stroke={stripe} strokeWidth={1.4} strokeLinecap="round" />
        </svg>
        {found && <span className="garden-egg-shine" aria-hidden="true">✦</span>}
      </button>
    </li>
  );
}

/** A jack-o'-lantern: a carved pumpkin with a candle glowing through its face. */
function JackOLantern() {
  return (
    <svg viewBox="0 0 32 32" focusable="false">
      <path d="M16 6c-1-2-.5-4 1.5-5" fill="none" stroke="#4e6b2a" strokeWidth={2.2} strokeLinecap="round" />
      <ellipse cx={16} cy={19} rx={14} ry={11} fill="#e8731c" stroke="#9c4508" strokeWidth={1.4} />
      <path d="M11 9c-2 6-2 14 0 20M21 9c2 6 2 14 0 20M16 8v22" fill="none" stroke="#c75c12" strokeWidth={1.1} />
      <g className="holiday-glow" fill="#ffd34d">
        <path d="M8.5 16l3.5-3 3 3z" />
        <path d="M17 16l3-3 3.5 3z" />
        <path d="M8 21c3 4 13 4 16 0l-2.5 1.5-1.5-1.5-2 2-2-2-2 2-2-2-1.5 1.5z" />
      </g>
    </svg>
  );
}

/** A little fir with a star and twinkling lights. */
function ChristmasTree() {
  return (
    <svg viewBox="0 0 32 40" className="garden-holiday-tall" focusable="false">
      <rect x={14} y={33} width={4} height={6} fill="#7a5230" />
      <path d="M16 5l12 29H4z" fill="#2e7d3a" stroke="#1d5326" strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M16 3.5l1.2 2.6 2.8.3-2.1 1.9.6 2.8L16 9.7l-2.5 1.4.6-2.8-2.1-1.9 2.8-.3z" fill="#f2c94c" stroke="#a57a00" strokeWidth={0.6} />
      <path d="M9 22c4 2 10 2 14-1M7 29c5 2.5 13 2.5 18-1" fill="none" stroke="#f2c94c" strokeWidth={0.9} />
      <g className="holiday-glow">
        <circle cx={12} cy={17} r={1.4} fill="#ff4d4d" />
        <circle cx={19} cy={19} r={1.4} fill="#4fa3ff" />
        <circle cx={10} cy={26} r={1.4} fill="#ffd34d" />
        <circle cx={17} cy={26.5} r={1.4} fill="#ff4d4d" />
        <circle cx={23} cy={27} r={1.4} fill="#4fa3ff" />
      </g>
    </svg>
  );
}

function Present({ colour, ribbon }: { colour: string; ribbon: string }) {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <rect x={3} y={9} width={18} height={13} rx={1.5} fill={colour} />
      <rect x={10.5} y={9} width={3} height={13} fill={ribbon} />
      <rect x={3} y={13} width={18} height={2.5} fill={ribbon} />
      <path d="M12 9c-2-4-6-4-5-1s5 1 5 1 4 2 5-1-3-3-5 1z" fill="none" stroke={ribbon} strokeWidth={1.6} />
    </svg>
  );
}

/** A burst of sparks on a stick, as from a sparkler or a rocket. */
function Firework({ colour }: { colour: string }) {
  const rays = Array.from({ length: 10 }, (_, i) => (i * Math.PI) / 5);
  return (
    <svg viewBox="0 0 32 40" className="garden-holiday-tall" focusable="false">
      <path d="M16 22v17" stroke="#8a7a66" strokeWidth={1.4} />
      <g className="holiday-glow" stroke={colour} strokeWidth={1.6} strokeLinecap="round">
        {rays.map((a, i) => (
          <line key={i} x1={16 + 3 * Math.cos(a)} y1={12 + 3 * Math.sin(a)} x2={16 + 10 * Math.cos(a)} y2={12 + 10 * Math.sin(a)} />
        ))}
      </g>
      <circle cx={16} cy={12} r={1.8} fill="#fff6d8" />
    </svg>
  );
}

function Balloon({ colour }: { colour: string }) {
  return (
    <svg viewBox="0 0 20 40" className="garden-holiday-tall" focusable="false">
      <path d="M10 22c-2 5 2 9 0 17" fill="none" stroke="#8a7a66" strokeWidth={1} />
      <ellipse cx={10} cy={11} rx={7.5} ry={9.5} fill={colour} />
      <path d="M8.5 20.5h3l-1.5 2z" fill={colour} />
      <ellipse cx={7.5} cy={7.5} rx={1.6} ry={2.6} fill="#ffffff" opacity={0.55} />
    </svg>
  );
}

/** A birthday cake with three candles. */
function Cake() {
  return (
    <svg viewBox="0 0 32 32" focusable="false">
      <rect x={4} y={16} width={24} height={13} rx={2} fill="#f6d7b0" stroke="#b07a4a" strokeWidth={1} />
      <path d="M4 19c3 3 5-2 8 0s5 3 8 0 5-2 8 0" fill="none" stroke="#ff8fc7" strokeWidth={2.4} strokeLinecap="round" />
      {[10, 16, 22].map((x) => (
        <g key={x}>
          <rect x={x - 1} y={8} width={2} height={8} fill={x === 16 ? '#4fa3ff' : '#ff8fc7'} />
          <path className="holiday-glow" d={`M${x} 3c1.6 2 1.6 3.6 0 4.6-1.6-1-1.6-2.6 0-4.6z`} fill="#ffcf3d" />
        </g>
      ))}
    </svg>
  );
}
