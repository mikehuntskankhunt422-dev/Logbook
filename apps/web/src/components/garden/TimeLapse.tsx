import { useEffect, useMemo, useRef, useState } from 'react';
import { timeLapseDuration, timeLapseFrame, timeLapseMonths, TIERS, type Plant as PlantData } from '@logbook/core';
import { useReducedMotion } from '../../lib/motion.ts';
import { Plant, TIER_COLOURS } from './Plant.tsx';

/** Beds drawn at once: the month playing and the two before it. */
const BEDS_SHOWN = 3;
const SPEEDS = [0.5, 1, 2];

const monthName = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * The Time-lapse (D98): the beds from the garden's first month to today, a second a month (20 to
 * 60 s in all), with the month's plants coming up in date order. Plants are shown at today's
 * size, as older versions of entries aren't kept. With reduced motion it doesn't play: the slider
 * steps through the months instead.
 */
export function TimeLapse({ plants }: { plants: PlantData[] }) {
  const reduced = useReducedMotion();
  const months = useMemo(() => timeLapseMonths(plants, thisMonth()), [plants]);
  const count = months.length;
  // How far it has played, in months (2.5 is halfway through the third month); null is today, the
  // end, which stays the end when a new month's entry adds a month.
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const pos = at ?? count;
  const posRef = useRef(pos);
  const move = (to: number | null) => {
    posRef.current = to ?? count;
    setAt(to);
  };

  useEffect(() => {
    if (!playing || reduced || !count) return;
    const perMonth = timeLapseDuration(count) / count;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      // Frames stop while the page is hidden: the first one back moves on no more than a usual
      // frame, so it picks up where it was.
      const step = (Math.min(now - last, 100) * speed) / perMonth;
      last = now;
      const next = posRef.current + step;
      if (next >= count) {
        posRef.current = count;
        setAt(null);
        setPlaying(false);
      } else {
        posRef.current = next;
        setAt(next);
        frame = requestAnimationFrame(tick);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, reduced, speed, count]);

  if (!count) return <p>Write your first entry to plant your first seed. 🌱</p>;

  const { index, shown } = timeLapseFrame(months, pos);
  const total = shown.reduce((a, b) => a + b, 0);
  const beds: { month: string; plants: PlantData[] }[] = [];
  for (let i = index; i >= 0 && beds.length < BEDS_SHOWN; i--)
    if (shown[i]) beds.push({ month: months[i]!.month, plants: months[i]!.plants.slice(0, shown[i]) });
  const here = shown[index]!;
  const label = `${monthName(months[index]!.month)}: ${here === 1 ? '1 plant' : `${here} plants`}`;
  const play = () => {
    if (pos >= count) move(0);
    setPlaying(true);
  };

  return (
    <div className="timelapse">
      <p className="hint">
        {reduced ? 'Move through the months with the slider to see your garden grow.' : 'Watch your garden grow from its first plant, a second a month.'} Plants are shown at the size they are today.
      </p>
      <div className="row timelapse-controls">
        {!reduced && (
          <button type="button" className="btn btn-primary" onClick={() => (playing ? setPlaying(false) : play())}>
            {playing ? '⏸ Pause' : '▶ Watch it grow'}
          </button>
        )}
        {!reduced && (
          <div className="segmented" role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
        )}
      </div>
      <label className="field timelapse-slider">
        <span>Month</span>
        <input
          type="range"
          min={0}
          max={count - 1}
          step={1}
          value={index}
          aria-valuetext={label}
          onChange={(e) => {
            setPlaying(false);
            const to = Number(e.target.value) + 1;
            move(to >= count ? null : to);
          }}
        />
      </label>
      {/* Read out when it's moved by hand, not every second while it plays. */}
      <p className="timelapse-label" aria-live={playing ? 'off' : 'polite'}>
        <strong>{label}</strong> <span className="muted">· {total === 1 ? '1 plant' : `${total.toLocaleString()} plants`} in the garden</span>
      </p>
      <div className="garden-scene timelapse-scene" aria-hidden="true">
        {beds.map((bed) => (
          <section key={bed.month} className="garden-bed">
            <p className="garden-sign">{monthName(bed.month)}</p>
            <ul className="garden-ground">
              {bed.plants.map((p) => (
                <li key={p.entry.id} className="garden-plant" title={`${TIERS[p.tier]!.name} ${p.species}`}>
                  <Plant plant={p} />
                  <span className="garden-tier-dot" style={{ background: TIER_COLOURS[p.tier] }} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
