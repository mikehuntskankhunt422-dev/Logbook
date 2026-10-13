import { useEffect, useId, useState } from 'react';
import { newId } from '@logbook/core';
import { useClock } from '../app/clock.tsx';
import { arm, DAY_NAMES, describeDays, formatClock, formatTime, nextRing, ringsIn, type Alarm } from '../lib/clock.ts';
import { primeSound } from '../lib/chime.ts';
import { notifyPermission, type NotifyPermission } from '../lib/clock-native.ts';
import { isAndroid, isApp } from '../lib/platform.ts';

/** The clock (D92): alarms, a timer and a stopwatch, like a phone's clock app. */

type Tab = 'alarms' | 'timer' | 'stopwatch';
const TABS: [Tab, string, string][] = [
  ['alarms', 'Alarms', '⏰'],
  ['timer', 'Timer', '⏲️'],
  ['stopwatch', 'Stopwatch', '⏱️'],
];

/** The time now, every `ms` while `on`. */
function useNow(ms: number, on = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

export function ClockView() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (sessionStorage.getItem('logbook.clock-tab') as Tab | null) ?? 'alarms';
    } catch {
      return 'alarms';
    }
  });
  const choose = (t: Tab) => {
    setTab(t);
    try {
      sessionStorage.setItem('logbook.clock-tab', t);
    } catch {
      // The tab is only remembered for convenience.
    }
  };
  const now = useNow(1000);
  const id = useId();
  return (
    <div className="clock-page">
      <div className="clock-now" aria-hidden="true">
        <div className="clock-now-time">{new Date(now).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
        <div className="muted">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
      <h1 className="sr-only">Clock</h1>
      <NotificationNotice />
      <div className="clock-tabs" role="tablist" aria-label="Clock">
        {TABS.map(([t, label, icon]) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${id}-${t}`}
            aria-selected={tab === t}
            aria-controls={`${id}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => choose(t)}
            onKeyDown={(e) => {
              const i = TABS.findIndex(([x]) => x === t);
              const next = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i + TABS.length - 1) % TABS.length] : undefined;
              if (next) {
                e.preventDefault();
                choose(next[0]);
                document.getElementById(`${id}-${next[0]}`)?.focus();
              }
            }}
          >
            <span aria-hidden="true">{icon}</span> {label}
          </button>
        ))}
      </div>
      <div className="clock-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} key={tab}>
        {tab === 'alarms' ? <Alarms /> : tab === 'timer' ? <Timer /> : <Stopwatch />}
      </div>
    </div>
  );
}

function NotificationNotice() {
  const [state, setState] = useState<NotifyPermission | null>(null);
  useEffect(() => {
    void notifyPermission(false).then(setState);
  }, []);
  const where = isAndroid ? 'They ring even when Logbook is closed.' : isApp ? 'They ring while Logbook is open, even in the background.' : 'They ring while this page is open.';
  if (state === 'prompt')
    return (
      <p className="notice clock-notice">
        {where} Turn on notifications to see them when Logbook isn’t in front.{' '}
        <button type="button" className="btn btn-small" onClick={() => void notifyPermission(true).then(setState)}>
          🔔 Turn on notifications
        </button>
      </p>
    );
  if (state === 'denied') return <p className="notice clock-notice">{where} Notifications are off for Logbook, so you’ll hear them only with Logbook in front.</p>;
  return <p className="hint clock-notice">{where}</p>;
}

// ── alarms ───────────────────────────────────────────────────────────────────────────────────────

