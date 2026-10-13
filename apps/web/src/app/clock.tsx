import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { alarmTitle, loadClock, nextRing, ringId, saveClock, SNOOZE_MS, STALE_MS, upcoming, formatDuration, type ClockState, type Ring } from '../lib/clock.ts';
import { startChime } from '../lib/chime.ts';
import { notifyHidden, onSystemRing, scheduleRings } from '../lib/clock-native.ts';

/**
 * The clock's engine (D92): keeps the alarms, timer and stopwatch, rings what's due on any page
 * (also behind the lock screen), and hands what's coming up to the system.
 */

interface ClockContext {
  clock: ClockState;
  update: (fn: (c: ClockState) => ClockState) => void;
  ringing: Ring[];
  stop: () => void;
  snooze: () => void;
}

const Ctx = createContext<ClockContext | null>(null);

export function useClock(): ClockContext {
  const c = useContext(Ctx);
  if (!c) throw new Error('useClock outside ClockProvider');
  return c;
}

export function ClockProvider({ children }: { children: ReactNode }) {
  const [clock, setClock] = useState(loadClock);
  const [ringing, setRinging] = useState<Ring[]>([]);
  const latest = useRef(clock);
  latest.current = clock;
  // Rings from here on are new. On opening, the last five minutes count too: an alarm whose
  // notification was tapped to open Logbook still rings in it.
  const checked = useRef(Math.max(clock.checkedUntil ?? 0, Date.now() - STALE_MS));

  const update = useCallback((fn: (c: ClockState) => ClockState) => {
    setClock((c) => {
      const next = fn(c);
      saveClock(next);
      return next;
    });
  }, []);

  // What has come due since the last look.
  const tick = useCallback(() => {
    const now = Date.now();
    const from = Math.max(checked.current, now - STALE_MS);
    checked.current = now;
    const c = latest.current;
    const due: Ring[] = [];
    const ring = (key: string, at: number, title: string, body: string) => due.push({ key, id: ringId(key), at, title, body });
    let changed = false;
    const alarms = c.alarms.map((a) => {
      if (!a.on) return a;
      if (!a.days.length && a.onceAt) {
        // Once only: rings at its time (unless that was long ago), then turns off.
        if (a.onceAt > now) return a;
        if (a.onceAt > now - STALE_MS) ring(`alarm:${a.id}:${a.onceAt}`, a.onceAt, alarmTitle(a), 'Alarm');
        changed = true;
        return { ...a, on: false, onceAt: null };
      }
      const at = nextRing(a, new Date(from));
      if (at !== null && at <= now) ring(`alarm:${a.id}:${at}`, at, alarmTitle(a), 'Alarm');
      return a;
    });
    let timer = c.timer;
    if (timer.endsAt !== null && timer.endsAt <= now) {
      if (timer.endsAt > now - STALE_MS) ring(`timer:${timer.endsAt}`, timer.endsAt, '⏲️ Time’s up', `Your ${formatDuration(timer.durationMs)} timer has finished.`);
      timer = { ...timer, endsAt: null, leftMs: null };
      changed = true;
    }
    const snoozes = c.snoozes.filter((s) => {
      if (s.at > now) return true;
      if (s.at > now - STALE_MS) ring(`snooze:${s.key}`, s.at, s.label, 'Snoozed');
      changed = true;
      return false;
    });
    if (!due.length && !changed) return;
    update((x) => ({ ...x, alarms, timer, snoozes, checkedUntil: now }));
    if (due.length) {
      setRinging((r) => [...r, ...due.filter((d) => !r.some((x) => x.key === d.key))]);
      for (const d of due) notifyHidden(d.title, d.body);
    }
  }, [update]);

  // Look every second while anything could ring, and as soon as the desktop app's watcher rings
  // (a hidden window's timers run late).
  const active = clock.alarms.some((a) => a.on) || clock.timer.endsAt !== null || clock.snoozes.length > 0;
  useEffect(() => {
    if (!active) return;
    tick();
    const timer = setInterval(tick, 1000);
    const onShow = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onShow);
    let unlisten: (() => void) | undefined;
    let gone = false;
    void onSystemRing(tick).then((u) => (gone ? u() : (unlisten = u)));
    return () => {
      gone = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
      unlisten?.();
    };
  }, [active, tick]);

  // The system gets what's coming up, so it can ring without the page (Android: with Logbook
  // closed). Half a second after the last change.
  const plan = useMemo(() => JSON.stringify(upcoming(clock, new Date()).map((r) => [r.id, r.at, r.title])), [clock]);
  useEffect(() => {
    const t = setTimeout(() => void scheduleRings(upcoming(latest.current, new Date())).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [plan]);

  // The sound, while anything rings.
  const sounding = ringing.length > 0;
  useEffect(() => {
    if (!sounding) return;
    return startChime();
  }, [sounding]);

  const stop = useCallback(() => setRinging([]), []);
  const snooze = useCallback(() => {
    const at = Date.now() + SNOOZE_MS;
    update((c) => ({ ...c, snoozes: [...c.snoozes, ...ringing.map((r) => ({ key: `${r.key}+${at}`, label: r.title, at }))] }));
    setRinging([]);
  }, [ringing, update]);

  const value = useMemo(() => ({ clock, update, ringing, stop, snooze }), [clock, update, ringing, stop, snooze]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** What's ringing, over whatever page is showing (the lock screen too). */
export function Ringer() {
  const { ringing, stop, snooze } = useClock();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ringing.length && !d.open) d.showModal();
    if (!ringing.length && d.open) d.close();
  }, [ringing.length]);
  const first = ringing[0];
  return (
    <dialog ref={ref} className="ringer" aria-labelledby="ringer-title" onCancel={(e) => (e.preventDefault(), stop())}>
      {first && (
        <>
          <div className="ringer-bell" aria-hidden="true">
            {first.title.startsWith('⏲️') ? '⏲️' : '⏰'}
          </div>
          <h2 id="ringer-title">{first.title.replace(/^(⏰|⏲️)\s*/u, '')}</h2>
          {first.body && <p>{first.body}</p>}
          {ringing.length > 1 && <p className="muted">and {ringing.length - 1} more</p>}
          <div className="ringer-actions">
            <button type="button" className="btn" onClick={snooze}>
              💤 Snooze 10 min
            </button>
            <button type="button" className="btn btn-primary" onClick={stop} autoFocus>
              Stop
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
