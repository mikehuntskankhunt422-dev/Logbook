import type { Root } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Journal } from '@logbook/core';
import { FolderStore } from '@logbook/storage-fs';
import { TauriFsBackend } from '@logbook/storage-fs/tauri';
import { journalFolder, routeLinks } from './bridge.ts';
import { FolderSetup } from './FolderSetup.tsx';
import { UpdateOffer } from './UpdatesPanel.tsx';
import { saveEverything, setOpenJournal } from './saving.ts';
import { checkForUpdatesSoon } from './updates.ts';
import { announce } from '../app/toasts.tsx';

/** Longest the page spends saving when the window closes (Rust gives up after 4 s regardless). */
const CLOSE_WAIT_MS = 3000;
/** After a close was stopped by a failed save, closing again within this long closes anyway. */
const CLOSE_ANYWAY_MS = 15_000;

/**
 * The apps' start: the journal folder instead of browser storage. On the desktop it's chosen on
 * first run; on Android it's inside the app, set up by the app before the page loads (D90).
 */
export async function bootApp(root: Root, render: (journal: Journal) => void): Promise<void> {
  routeLinks();
  if (import.meta.env.VITE_PLATFORM === 'desktop') {
    saveBeforeClosing();
    checkForUpdatesSoon();
  } else {
    void import('../android/updates.ts').then((m) => m.checkForUpdatesSoon());
  }
  const open = async () => {
    const journal = await Journal.open(await FolderStore.open(new TauriFsBackend({ textOnly: import.meta.env.VITE_PLATFORM === 'android' })));
    setOpenJournal(journal);
    render(journal);
  };
  let attempt = 0;
  // A fresh screen each time (key), so a failed attempt doesn't leave its buttons disabled.
  const choose = (problem: { missing?: string | null; error?: string; folder?: string | null }) =>
    root.render(<FolderSetup key={++attempt} {...problem} onReady={() => void open().catch((err: unknown) => choose({ error: message(err), folder: null }))} />);
  const { folder, missing, problem } = await journalFolder();
  if (!folder && import.meta.env.VITE_PLATFORM === 'android') throw new Error(problem ?? 'No storage for the journal.');
  if (!folder) return choose({ missing });
  // A folder that can't be opened (damaged, not a journal) mustn't strand the app: offer another.
  return open().catch((err: unknown) => choose({ error: message(err), folder }));
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Closing the window, or quitting, right after typing: the editor saves 0.7 s after the last key,
 * and a closed window can't finish a save. Rust holds the close and asks here first (D86,
 * src-tauri/src/lib.rs); before a journal is open there's nothing to save, so it answers at once.
 */
function saveBeforeClosing(): void {
  let closeAnywayUntil = 0;
  void listen('logbook://save-before-close', async () => {
    if (Date.now() < closeAnywayUntil) return invoke('close_ready');
    const ok = await saveEverything(CLOSE_WAIT_MS);
    if (ok) return invoke('close_ready');
    // The last writing couldn't be saved (the folder went away, a damaged file): stay open, so it
    // isn't lost without a word, and let a second close within a few seconds go ahead.
    closeAnywayUntil = Date.now() + CLOSE_ANYWAY_MS;
    await invoke('close_cancel');
    announce("Your latest writing couldn't be saved, so Logbook stayed open. Copy it somewhere safe, or close again to quit without it.");
  });
}

export function showError(root: Root, err: unknown): void {
  const android = import.meta.env.VITE_PLATFORM === 'android';
  root.render(
    <main className="empty">
      <h1>{android ? "Logbook can't open your journal" : "Logbook can't open your journal folder"}</h1>
      <p>
        {android
          ? 'Close Logbook and open it again. If this keeps happening, check that the phone has free space.'
          : 'Check that the folder is still there and that Logbook may read and write it, then restart Logbook.'}
      </p>
      <pre className="muted">{String(err)}</pre>
      <UpdateOffer />
    </main>,
  );
}
