import { useMemo } from 'react';
import { herbarium, SIZE_STAGES, SPECIES, TIERS, type Plant } from '@logbook/core';
import { allFlags, flagEmoji } from '../../lib/flags.ts';
import { formatLongDate } from '../common.tsx';

/** The mood each species grows from, to show beside it. */
const MOOD_OF = Object.fromEntries(Object.entries(SPECIES).map(([mood, species]) => [species, mood]));

/**
 * The Herbarium (D98, free): the flowers grown and what writing has collected. Species come from
 * moods, so there's no species count, no blanks for ones not grown and nothing to complete.
 */
export function Herbarium({ plants }: { plants: Plant[] }) {
  const h = useMemo(() => herbarium(plants), [plants]);
  // Only flags the app can draw; any other pair of letters would show as just the letters.
  const flags = useMemo(() => {
    const names = new Map(allFlags().map((f) => [f.code, f.name]));
    return h.flags.flatMap((code) => (names.has(code) ? [{ code, name: names.get(code)! }] : []));
  }, [h.flags]);
  const reached = h.sizes.filter(Boolean).length;

  if (!plants.length)
    return (
      <section className="panel" aria-labelledby="herbarium-h">
        <h2 id="herbarium-h">Herbarium</h2>
        <p>Write your first entry to grow your first flower. 🌱</p>
      </section>
    );
  return (
    <section className="panel garden-herbarium" aria-labelledby="herbarium-h">
      <h2 id="herbarium-h">Herbarium</h2>
      <p className="hint">The flowers you’ve grown. Each comes from the mood of its entry, so there’s nothing to collect here: it’s a record of how your days felt.</p>
      <div className="table-scroll">
        <table className="garden-table">
          <thead>
            <tr>
              <th scope="col">Flower</th>
              <th scope="col">Plants</th>
              <th scope="col">Rarest</th>
              <th scope="col">First bloom</th>
            </tr>
          </thead>
          <tbody>
            {h.species.map((s) => (
              <tr key={s.species}>
                <th scope="row">
                  <span aria-hidden="true">{MOOD_OF[s.species] ?? '🌼'} </span>
                  {s.species}
                </th>
                <td>{s.plants.toLocaleString()}</td>
                <td>
                  <span aria-hidden="true">{TIERS[s.tier]!.emoji} </span>
                  {TIERS[s.tier]!.name}
                </td>
                <td>{formatLongDate(s.first, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>From your writing</h3>
      <p>
        <strong>
          {reached} of {SIZE_STAGES.length} sizes
        </strong>{' '}
        grown, from a short note to a long day.
      </p>
      <ul className="garden-sizes">
        {SIZE_STAGES.map((s, i) => (
          <li key={s.name} data-reached={h.sizes[i]}>
            <span aria-hidden="true">{h.sizes[i] ? '✓ ' : '· '}</span>
            {s.name}
            <span className="sr-only">{h.sizes[i] ? ', grown' : ', not yet'}</span>
          </li>
        ))}
      </ul>
      <ul className="garden-collections">
        <li>
          📷 <strong>{h.photos.toLocaleString()}</strong> {h.photos === 1 ? 'plant' : 'plants'} with photos
        </li>
        <li>
          🎵 <strong>{h.music.toLocaleString()}</strong> with music or a recording
        </li>
        <li>
          🎬 <strong>{h.video.toLocaleString()}</strong> with a video
        </li>
        {flags.length > 0 && (
          <li>
            🗺️ <strong>{flags.length.toLocaleString()}</strong> {flags.length === 1 ? 'country' : 'countries'} flagged:{' '}
            <span className="garden-flags">
              {flags.map((f) => (
                <span key={f.code} role="img" aria-label={f.name} title={f.name}>
                  {flagEmoji(f.code)}
                </span>
              ))}
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}
