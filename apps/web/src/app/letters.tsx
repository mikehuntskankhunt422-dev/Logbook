import { useEffect } from 'react';
import { letterKey, lettersOpened } from '@logbook/core';
import { useJournal } from './journal-context.tsx';
import { navigate } from './router.ts';
import { announce } from './toasts.tsx';
import { useToday } from '../lib/holidays.ts';
import { formatLongDate } from '../components/common.tsx';

/**
 * Letters to your future self opening (D122): on the day a sealed letter opens (or the first time
 * Logbook is open after it), it says so, once, with the way to it. What's been said is kept on
 * this device, by letter and seal, so a letter sealed again is news again on its new day.
 */

const KEY = 'logbook.letters';

function told(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function remember(keys: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...told(), ...keys].slice(-500)));
  } catch {
    // Private browsing: it may be said again next time.
  }
}

export function useLetterNotices(): void {
  const { entries, loaded, locked } = useJournal();
  const day = useToday();
  useEffect(() => {
    if (!loaded || locked) return;
    const opened = lettersOpened(entries, day, told());
    const first = opened[0];
    if (!first) return;
    remember(opened.map(letterKey));
    const title = first.title.trim() ? `“${first.title.trim()}”` : 'a letter';
    const message =
      opened.length === 1
        ? `📜 A letter you wrote to yourself on ${formatLongDate(first.date)} has opened: ${title}.`
        : `📜 ${opened.length} letters you wrote to yourself have opened, starting with ${title} from ${formatLongDate(first.date)}.`;
    announce(message, { label: 'Read it', run: () => navigate({ name: 'entry', id: first.id }) }, 12_000);
  }, [entries, loaded, locked, day]);
}
