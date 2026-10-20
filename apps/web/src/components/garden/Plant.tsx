import { memo, useId, type ReactNode } from 'react';
import { plantHeight, SIZE_STAGES, type Plant as PlantData } from '@logbook/core';

/**
 * One plant (D97), drawn as SVG from its entry: height from its words, blooms from its size stage,
 * shape and colours from its species (mood), and the look of its rarity tier, which adds a feature
 * at every step (gradient petals, dew, a second ring, a gold rim and glow, flame tips, rays, a
 * rainbow rim, crystals, stars, an aurora, a nebula, gold, amber, a crown). Its layout is seeded by
 * the entry's id, so every plant is its own and the same everywhere.
 */

type Shape = 'round' | 'pointed' | 'cup' | 'bell' | 'spike';
interface Look {
  light: string;
  deep: string;
  centre: string;
  petals: number;
  shape: Shape;
}

export const LOOKS: Record<string, Look> = {
  Sunflower: { light: '#ffd23f', deep: '#c98a00', centre: '#6b3e12', petals: 14, shape: 'pointed' },
  Daisy: { light: '#ffffff', deep: '#8a8070', centre: '#f5b700', petals: 12, shape: 'round' },
  Tulip: { light: '#ff7aa8', deep: '#c2185b', centre: '#ffd54f', petals: 3, shape: 'cup' },
  Bluebell: { light: '#9dbcff', deep: '#3f5fc0', centre: '#2a3f8f', petals: 5, shape: 'bell' },
  Snowdrop: { light: '#f4f7ff', deep: '#3f5fc0', centre: '#9ccc7a', petals: 3, shape: 'bell' },
  Poppy: { light: '#ff6a5e', deep: '#c2261b', centre: '#2b1a1a', petals: 4, shape: 'round' },
  Lavender: { light: '#c3adff', deep: '#6b4fbb', centre: '#6b4fbb', petals: 0, shape: 'spike' },
  'Star lily': { light: '#ffb3d9', deep: '#d6338a', centre: '#ffe066', petals: 6, shape: 'pointed' },
  Rose: { light: '#ff7a9a', deep: '#b8234f', centre: '#8a1538', petals: 8, shape: 'round' },
  Iris: { light: '#a98bff', deep: '#5b3fb8', centre: '#ffd54f', petals: 6, shape: 'pointed' },
  Wildflower: { light: '#f7a1c4', deep: '#c2457a', centre: '#ffcd3c', petals: 8, shape: 'round' },
};

/** Every plant on a postcard that hides moods (D98): one flower in neutral colours. */
const NEUTRAL: Look = { light: '#efe6d8', deep: '#8a7f70', centre: '#c9bca8', petals: 8, shape: 'round' };

/** Each tier's colour (badges, ribbons, rims). */
export const TIER_COLOURS = ['#6f655a', '#2e7d3e', '#2b62bd', '#7a3fc2', '#8f5c00', '#c23f17', '#7f6200', '#8a2f9e', '#1d6a85', '#55647f', '#127f69', '#3b2a8f', '#8a6d00', '#6b4a1f', '#1f6b3a'];

const GOLD = '#e8b43a';
const RIM: Record<number, string> = { 4: GOLD, 5: '#ff8a3d', 6: '#fff0a8', 8: '#bfefff', 9: '#dfe6ff', 10: '#5ef2c4', 11: '#a99cff' };

