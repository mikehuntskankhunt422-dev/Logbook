import { useMemo, useState } from 'react';
import { addDays, entryWordCount, heatLevel, monthGrid, onThisDayDates, parseIsoDate, tagCounts, toIsoDate, today, yearsAgo, type Entry } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { href, navigate } from '../app/router.ts';
import { EntryCard, formatLongDate, useStreak } from './common.tsx';

// ── timeline ─────────────────────────────────────────────────────────────────────────────────────

export function Timeline() {
  const { entries, loaded } = useJournal();
  const streak = useStreak();
  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) {
      const key = e.date.slice(0, 7);
      m.set(key, [...(m.get(key) ?? []), e]);
    }
    return [...m];
  }, [entries]);

  if (!loaded) return <p className="muted">Opening your journal…</p>;
  if (!entries.length) {
    return (
      <div className="empty">
        <div className="big" aria-hidden="true">
          📓
        </div>
        <h1>Your logbook is empty</h1>
        <p>Write your first entry. Add photos, videos, voice notes and links. Everything stays on this device.</p>
        <a className="btn btn-primary" href={href({ name: 'new' })}>
          Write today's entry
        </a>
      </div>
    );
  }
  return (
    <>
      <h1>{streak.wroteToday ? 'Nice work today ✨' : 'How was today?'}</h1>
      <p className="muted">
        {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · current streak {streak.current} {streak.current === 1 ? 'day' : 'days'} · longest {streak.longest}
      </p>
      <div className="timeline">
        {groups.map(([month, list]) => (
          <MonthGroup key={month} month={month} entries={list} />
        ))}
      </div>
    </>
  );
}

