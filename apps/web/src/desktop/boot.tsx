import type { Root } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Journal } from '@logbook/core';
import { FolderStore } from '@logbook/storage-fs';
import { TauriFsBackend } from '@logbook/storage-fs/tauri';
import { journalFolder, routeLinks } from './bridge.ts';
import { FolderSetup } from './FolderSetup.tsx';
import { flushPendingSaves } from '../lib/pending-saves.ts';
import { announce } from '../app/toasts.tsx';

/** Longest the page spends saving when the window closes (Rust gives up after 4 s regardless). */
const CLOSE_WAIT_MS = 3000;
/** After a close was stopped by a failed save, closing again within this long closes anyway. */
const CLOSE_ANYWAY_MS = 15_000;

/** The desktop app's start: the journal folder, chosen on first run, instead of browser storage. */
export async function bootDesktop(root: Root, render: (journal: Journal) => void): Promise<void> {
  routeLinks();
  let current: Journal | null = null;
  saveBeforeClosing(() => current);
  const open = async () => {
    const journal = await Journal.open(await FolderStore.open(new TauriFsBackend()));
    current = journal;
    render(journal);
  };
  let attempt = 0;
  // A fresh screen each time (key), so a failed attempt doesn't leave its buttons disabled.
  const choose = (problem: { missing?: string | null; error?: string; folder?: string | null }) =>
    root.render(<FolderSetup key={++attempt} {...problem} onReady={() => void open().catch((err: unknown) => choose({ error: message(err), folder: null }))} />);
  const { folder, missing } = await journalFolder();
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
function saveBeforeClosing(journal: () => Journal | null): void {
  let closeAnywayUntil = 0;
  void listen('logbook://save-before-close', async () => {
    if (Date.now() < closeAnywayUntil) return invoke('close_ready');
    const saved = flushPendingSaves().then(async (ok) => (await journal()?.store.whenIdle?.(), ok));
    const ok = await Promise.race([saved, new Promise<boolean>((r) => setTimeout(() => r(false), CLOSE_WAIT_MS))]);
    if (ok) return invoke('close_ready');
    // The last writing couldn't be saved (the folder went away, a damaged file): stay open, so it
    // isn't lost without a word, and let a second close within a few seconds go ahead.
    closeAnywayUntil = Date.now() + CLOSE_ANYWAY_MS;
    await invoke('close_cancel');
    announce("Your latest writing couldn't be saved, so Logbook stayed open. Copy it somewhere safe, or close again to quit without it.");
  });
}

export function showError(root: Root, err: unknown): void {
  root.render(
    <main className="empty">
      <h1>Logbook can't open your journal folder</h1>
      <p>Check that the folder is still there and that Logbook may read and write it, then restart Logbook.</p>
      <pre className="muted">{String(err)}</pre>
    </main>,
  );
}