function seeded(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Memoised: the garden page re-renders on every perk choice, its plants don't need to. */
export const Plant = memo(function Plant({ plant, neutral = false }: { plant: PlantData; neutral?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const look = neutral ? NEUTRAL : (LOOKS[plant.species] ?? LOOKS['Wildflower']!);
  const t = plant.tier;
  const tree = plant.stage === SIZE_STAGES.length - 1;
  const h = plantHeight(plant.words) * (tree ? 1.3 : 1);
  const W = Math.round(h * (tree ? 0.8 : 0.6));
  const H = Math.round(h);
  const rand = seeded(plant.entry.id);
  const r = 6 + 0.06 * h;
  const cx = W / 2;
  const topY = r + 4;
  const stemColour = t >= 12 ? GOLD : t >= 8 ? '#7fc8e8' : '#3f8a3a';
  const rim = t === 7 ? `url(#${uid}rb)` : t >= 12 ? GOLD : (RIM[t] ?? look.deep);
  const petalFill = t >= 1 ? `url(#${uid}pg)` : look.light;

  const bloom = (x: number, y: number, rr: number, key: string, top = false): ReactNode => {
    const parts: ReactNode[] = [];
    if (look.shape === 'spike') {
      for (let i = 0; i < 6; i++) parts.push(<ellipse key={i} cx={x + (i % 2 ? rr * 0.25 : -rr * 0.25)} cy={y + i * rr * 0.32 - rr} rx={rr * 0.28} ry={rr * 0.2} fill={petalFill} stroke={rim} strokeWidth={t >= 4 ? 1.5 : 1} />);
      return <g key={key}>{parts}</g>;
    }
    if (look.shape === 'cup' || look.shape === 'bell') {
      const bell = look.shape === 'bell';
      const d = bell
        ? `M${x - rr * 0.7},${y - rr * 0.4} Q${x},${y - rr * 1.1} ${x + rr * 0.7},${y - rr * 0.4} L${x + rr * 0.9},${y + rr * 0.5} Q${x},${y + rr * 0.2} ${x - rr * 0.9},${y + rr * 0.5} Z`
        : `M${x - rr * 0.8},${y - rr * 0.6} L${x - rr * 0.4},${y - rr * 0.2} L${x},${y - rr * 0.8} L${x + rr * 0.4},${y - rr * 0.2} L${x + rr * 0.8},${y - rr * 0.6} Q${x + rr * 0.85},${y + rr * 0.7} ${x},${y + rr * 0.75} Q${x - rr * 0.85},${y + rr * 0.7} ${x - rr * 0.8},${y - rr * 0.6} Z`;
      parts.push(<path key="p" d={d} fill={petalFill} stroke={rim} strokeWidth={t >= 4 ? 2 : 1} />);
    } else {
      const n = look.petals;
      for (let i = 0; i < n; i++) {
        const a = (360 / n) * i;
        parts.push(
          look.shape === 'pointed' ? (
            <path key={i} d={`M${x},${y} Q${x - rr * 0.3},${y - rr * 0.55} ${x},${y - rr} Q${x + rr * 0.3},${y - rr * 0.55} ${x},${y}`} transform={`rotate(${a} ${x} ${y})`} fill={petalFill} stroke={rim} strokeWidth={t >= 4 ? 1.5 : 1} />
          ) : (
            <ellipse key={i} cx={x} cy={y - rr * 0.55} rx={rr * 0.36} ry={rr * 0.55} transform={`rotate(${a} ${x} ${y})`} fill={petalFill} stroke={rim} strokeWidth={t >= 4 ? 1.5 : 1} />
          ),
        );
      }
      if (t >= 3)
        for (let i = 0; i < Math.max(4, Math.round(n / 2)); i++)
          parts.push(<ellipse key={`in${i}`} cx={x} cy={y - rr * 0.32} rx={rr * 0.2} ry={rr * 0.32} transform={`rotate(${(360 / Math.max(4, Math.round(n / 2))) * i + 15} ${x} ${y})`} fill={look.deep} opacity={0.85} />);
      parts.push(<circle key="c" cx={x} cy={y} r={rr * 0.28} fill={t === 5 ? '#ff8a3d' : t >= 4 ? GOLD : look.centre} />);
    }
    if (top && t >= 2) parts.push(<ellipse key="dew1" cx={x + rr * 0.35} cy={y - rr * 0.45} rx={1.6} ry={2.2} fill="#ffffff" opacity={0.75} />, <ellipse key="dew2" cx={x - rr * 0.5} cy={y + rr * 0.1} rx={1.3} ry={1.8} fill="#ffffff" opacity={0.7} />);
    return <g key={key}>{parts}</g>;
  };

  // Blooms: one on top, the rest on side stems placed by the plant's seed.
  const stage = SIZE_STAGES[plant.stage]!;
  const blooms: ReactNode[] = [];
  const stems: ReactNode[] = [];
  const leaves: ReactNode[] = [];
  if (tree) {
    const canopyY = H * 0.38;
    stems.push(<path key="trunk" d={`M${cx - 6},${H} L${cx - 3},${canopyY} L${cx + 3},${canopyY} L${cx + 6},${H} Z`} fill={t >= 12 ? GOLD : '#7a5230'} />);
    for (let i = 0; i < 5; i++) leaves.push(<circle key={`cn${i}`} cx={cx + (i - 2) * W * 0.16} cy={canopyY - (i % 2 ? W * 0.1 : 0)} r={W * 0.24} fill={i % 2 ? '#4f9d4a' : '#3f8a3a'} />);
    for (let i = 0; i < stage.blooms; i++) blooms.push(bloom(cx + (rand() - 0.5) * W * 0.75, canopyY + (rand() - 0.6) * W * 0.35, r * 0.6, `b${i}`, i === 0));
  } else {
    stems.push(<path key="stem" d={`M${cx},${H} Q${cx + (rand() - 0.5) * 10},${H * 0.55} ${cx},${topY}`} stroke={stemColour} strokeWidth={2.5} fill="none" />);
    for (let i = 1; i < stage.blooms; i++) {
      const side = i % 2 ? -1 : 1;
      const sy = H - (0.3 + rand() * 0.45) * (H - topY);
      const bx = cx + side * (0.18 + rand() * 0.22) * W;
      const by = sy - (0.1 + rand() * 0.15) * H;
      stems.push(<path key={`s${i}`} d={`M${cx},${sy} Q${(cx + bx) / 2},${sy} ${bx},${by}`} stroke={stemColour} strokeWidth={1.8} fill="none" />);
      blooms.push(bloom(bx, by, r * 0.75, `b${i}`));
    }
    blooms.push(bloom(cx, topY, r, 'top', true));
    for (const [i, side] of [-1, 1].entries()) {
      const ly = H - (0.2 + i * 0.18) * H;
      leaves.push(
        <g key={`l${i}`} transform={`rotate(${side * (t >= 3 ? 50 : 35)} ${cx} ${ly})`}>
          <ellipse cx={cx + side * 7} cy={ly} rx={8} ry={3.5} fill="#5aa64f" />
          {t >= 1 && <line x1={cx + side * 1} y1={ly} x2={cx + side * 13} y2={ly} stroke="#2f6e2a" strokeWidth={0.7} />}
        </g>,
      );
    }
  }

  // Ribbons for long entries, crowns past the top tier.
  const ribbons = Array.from({ length: plant.bonus }, (_, i) => (
    <path key={`rb${i}`} d={`M${cx},${H * 0.72 - i * 8} l-6,-3 l0,6 Z M${cx},${H * 0.72 - i * 8} l6,-3 l0,6 Z`} fill={TIER_COLOURS[t]} />
  ));

  const behind: ReactNode[] = [];
  if (t >= 10) behind.push(<rect key="aurora" className="g-drift" x={-W * 0.2} y={-H * 0.1} width={W * 1.4} height={H * 0.9} fill={`url(#${uid}au)`} opacity={0.45} rx={W * 0.3} />);
  if (t >= 11) behind.push(<circle key="nebula" cx={cx} cy={topY} r={r * 4} fill={`url(#${uid}nb)`} />);
  if (t >= 4) behind.push(<circle key="glow" cx={cx} cy={topY} r={r * (t >= 6 ? 2.2 : 1.7)} fill={`url(#${uid}gl)`} />);
  if (t >= 6)
    behind.push(
      <g key="rays" className="g-spin" style={{ transformOrigin: `${cx}px ${topY}px` }}>
        {Array.from({ length: 8 }, (_, i) => (
          <line key={i} x1={cx} y1={topY - r * 1.3} x2={cx} y2={topY - r * 2.3} stroke="#ffe08a" strokeWidth={1.5} strokeLinecap="round" transform={`rotate(${i * 45} ${cx} ${topY})`} />
        ))}
      </g>,
    );
  const front: ReactNode[] = [];
  if (t === 5)
    for (let i = 0; i < 3; i++) front.push(<circle key={`em${i}`} className="g-ember" style={{ animationDelay: `${i * 0.8}s` }} cx={cx + (i - 1) * r * 0.6} cy={topY - r * 0.8} r={1.4} fill="#ffb03d" />);
  if (t >= 7) front.push(<path key="arc" d={`M${cx - r * 1.2},${topY - r * 1.4} Q${cx},${topY - r * 2.4} ${cx + r * 1.2},${topY - r * 1.4}`} stroke={`url(#${uid}rb)`} strokeWidth={2} fill="none" />);
  if (t >= 8)
    for (let i = 0; i < 3; i++)
      front.push(<polygon key={`cr${i}`} points={hexagon(cx + (i - 1) * 7, H - 4 - (i % 2) * 3, 3.5 + (i % 2))} fill="#bfefff" stroke="#5fb4d6" strokeWidth={0.8} />);
  if (t >= 9) {
    front.push(<ellipse key="halo" cx={cx} cy={topY - r * 1.2} rx={r * 0.9} ry={r * 0.25} fill="none" stroke="#dfe6ff" strokeWidth={1.2} />);
    for (let i = 0; i < 8; i++) front.push(<circle key={`st${i}`} className="g-twinkle" style={{ animationDelay: `${i * 0.4}s` }} cx={rand() * W} cy={rand() * H * 0.5} r={0.9} fill="#ffffff" />);
  }
  if (t >= 11) front.push(<g key="planet"><circle cx={cx + r * 1.6} cy={topY - r * 1.5} r={2.6} fill="#a99cff" /><ellipse cx={cx + r * 1.6} cy={topY - r * 1.5} rx={4.6} ry={1.4} fill="none" stroke="#ffd27a" strokeWidth={0.8} /></g>);
  if (t >= 13)
    for (let i = 0; i < 3; i++) front.push(<ellipse key={`am${i}`} cx={cx + (i - 1) * 9} cy={H - 2} rx={3.4} ry={2.2} fill="#e09a2d" stroke="#8a5310" strokeWidth={0.6} />);
  const crownCount = (t >= 14 ? 1 : 0) + plant.crowns;
  if (crownCount) front.push(<text key="crown" x={cx} y={topY - r * (t >= 7 ? 2.5 : 1.4)} textAnchor="middle" fontSize={10}>{'👑'.repeat(crownCount)}</text>);

  return (
    <svg className="plant-svg g-sway" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" style={{ animationDelay: `${Math.round(rand() * 3000)}ms` }}>
      <defs>
        {t >= 1 && (
          <radialGradient id={`${uid}pg`}>
            <stop offset="0%" stopColor={look.light} />
            <stop offset="100%" stopColor={look.deep} />
          </radialGradient>
        )}
        {t >= 4 && (
        <radialGradient id={`${uid}gl`}>
          <stop offset="0%" stopColor={t >= 6 ? '#fff4c2' : '#ffd66b'} stopOpacity={0.8} />
          <stop offset="100%" stopColor={t >= 6 ? '#fff4c2' : '#ffd66b'} stopOpacity={0} />
        </radialGradient>
        )}
        {t >= 7 && (
        <linearGradient id={`${uid}rb`} x1="0" x2="1">
          {['#ff5f6d', '#ffc371', '#fff36b', '#5be37b', '#4fb8ff', '#a66bff'].map((c, i) => (
            <stop key={c} offset={`${i * 20}%`} stopColor={c} />
          ))}
        </linearGradient>
        )}
        {t >= 10 && (
        <linearGradient id={`${uid}au`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5ef2c4" />
          <stop offset="50%" stopColor="#4fd17f" />
          <stop offset="100%" stopColor="#a66bff" />
        </linearGradient>
        )}
        {t >= 11 && (
        <radialGradient id={`${uid}nb`}>
          <stop offset="0%" stopColor={look.light} stopOpacity={0.6} />
          <stop offset="55%" stopColor="#7b4fd6" stopOpacity={0.35} />
          <stop offset="100%" stopColor="#2f5fd6" stopOpacity={0} />
        </radialGradient>
        )}
      </defs>
      {behind}
      {stems}
      {leaves}
      {ribbons}
      {blooms}
      {front}
    </svg>
  );
});

function hexagon(x: number, y: number, s: number): string {
  return Array.from({ length: 6 }, (_, i) => `${x + s * Math.cos((Math.PI / 3) * i)},${y + s * Math.sin((Math.PI / 3) * i)}`).join(' ');
}
