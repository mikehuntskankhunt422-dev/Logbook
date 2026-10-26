import { useMemo } from 'react';
import { gardenLandmarks, latestLandmarks, worldTree, type Garden, type Landmark, type LandmarkKind } from '@logbook/core';
import { href } from '../../app/router.ts';
import { formatLongDate } from '../common.tsx';
import { TIER_COLOURS } from './Plant.tsx';

/**
 * Garden update 4, "Wonders" (D103): landmarks above the beds (free; gold from Eternal), the World
 * Tree above the newest bed (Worldbloom), and biomes (Cosmic, drawn in app.css).
 */

/** The tiers that bring biomes (Cosmic), golden landmarks (Eternal) and the World Tree (Worldbloom). */
export const BIOME_TIER = 11;
export const GOLD_LANDMARK_TIER = 12;
export const TREE_TIER = 14;

/** What a landmark marks: a short caption, and the whole of it for its name. */
function describe(m: Landmark): { caption: string; name: string } {
  switch (m.kind) {
    case 'stone':
      return { caption: 'First entry', name: 'A stone for your first entry' };
    case 'lamp':
      return { caption: `${m.n.toLocaleString()}th entry`, name: `A lamp post for your ${m.n.toLocaleString()}th entry, one for every hundred` };
    case 'arch':
      return { caption: m.n === 1 ? '1 year' : `${m.n} years`, name: `An arch for ${m.n === 1 ? 'a year' : `${m.n} years`} since your first entry` };
    case 'steps':
      return { caption: `${m.n}-day streak`, name: `Path stones for a ${m.n}-day streak` };
    case 'statue':
      return { caption: 'Longest entry', name: `A statue for your longest entry, ${m.n.toLocaleString()} plant words` };
  }
}