function MonthGroup({ month, entries }: { month: string; entries: Entry[] }) {
  return (
    <>
      <h2 className="month-heading">{parseIsoDate(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
      {entries.map((e) => (
        <EntryCard key={e.id} entry={e} />
      ))}
    </>
  );
}

// ── calendar ─────────────────────────────────────────────────────────────────────────────────────

function useDayStats() {
  const { entries } = useJournal();
  return useMemo(() => {
    const m = new Map<string, { words: number; entries: Entry[] }>();
    for (const e of entries) {
      const d = m.get(e.date) ?? { words: 0, entries: [] };
      d.words += entryWordCount(e) + (e.blocks.some((b) => b.type !== 'text') ? 10 : 0);
      d.entries.push(e);
      m.set(e.date, d);
    }
    return m;
  }, [entries]);
}

export function CalendarView({ month }: { month?: string }) {
  const stats = useDayStats();
  const todayIso = today();
  const [year, m0] = (month && /^\d{4}-\d{2}$/.test(month) ? month : todayIso.slice(0, 7)).split('-').map(Number) as [number, number];
  const [selected, setSelected] = useState<string | null>(null);
  const weeks = monthGrid(year, m0 - 1);
  const monthKey = (y: number, mm: number) => {
    const d = new Date(y, mm - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const title = new Date(year, m0 - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdayNames = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));
  const selectedEntries = selected ? (stats.get(selected)?.entries ?? []) : [];

  return (
    <>
      <h1>Calendar</h1>
      <YearHeatmap stats={stats} />

      <div className="month-nav">
        <a className="icon-btn" href={href({ name: 'calendar', month: monthKey(year, m0 - 1) })} aria-label="Previous month">
          ←
        </a>
        <h2 aria-live="polite">{title}</h2>
        <a className="icon-btn" href={href({ name: 'calendar', month: monthKey(year, m0 + 1) })} aria-label="Next month">
          →
        </a>
      </div>
      <table className="month-grid">
        <thead>
          <tr>
            {weekdayNames.map((d) => (
              <th key={d} scope="col">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={i}>
              {w.map((d, j) => {
                if (!d) return <td key={j} />;
                const s = stats.get(d);
                const count = s?.entries.length ?? 0;
                const mood = s?.entries.find((e) => e.mood)?.mood;
                return (
                  <td key={d}>
                    <button
                      type="button"
                      className="day-btn"
                      data-level={heatLevel(s?.words ?? 0)}
                      data-today={d === todayIso}
                      aria-pressed={selected === d}
                      aria-label={`${formatLongDate(d)}: ${count ? `${count} ${count === 1 ? 'entry' : 'entries'}, about ${s!.words} words` : 'no entries'}`}
                      onClick={() => setSelected(d === selected ? null : d)}
                    >
                      <span>{Number(d.slice(8))}</span>
                      {mood && (
                        <span className="day-mood" aria-hidden="true">
                          {mood}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {selected && (
        <section aria-label={`Entries on ${formatLongDate(selected)}`} style={{ marginTop: 18 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>{formatLongDate(selected)}</h2>
            <a className="btn btn-small btn-primary" href={href({ name: 'new', date: selected })}>
              + Write for this day
            </a>
          </div>
          {selectedEntries.length ? (
            <div className="timeline">
              {selectedEntries.map((e) => (
                <EntryCard key={e.id} entry={e} />
              ))}
            </div>
          ) : (
            <p className="muted">Nothing written on this day yet.</p>
          )}
        </section>
      )}
    </>
  );
}

function YearHeatmap({ stats }: { stats: Map<string, { words: number; entries: Entry[] }> }) {
  const end = today();
  // 53 Monday-first weeks ending this week.
  const endDate = parseIsoDate(end);
  const daysSinceMonday = (endDate.getDay() + 6) % 7;
  const start = addDays(end, -(52 * 7 + daysSinceMonday));
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const written = days.filter((d) => stats.has(d)).length;
  return (
    <section aria-label="Writing over the last year">
      <p className="muted">
        You wrote on {written} {written === 1 ? 'day' : 'days'} in the last year.
      </p>
      <div className="year-heat">
        <div className="year-heat-grid">
          {days.map((d) => {
            const s = stats.get(d);
            return (
              <button
                key={d}
                type="button"
                className="heat-cell"
                data-level={heatLevel(s?.words ?? 0)}
                title={`${formatLongDate(d, { day: 'numeric', month: 'short', year: 'numeric' })}: ${s ? `${s.entries.length} entries` : 'nothing'}`}
                aria-label={`${formatLongDate(d)}: ${s ? `${s.entries.length} entries` : 'no entries'}`}
                tabIndex={s ? 0 : -1}
                onClick={() => navigate({ name: 'calendar', month: d.slice(0, 7) })}
              />
            );
          })}
        </div>
      </div>
      <div className="heat-legend" aria-hidden="true">
        Less <span className="heat-cell" data-level="0" /> <span className="heat-cell" data-level="1" /> <span className="heat-cell" data-level="2" /> <span className="heat-cell" data-level="3" />{' '}
        <span className="heat-cell" data-level="4" /> More
      </div>
    </section>
  );
}

// ── on this day ──────────────────────────────────────────────────────────────────────────────────

export function Memories() {
  const { entries } = useJournal();
  const t = today();
  const dates = onThisDayDates(
    t,
    entries.map((e) => e.date),
  );
  const nearby = useMemo(() => {
    if (dates.length) return [];
    // Nothing on this exact day: show the same week in earlier years instead.
    const out: Entry[] = [];
    for (const e of entries) {
      const y = yearsAgo(e.date, t);
      if (y < 1) continue;
      const sameDayThatYear = `${e.date.slice(0, 4)}${t.slice(4)}`;
      const diff = Math.abs(parseIsoDate(e.date).getTime() - parseIsoDate(sameDayThatYear).getTime()) / 86_400_000;
      if (diff <= 3) out.push(e);
    }
    return out;
  }, [entries, dates.length, t]);

  return (
    <>
      <h1>On this day</h1>
      <p className="muted">{formatLongDate(t, { day: 'numeric', month: 'long' })} in years gone by.</p>
      {dates.length === 0 && nearby.length === 0 && (
        <div className="empty">
          <div className="big" aria-hidden="true">
            🕰️
          </div>
          <p>No memories from this day yet. Keep writing. Next year, today will be here waiting for you.</p>
        </div>
      )}
      {dates.map((d) => {
        const n = yearsAgo(d, t);
        return (
          <section key={d} aria-label={`${n} ${n === 1 ? 'year' : 'years'} ago`}>
            <h2 className="memory-year">
              {n === 1 ? 'A year ago' : `${n} years ago`} · {d.slice(0, 4)}
            </h2>
            <div className="timeline">
              {entries
                .filter((e) => e.date === d)
                .map((e) => (
                  <EntryCard key={e.id} entry={e} />
                ))}
            </div>
          </section>
        );
      })}
      {nearby.length > 0 && (
        <section aria-label="Around this week in earlier years">
          <h2 className="memory-year">Around this week in earlier years</h2>
          <div className="timeline">
            {nearby.map((e) => (
              <EntryCard key={e.id} entry={e} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ── search ───────────────────────────────────────────────────────────────────────────────────────

export function SearchView({ tag }: { tag?: string }) {
  const { entries, search } = useJournal();
  const [q, setQ] = useState('');
  const [activeTag, setActiveTag] = useState<string | undefined>(tag);
  const tags = useMemo(() => tagCounts(entries), [entries]);
  const results = useMemo(() => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    let list: { entry: Entry; terms: string[] }[] = q.trim()
      ? search
          .search(q)
          .map((h) => ({ entry: byId.get(h.id)!, terms: h.terms }))
          .filter((r) => r.entry)
      : entries.map((entry) => ({ entry, terms: [] }));
    if (activeTag) list = list.filter((r) => r.entry.tags.includes(activeTag));
    return list;
  }, [q, activeTag, entries, search]);
  const filtering = q.trim() || activeTag;

  return (
    <>
      <h1>Search</h1>
      <form className="search-box" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="sr-only" htmlFor="q">
          Search your journal
        </label>
        <input id="q" type="search" autoFocus placeholder="Search words, captions, tags…" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      {tags.length > 0 && (
        <div className="tags" role="group" aria-label="Filter by tag" style={{ marginBottom: 16 }}>
          {tags.map(([t, n]) => (
            <button key={t} type="button" className="tag" aria-pressed={activeTag === t} onClick={() => setActiveTag(activeTag === t ? undefined : t)}>
              #{t} <span aria-hidden="true">· {n}</span>
              <span className="sr-only">, {n} entries</span>
            </button>
          ))}
        </div>
      )}
      <p className="muted" aria-live="polite">
        {filtering ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : `${entries.length} entries`}
      </p>
      <div className="timeline">
        {(filtering ? results : results.slice(0, 30)).map((r) => (
          <EntryCard key={r.entry.id} entry={r.entry} highlight={r.terms} />
        ))}
      </div>
    </>
  );
}

export function isToday(iso: string): boolean {
  return iso === toIsoDate(new Date());
}
