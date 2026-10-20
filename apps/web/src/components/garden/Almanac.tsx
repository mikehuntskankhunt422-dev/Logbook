import { useMemo, useState } from 'react';
import { almanac, SIZE_STAGES, TIERS, type AlmanacMonth, type Plant } from '@logbook/core';
import { href } from '../../app/router.ts';
import { formatLongDate } from '../common.tsx';
import { TimeLapse } from './TimeLapse.tsx';

/** The tier that opens Garden history (D98): the Almanac and the Time-lapse. */
export const HISTORY_TIER = 5;

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const monthName = (month: string, style: 'long' | 'short' = 'long') => new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: style });

/** Garden history (D98): a year of the garden month by month, and its time-lapse. */
export function Almanac({ plants, unlocked }: { plants: Plant[]; unlocked: boolean }) {
  const [year, setYear] = useState<string>();
  const a = useMemo(() => almanac(plants, year), [plants, year]);

  if (!unlocked)
    return (
      <section className="panel" aria-labelledby="almanac-h">
        <h2 id="almanac-h">Garden history</h2>
        <p>
          🔒 Reach {TIERS[HISTORY_TIER]!.name} ({TIERS[HISTORY_TIER]!.at.toLocaleString()} Growth) for Garden history: the Almanac, your garden month by month, and the Time-lapse, to watch it grow from its first plant.
        </p>
      </section>
    );
  if (!a.years.length)
    return (
      <section className="panel" aria-labelledby="almanac-h">
        <h2 id="almanac-h">Almanac</h2>
        <p>Write your first entry to start your garden’s history. 🌱</p>
      </section>
    );
  return (
    <>
      <section className="panel garden-almanac" aria-labelledby="almanac-h">
        <div className="page-head">
          <h2 id="almanac-h">Almanac</h2>
          {a.years.length > 1 && (
            <label className="row">
              Year
              <select className="text-input" value={a.year} onChange={(e) => setYear(e.target.value)}>
                {a.years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="hint">The entries dated {a.year}, month by month.</p>
        <dl className="almanac-stats">
          <Stat label="Growth" value={a.growth.toLocaleString()} />
          <Stat label="Plants" value={a.plants.toLocaleString()} />
          <Stat label="Plant words" value={a.words.toLocaleString()} />
          <Stat label="Days with an entry" value={a.days.toLocaleString()} />
          {a.busiest >= 0 && <Stat label="Busiest weekday" value={WEEKDAYS[a.busiest]!} />}
        </dl>
        <ul className="almanac-highlights">
          {a.longest && (
            <li>
              <span className="muted">Longest entry:</span> <PlantLink plant={a.longest} /> · {a.longest.words.toLocaleString()} plant words, a {SIZE_STAGES[a.longest.stage]!.name}
            </li>
          )}
          {a.rarest && (
            <li>
              <span className="muted">Rarest plant:</span> <PlantLink plant={a.rarest} /> · {TIERS[a.rarest.tier]!.name} {a.rarest.species}
            </li>
          )}
        </ul>

        <h3 id="almanac-chart-h">Growth by month</h3>
        <GrowthChart months={a.months} />
        <details className="almanac-table">
          <summary>Show as a table</summary>
          <div className="table-scroll">
            <table className="garden-table">
              <caption className="sr-only">Growth by month, {a.year}</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Growth</th>
                  <th scope="col">Plants</th>
                  <th scope="col">Plant words</th>
                </tr>
              </thead>
              <tbody>
                {a.months.map((m) => (
                  <tr key={m.month}>
                    <th scope="row">{monthName(m.month)}</th>
                    <td>{m.growth.toLocaleString()}</td>
                    <td>{m.plants.toLocaleString()}</td>
                    <td>{m.words.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="panel" aria-labelledby="timelapse-h">
        <h2 id="timelapse-h">Time-lapse</h2>
        <TimeLapse plants={plants} />
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PlantLink({ plant }: { plant: Plant }) {
  return (
    <a href={href({ name: 'entry', id: plant.entry.id })}>
      {plant.entry.title || 'Untitled'}, {formatLongDate(plant.entry.date, { day: 'numeric', month: 'short' })}
    </a>
  );
}

/**
 * One bar per month, in the accent colour: one series, so no legend; the busiest month is
 * labelled, and hovering a month shows its numbers. The table above the chart holds them all.
 */
function GrowthChart({ months }: { months: AlmanacMonth[] }) {
  const max = Math.max(...months.map((m) => m.growth));
  const top = max > 0 ? months.findIndex((m) => m.growth === max) : -1;
  const summary = top >= 0 ? `Growth by month. The most was in ${monthName(months[top]!.month)}, with ${max.toLocaleString()}.` : 'Growth by month: none yet this year.';
  return (
    <div className="almanac-chart" role="img" aria-label={summary}>
      {months.map((m, i) => (
        <div key={m.month} className="almanac-col" aria-hidden="true">
          <div className="almanac-plot">
            {i === top && <span className="almanac-value">{m.growth.toLocaleString()}</span>}
            {m.growth > 0 && <span className="almanac-bar" style={{ height: `${Math.max(2, (m.growth / max) * 100)}%` }} />}
          </div>
          <span className="almanac-month">{monthName(m.month, 'short')}</span>
          <span className="almanac-tip">
            <strong>{monthName(m.month)}</strong>
            <br />
            {m.growth.toLocaleString()} Growth · {m.plants === 1 ? '1 plant' : `${m.plants.toLocaleString()} plants`}
          </span>
        </div>
      ))}
    </div>
  );
}
