import { useMemo } from 'react';
import { entryWordCount, shelveLibrary, type Entry, type LibraryGallery } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';

/** Each entry's words, worked out once per saved version, so a save only counts that entry again. */
const counted = new Map<string, number>();

/** The Library (D112) of the journal's entries; null while it's locked or loading. */
export function useLibrary(): LibraryGallery[] | null {
  const { entries, loaded, locked } = useJournal();
  return useMemo(() => {
    if (!loaded || locked) {
      counted.clear();
      return null;
    }
    const used = new Set<string>();
    const wordsOf = (entry: Entry) => {
      const key = `${entry.id}\u0000${entry.rev}\u0000${entry.updatedAt}`;
      used.add(key);
      let words = counted.get(key);
      if (words === undefined) counted.set(key, (words = entryWordCount(entry)));
      return words;
    };
    const library = shelveLibrary(entries, wordsOf);
    for (const key of counted.keys()) if (!used.has(key)) counted.delete(key);
    return library;
  }, [entries, loaded, locked]);
}
