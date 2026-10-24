import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Journal } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';

/**
 * Another computer's changes to the journal folder (D102): the app watches it
 * (src-tauri/src/watch.rs) and says which files changed once they've settled; the journal then
 * reads the folder again, and every view, the editor included, shows what arrived.
 */
export async function watchJournal(journal: Journal): Promise<void> {
  let running = false;
  let again = false;
  const refresh = () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void journal
      .refresh()
      .catch(() => {})
      .finally(() => {
        running = false;
        if (again) {
          again = false;
          refresh();
        }
      });
  };
  await listen<{ paths: string[] }>('logbook://journal-changed', refresh);
  await invoke('journal_watch');
}

/**
 * How many files in the journal folder need a person: copies to sort out, files that can't be read.
 * Counted again each time the entries are read, which is when the store finds them.
 */
export function useFilesToSortOut(): number {
  const { journal, entries } = useJournal();
  const [n, setN] = useState(0);
  useEffect(() => {
    const count = () => setN((journal.store.conflicts?.().length ?? 0) + (journal.store.unreadableFiles?.().length ?? 0));
    count();
    return journal.subscribe((event) => {
      if (event === 'media') count();
    });
  }, [journal, entries]);
  return n;
}
