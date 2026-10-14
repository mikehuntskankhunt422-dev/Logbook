import { useEffect, useMemo, useState } from 'react';
import { growGarden, rankName, TIERS, type Entry, type Garden } from '@logbook/core';
import { useJournal } from './journal-context.tsx';
import { useToast } from './toasts.tsx';
import { celebrate } from '../lib/motion.ts';
import { gardenPrefs, PERKS, setGardenPrefs, useGardenPrefs } from '../lib/garden-prefs.ts';

/** The garden (D97), grown from the journal's live and trashed entries. */
export function useGarden(): Garden | null {
  const { journal, entries, locked } = useJournal();
  const [trash, setTrash] = useState<Entry[] | null>(null);
  useEffect(() => {
    if (locked) return;
    let alive = true;
    void journal
      .listTrash()
      .then((t) => alive && setTrash(t))
      .catch(() => alive && setTrash([]));
    return () => {
      alive = false;
    };
  }, [journal, entries, locked]);
  return useMemo(() => (trash && !locked ? growGarden([...entries, ...trash]) : null), [entries, trash, locked]);
}

/**
 * App-wide: the chosen garden colour, and a word when the garden reaches a new tier or ring
 * ("your garden reached Rare"), with its perk.
 */
export function useGardenEffects(): void {
  const prefs = useGardenPrefs();
  const garden = useGarden();
  const toast = useToast();

  useEffect(() => {
    const root = document.documentElement;
    if (prefs.accent) root.setAttribute('data-accent', prefs.accent);
    else root.removeAttribute('data-accent');
  }, [prefs.accent]);

  const level = garden ? garden.rank.tier * 1000 + garden.rank.ring : -1;
  useEffect(() => {
    if (level < 0 || prefs.hidden) return;
    const seen = gardenPrefs().seen;
    setGardenPrefs({ seen: Math.max(seen, level) });
    // The first look only notes where the garden is: no fanfare for an existing journal.
    if (seen < 0 || level <= seen || !garden) return;
    const tier = garden.rank.tier;
    const perk = garden.rank.ring > 1 ? null : PERKS.find((p) => p.tier === tier);
    toast(`${TIERS[tier]!.emoji} Your garden reached ${rankName(garden.rank)}!${perk ? ` New: ${perk.title}.` : ''}`, { label: 'See it', run: () => (location.hash = '#/garden') }, 8000);
    celebrate('streak');
  }, [level, prefs.hidden, garden, toast]);
}