function Alarms() {
  const { clock, update } = useClock();
  const [editing, setEditing] = useState<Alarm | null>(null);
  const now = useNow(30_000);
  const sorted = [...clock.alarms].sort((a, b) => a.time.localeCompare(b.time));
  const next = clock.alarms
    .map((a) => nextRing(a, new Date(now)))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)[0];

  const save = (alarm: Alarm) => {
    primeSound();
    void notifyPermission(true);
    update((c) => {
      const armed = arm(alarm, new Date());
      const exists = c.alarms.some((a) => a.id === alarm.id);
      return { ...c, alarms: exists ? c.alarms.map((a) => (a.id === alarm.id ? armed : a)) : [...c.alarms, armed] };
    });
    setEditing(null);
  };
  const toggle = (alarm: Alarm, on: boolean) => {
    if (on) primeSound();
    update((c) => ({ ...c, alarms: c.alarms.map((a) => (a.id === alarm.id ? (on ? arm(a, new Date()) : { ...a, on: false, onceAt: null }) : a)) }));
  };
  const remove = (alarm: Alarm) => {
    update((c) => ({ ...c, alarms: c.alarms.filter((a) => a.id !== alarm.id) }));
    setEditing(null);
  };

  return (
    <div>
      <p className="clock-next" aria-live="polite">
        {next ? `Next alarm ${ringsIn(next, now)}` : clock.alarms.length ? 'No alarms on.' : 'No alarms yet.'}
      </p>
      {sorted.length > 0 && (
        <ul className="alarm-list">
          {sorted.map((a) => (
            <li key={a.id} className="alarm-card" data-on={a.on}>
              <button type="button" className="alarm-main" onClick={() => setEditing(a)} aria-label={`Change the ${formatTime(a.time)} alarm${a.label ? `, ${a.label}` : ''}`}>
                <span className="alarm-time">{formatTime(a.time)}</span>
                <span className="alarm-meta">
                  {a.label && <strong>{a.label}</strong>} <span className="muted">{describeDays(a.days)}</span>
                </span>
              </button>
              <label className="switch">
                <input type="checkbox" role="switch" checked={a.on} onChange={(e) => toggle(a, e.target.checked)} aria-label={`${formatTime(a.time)} alarm${a.label ? `, ${a.label}` : ''}`} />
                <span className="switch-track" aria-hidden="true" />
              </label>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <AlarmEditor key={editing.id} alarm={editing} isNew={!clock.alarms.some((a) => a.id === editing.id)} onSave={save} onCancel={() => setEditing(null)} onDelete={() => remove(editing)} />
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ id: newId(), time: `${String((new Date().getHours() + 1) % 24).padStart(2, '0')}:00`, label: '', days: [], on: true })}>
          ＋ Add an alarm
        </button>
      )}
    </div>
  );
}

