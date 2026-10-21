import { useEffect, useMemo, useState } from 'react';
import { growGarden, rankName, TIERS, type Entry, type Garden, type GardenCache } from '@logbook/core';
import { useJournal } from './journal-context.tsx';
import { useToast } from './toasts.tsx';
import { celebrate } from '../lib/motion.ts';
import { gardenPrefs, listed, noteUpdate, rankUpNews, setGardenPrefs, useGardenPrefs } from '../lib/garden-prefs.ts';

/** Each entry's words, worked out once per saved version, so a save only re-reads that entry. */
const cache: GardenCache = new Map();

/**
 * The garden (D97), grown from the journal's live and trashed entries. Worked out once, in App,
 * and only while the journal is open and the garden is shown; null otherwise.
 */
export function useGarden(enabled: boolean): Garden | null {
  const { journal, entries, locked, loaded } = useJournal();
  const [trash, setTrash] = useState<Entry[] | null>(null);
  const active = enabled && loaded && !locked;
  // The trash changes only when an entry is deleted, restored or purged, so it's read again when
  // the set of entries changes, not on every save.
  const ids = useMemo(() => entries.map((e) => e.id).join(' '), [entries]);
  useEffect(() => {
    if (!active) {
      // Nothing decrypted stays behind once the journal locks.
      setTrash(null);
      if (locked) cache.clear();
      return;
    }
    let alive = true;
    void journal
      .listTrash()
      .catch(() => [] as Entry[])
      .then((t) => alive && setTrash(t));
    return () => {
      alive = false;
    };
  }, [journal, ids, active, locked]);
  return useMemo(() => (active && trash ? growGarden([...entries, ...trash], cache) : null), [active, entries, trash]);
}

/**
 * App-wide: the chosen garden colour, and a word when the garden reaches a new tier or ring
 * ("your garden reached Rare"), with its perk.
 */
export function useGardenEffects(garden: Garden | null): void {
  const prefs = useGardenPrefs();
  const toast = useToast();

  useEffect(() => {
    const root = document.documentElement;
    // Hiding the garden puts its colour away too.
    if (prefs.accent && !prefs.hidden) root.setAttribute('data-accent', prefs.accent);
    else root.removeAttribute('data-accent');
  }, [prefs.accent, prefs.hidden]);

  const level = garden ? garden.rank.tier * 1000 + garden.rank.ring : -1;
  useEffect(() => {
    if (!garden || level < 0) return;
    const prefs = gardenPrefs();
    const seen = prefs.seen;
    // Before any rank-up: which tiers a new garden update finds this device at.
    const note = noteUpdate(prefs);
    if (note) setGardenPrefs(note);
    if (level <= seen) return;
    setGardenPrefs({ seen: level });
    // The first look only notes where the garden is: no fanfare for an existing journal.
    if (seen < 0) return;
    const tier = garden.rank.tier;
    const news = rankUpNews(Math.floor(seen / 1000), tier);
    toast(`${TIERS[tier]!.emoji} Your garden reached ${rankName(garden.rank)}!${news.length ? ` New: ${listed(news)}.` : ''}`, { label: 'See it', run: () => (location.hash = '#/garden') }, 8000);
    celebrate('streak');
  }, [level, garden, toast]);
}