/** The latest landmark of each kind, in the order they were reached; one with an entry in the journal opens it. */
export function Landmarks({ garden, today, gold }: { garden: Garden; today: string; gold: boolean }) {
  const marks = useMemo(() => latestLandmarks(gardenLandmarks(garden.written, garden.plants, today)), [garden, today]);
  if (!marks.length) return null;
  return (
    <ul className="garden-landmarks" aria-label="Landmarks" data-gold={gold || undefined}>
      {marks.map((m) => {
        const { caption, name } = describe(m);
        const about = m.entry ? `${name}: ${m.entry.title || 'Untitled'}, ${formatLongDate(m.date)}` : `${name}, ${formatLongDate(m.date)}`;
        const body = (
          <>
            <LandmarkIcon kind={m.kind} gold={gold} />
            <span className="garden-landmark-caption" aria-hidden="true">
              {caption}
            </span>
            {/* Engraved: the date's digits, as on an Eternal plant's plinth. */}
            {gold && (
              <span className="garden-landmark-date" aria-hidden="true">
                {m.date}
              </span>
            )}
          </>
        );
        return (
          <li key={`${m.kind}-${m.n}-${m.date}`}>
            {m.entry ? (
              <a className="garden-landmark" href={href({ name: 'entry', id: m.entry.id })} aria-label={about} title={about}>
                {body}
              </a>
            ) : (
              <span className="garden-landmark">
                {body}
                <span className="sr-only">{about}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A landmark's picture: plain stone, or gold. */
function LandmarkIcon({ kind, gold }: { kind: LandmarkKind; gold: boolean }) {
  const fill = gold ? '#e8b43a' : '#a8a093';
  const line = gold ? '#7a5600' : '#5f5a52';
  const common = { fill, stroke: line, strokeWidth: 1.5, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {kind === 'stone' && <path d="M5 27c0-7 4.5-12 11-12s11 5 11 12z" {...common} />}
      {kind === 'lamp' && (
        <>
          <rect x={14.5} y={11} width={3} height={15} {...common} />
          <path d="M11 11h10l-1.5-6h-7z" {...common} />
          <rect x={13} y={6.5} width={6} height={3.5} rx={1} fill="#ffd27a" />
          <rect x={11} y={26} width={10} height={3} rx={1} {...common} />
        </>
      )}
      {kind === 'arch' && <path d="M5 28V15a11 11 0 0 1 22 0v13h-5V15a6 6 0 0 0-12 0v13z" {...common} />}
      {kind === 'statue' && (
        <>
          <circle cx={16} cy={6.5} r={3} {...common} />
          <path d="M12 21l1.5-10h5L20 21z" {...common} />
          <rect x={8} y={21} width={16} height={7} rx={1} {...common} />
        </>
      )}
      {kind === 'steps' && (
        <>
          <ellipse cx={8} cy={26} rx={4.5} ry={2.5} {...common} />
          <ellipse cx={16} cy={19.5} rx={4.5} ry={2.5} {...common} />
          <ellipse cx={24} cy={13} rx={4.5} ry={2.5} {...common} />
        </>
      )}
    </svg>
  );
}

/** The trunk holds this many rings; more are counted in its name. */
const RINGS_DRAWN = 10;

/**
 * The World Tree (Worldbloom): a blossom for every month written in, in its rarest plant's tier
 * colour, and a ring round the trunk for every ★. Petals are one path per tier colour (at most 15) and the centres one more, however
 * many months there are.
 */
export function WorldTree({ garden }: { garden: Garden }) {
  const tree = useMemo(() => worldTree(garden.plants, garden.rank), [garden]);
  const { petals, centres } = useMemo(() => {
    const byTier = new Map<number, string>();
    let centres = '';
    const circle = (cx: number, cy: number, r: number) => `M${(cx - r).toFixed(1)},${cy.toFixed(1)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
    for (const b of tree.blossoms) {
      const cx = 16 + b.x * 208;
      const cy = 8 + b.y * 132;
      // Five petals round a gold centre.
      let d = byTier.get(b.tier) ?? '';
      for (let k = 0; k < 5; k++) {
        const a = (k * 2 * Math.PI) / 5 - Math.PI / 2;
        d += circle(cx + 3.6 * Math.cos(a), cy + 3.6 * Math.sin(a), 3.2);
      }
      byTier.set(b.tier, d);
      centres += circle(cx, cy, 2);
    }
    return { petals: [...byTier].sort((a, b) => a[0] - b[0]), centres };
  }, [tree]);
  const n = tree.blossoms.length;
  const name = `The World Tree: ${n === 1 ? '1 blossom, for the month' : `${n} blossoms, one for each month`} you’ve written in${tree.rings ? `, and ${tree.rings} rings round its trunk for ★${garden.rank.ring}` : ''}`;
  return (
    <div className="garden-tree" role="img" aria-label={name} title={name}>
      <svg viewBox="0 0 240 206" aria-hidden="true" focusable="false">
        <ellipse cx={120} cy={198} rx={64} ry={7} fill="var(--ground)" />
        <path d="M108 200c4-22 6-44 4-64l-14-14 6-4 14 10 6-20 8 2-4 26 16-12 4 6-18 16c-2 20 0 36 6 54z" fill="#7a5230" stroke="#4e3219" strokeWidth={2} strokeLinejoin="round" />
        {Array.from({ length: Math.min(tree.rings, RINGS_DRAWN) }, (_, i) => (
          <ellipse key={i} cx={119} cy={192 - i * 5} rx={12} ry={2.4} fill="none" stroke="#ffd36b" strokeWidth={1.6} />
        ))}
        <ellipse cx={120} cy={74} rx={112} ry={70} fill="#4f9a47" stroke="#2e6b2a" strokeWidth={2} />
        <ellipse cx={104} cy={58} rx={70} ry={38} fill="#63ad57" />
        {petals.map(([tier, d]) => (
          <path key={tier} d={d} fill={TIER_COLOURS[tier]} stroke="#fff8ec" strokeWidth={1.3} />
        ))}
        <path d={centres} fill="#ffe08a" />
      </svg>
    </div>
  );
}