function AlarmEditor({ alarm, isNew, onSave, onCancel, onDelete }: { alarm: Alarm; isNew: boolean; onSave: (a: Alarm) => void; onCancel: () => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(alarm);
  const id = useId();
  const toggleDay = (d: number) => setDraft((a) => ({ ...a, days: a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d].sort() }));
  return (
    <form
      className="panel alarm-editor"
      aria-label={isNew ? 'New alarm' : 'Change alarm'}
      onSubmit={(e) => {
        e.preventDefault();
        if (/^\d\d:\d\d$/.test(draft.time)) onSave({ ...draft, label: draft.label.trim() });
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-time`}>Time</label>
        <input id={`${id}-time`} type="time" className="alarm-time-input" required value={draft.time} onChange={(e) => setDraft((a) => ({ ...a, time: e.target.value }))} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-label`}>Label</label>
        <input id={`${id}-label`} type="text" maxLength={60} placeholder="Wake up, Take medicine…" value={draft.label} onChange={(e) => setDraft((a) => ({ ...a, label: e.target.value }))} />
      </div>
      <div className="field">
        <span id={`${id}-days`}>Repeat</span>
        <div className="day-picker" role="group" aria-labelledby={`${id}-days`}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button key={d} type="button" aria-pressed={draft.days.includes(d)} aria-label={DAY_NAMES[d]} onClick={() => toggleDay(d)}>
              {DAY_NAMES[d]!.slice(0, 2)}
            </button>
          ))}
        </div>
        <span className="hint">{describeDays(draft.days)}</span>
      </div>
      <div className="row">
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        {!isNew && (
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

// ── timer ────────────────────────────────────────────────────────────────────────────────────────

const PRESETS = [1, 3, 5, 10, 15, 30, 60];

function Timer() {
  const { clock, update } = useClock();
  const { timer } = clock;
  const running = timer.endsAt !== null;
  const paused = !running && timer.leftMs !== null;
  const now = useNow(200, running);
  const left = running ? Math.max(0, timer.endsAt! - now) : paused ? timer.leftMs! : timer.durationMs;
  const id = useId();

  const set = (ms: number) => update((c) => ({ ...c, timer: { ...c.timer, durationMs: Math.max(0, Math.min(ms, 24 * 3_600_000 - 1000)) } }));
  const h = Math.floor(timer.durationMs / 3_600_000);
  const m = Math.floor(timer.durationMs / 60_000) % 60;
  const s = Math.floor(timer.durationMs / 1000) % 60;
  const part = (hh: number, mm: number, ss: number) => set(((hh * 60 + mm) * 60 + ss) * 1000);

  const start = () => {
    primeSound();
    void notifyPermission(true);
    update((c) => ({ ...c, timer: { ...c.timer, endsAt: Date.now() + (c.timer.leftMs ?? c.timer.durationMs), leftMs: null } }));
  };
  const pause = () => update((c) => ({ ...c, timer: { ...c.timer, leftMs: Math.max(0, (c.timer.endsAt ?? Date.now()) - Date.now()), endsAt: null } }));
  const cancel = () => update((c) => ({ ...c, timer: { ...c.timer, endsAt: null, leftMs: null } }));
  const addMinute = () =>
    update((c) => ({
      ...c,
      timer: {
        ...c.timer,
        durationMs: c.timer.durationMs + 60_000,
        endsAt: c.timer.endsAt === null ? null : c.timer.endsAt + 60_000,
        leftMs: c.timer.leftMs === null ? null : c.timer.leftMs + 60_000,
      },
    }));

  if (running || paused) {
    const progress = timer.durationMs ? left / timer.durationMs : 0;
    return (
      <div className="timer-running">
        <div className="timer-ring" data-paused={paused}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="timer-ring-track" cx="60" cy="60" r="54" />
            <circle className="timer-ring-bar" cx="60" cy="60" r="54" pathLength={1} style={{ strokeDashoffset: 1 - progress }} />
          </svg>
          <div className="timer-left" role="timer" aria-live="off" aria-label={`${formatClock(left)} left`}>
            {formatClock(left)}
          </div>
        </div>
        <div className="row clock-buttons">
          {running ? (
            <button type="button" className="btn btn-primary" onClick={pause}>
              ⏸ Pause
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={start}>
              ▶️ Resume
            </button>
          )}
          <button type="button" className="btn" onClick={addMinute}>
            ＋1 min
          </button>
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="timer-setup">
      <div className="timer-fields" role="group" aria-label="Timer length">
        {(
          [
            ['Hours', h, 23, (v: number) => part(v, m, s)],
            ['Minutes', m, 59, (v: number) => part(h, v, s)],
            ['Seconds', s, 59, (v: number) => part(h, m, v)],
          ] as const
        ).map(([label, value, max, change]) => (
          <div key={label} className="timer-field">
            <input
              id={`${id}-${label}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={max}
              value={value}
              onChange={(e) => change(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))}
              onFocus={(e) => e.target.select()}
            />
            <label htmlFor={`${id}-${label}`}>{label}</label>
          </div>
        ))}
      </div>
      <div className="timer-presets" role="group" aria-label="Quick times">
        {PRESETS.map((p) => (
          <button key={p} type="button" className="chip" aria-pressed={timer.durationMs === p * 60_000} onClick={() => set(p * 60_000)}>
            {p < 60 ? `${p} min` : '1 hour'}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-primary btn-big" disabled={timer.durationMs < 1000} onClick={start}>
        ▶️ Start
      </button>
    </div>
  );
}

// ── stopwatch ────────────────────────────────────────────────────────────────────────────────────

function Stopwatch() {
  const { clock, update } = useClock();
  const { stopwatch: sw } = clock;
  const running = sw.startedAt !== null;
  const now = useNow(41, running);
  const elapsed = running ? now - sw.startedAt! : sw.elapsedMs;

  const start = () => update((c) => ({ ...c, stopwatch: { ...c.stopwatch, startedAt: Date.now() - c.stopwatch.elapsedMs } }));
  const stop = () => update((c) => ({ ...c, stopwatch: { ...c.stopwatch, elapsedMs: Date.now() - (c.stopwatch.startedAt ?? Date.now()), startedAt: null } }));
  const lap = () => update((c) => ({ ...c, stopwatch: { ...c.stopwatch, laps: [...c.stopwatch.laps, Date.now() - (c.stopwatch.startedAt ?? Date.now())] } }));
  const reset = () => update((c) => ({ ...c, stopwatch: { startedAt: null, elapsedMs: 0, laps: [] } }));

  const splits = sw.laps.map((t, i) => t - (sw.laps[i - 1] ?? 0));
  const fastest = splits.length > 1 ? Math.min(...splits) : null;
  const slowest = splits.length > 1 ? Math.max(...splits) : null;
  return (
    <div className="stopwatch">
      <div className="stopwatch-time" role="timer" aria-live="off">
        {formatClock(elapsed, true)}
      </div>
      <div className="row clock-buttons">
        {running ? (
          <>
            <button type="button" className="btn btn-primary" onClick={stop}>
              ⏹ Stop
            </button>
            <button type="button" className="btn" onClick={lap}>
              🏁 Lap
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={start}>
              ▶️ {elapsed ? 'Resume' : 'Start'}
            </button>
            <button type="button" className="btn" onClick={reset} disabled={!elapsed && !sw.laps.length}>
              Reset
            </button>
          </>
        )}
      </div>
      {splits.length > 0 && (
        <ol className="laps" aria-label="Laps">
          {splits
            .map((split, i) => (
              <li key={i} data-best={split === fastest} data-worst={split === slowest}>
                <span>Lap {i + 1}</span>
                <span>{formatClock(split, true)}</span>
                <span className="muted">{formatClock(sw.laps[i]!, true)}</span>
              </li>
            ))
            .reverse()}
        </ol>
      )}
    </div>
  );
}
