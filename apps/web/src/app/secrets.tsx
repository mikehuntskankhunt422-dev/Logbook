import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { computeStreak, missedDays } from '@logbook/core';
import { useJournal } from './journal-context.tsx';
import { href } from './router.ts';
import { useToast } from './toasts.tsx';
import { useToday } from '../lib/holidays.ts';
import { allFound, endsWithCode, findSecret, KONAMI, spendShields, useSecrets } from '../lib/secrets.ts';

/** Secrets (D115) the whole app looks out for: the Konami code, and shields kept for missed days. */
export function useSecretWatch(): void {
  // The code, typed anywhere but a text box.
  useEffect(() => {
    const keys: string[] = [];
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const on = e.target as HTMLElement | null;
      if (on?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      keys.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      if (keys.length > KONAMI.length) keys.shift();
      if (endsWithCode(keys)) {
        keys.length = 0;
        findSecret('oldschool');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // A streak with nothing written yesterday (or for a few days): shields cover the days missed,
  // one each, if there are enough for all of them.
  const { entries, loaded, locked } = useJournal();
  const { shields, shielded } = useSecrets();
  const day = useToday();
  const toast = useToast();
  useEffect(() => {
    if (!loaded || locked || shields <= 0) return;
    const dates = entries.map((e) => e.date);
    const missed = missedDays(dates, day, shielded);
    if (!missed.length || missed.length > shields) return;
    const spent = spendShields(missed);
    if (!spent) return;
    const kept = computeStreak(dates, day, [...shielded, ...missed]).current;
    const left = shields - spent;
    toast(
      `🛡️ ${spent === 1 ? 'A streak shield' : `${spent} streak shields`} kept your ${kept}-day streak going over ${spent === 1 ? 'the day' : `the ${spent} days`} you missed. ${left === 0 ? 'No shields left.' : `${left} left.`}`,
      { label: 'See secrets', run: () => (location.hash = '#/secrets') },
      9000,
    );
  }, [entries, loaded, locked, shields, shielded, day, toast]);
}

/** Taps on the ✦ by Logbook's name in a row: no more than this long apart. */
const TAP_GAP = 1500;

/** Logbook's name in the top bar; its ✦ turns a little with each tap in a row, and gold once every secret is found. */
export function Brand() {
  const gold = allFound(useSecrets());
  const [taps, setTaps] = useState(0);
  const last = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <a
      className="brand"
      href={href({ name: 'home' })}
      onClick={() => {
        const now = performance.now();
        const n = now - last.current < TAP_GAP ? taps + 1 : 1;
        last.current = now;
        clearTimeout(timer.current);
        if (n >= 7) {
          setTaps(0);
          findSecret('starstruck');
          return;
        }
        setTaps(n);
        timer.current = window.setTimeout(() => setTaps(0), TAP_GAP);
      }}
    >
      <span className="brand-mark" aria-hidden="true" data-gold={gold || undefined} style={{ '--taps': taps } as CSSProperties}>
        ✦
      </span>
      Logbook
    </a>
  );
}
