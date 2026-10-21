import { useEffect, useState } from 'react';
import type { StarMap } from '@logbook/core';
import { href } from '../../app/router.ts';
import { PETS, type PetKind } from '../../lib/garden-prefs.ts';
import { formatLongDate } from '../common.tsx';

/**
 * Garden update 3, "Companions" (D100): pets that nap beside the newest plant, and each year's
 * star map in the night sky above its months.
 */

/** The tiers that bring a pet (Crystal), the star map (Celestial) and a second pet (Eternal). */
export const PET_TIER = 8;
export const STAR_TIER = 9;
export const SECOND_PET_TIER = 12;

const STRETCH_MS = 1200;

/**
 * A pet, napping beside the newest plant: one button, so it has its name. A tap or Enter plays a
 * stretch; with reduced motion it stays still (its name still says what it's doing).
 */
export function Pet({ kind, name }: { kind: PetKind; name: string }) {
  const [stretching, setStretching] = useState(false);
  useEffect(() => {
    if (!stretching) return;
    const t = setTimeout(() => setStretching(false), STRETCH_MS);
    return () => clearTimeout(t);
  }, [stretching]);
  const pet = PETS.find((p) => p.value === kind);
  if (!pet) return null;
  const who = `Your ${pet.label.toLowerCase()}${name.trim() ? `, ${name.trim()}` : ''}`;
  const doing = stretching ? 'stretching' : 'napping';
  return (
    <button type="button" className="garden-pet" data-stretching={stretching || undefined} aria-label={`${who}, ${doing}`} title={`${who}, ${doing}`} onClick={() => setStretching(true)}>
      <span className="garden-pet-body" aria-hidden="true">
        {pet.emoji}
      </span>
      {!stretching && (
        <span className="garden-pet-zzz" aria-hidden="true">
          z
        </span>
      )}
    </button>
  );
}

/**
 * A year's constellation (D100): its twelve longest entries as stars across the year, joined in
 * date order, above its months. Each star is a link to its entry, named by its title and date.
 */
export function StarSky({ map }: { map: StarMap }) {
  if (!map.stars.length) return null;
  const id = `stars-${map.year}`;
  const points = map.stars.map((s) => `${(s.x * 100).toFixed(2)},${(s.y * 100).toFixed(2)}`).join(' ');
  return (
    <section className="garden-starmap" aria-labelledby={id}>
      <h2 id={id} className="garden-starmap-name">
        {map.tag ? `The ${map.tag} Cluster` : `The ${map.year} Cluster`}
        <span className="garden-starmap-year"> · {map.year}</span>
      </h2>
      <div className="garden-starmap-sky">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
        <ol>
          {map.stars.map((s) => {
            const label = `${s.plant.entry.title || 'Untitled'}, ${formatLongDate(s.plant.entry.date)}`;
            return (
              <li key={s.plant.entry.id}>
                <a className="garden-star" href={href({ name: 'entry', id: s.plant.entry.id })} style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }} aria-label={label} title={label}>
                  <span aria-hidden="true">✦</span>
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
