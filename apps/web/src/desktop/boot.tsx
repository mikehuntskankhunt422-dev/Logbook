import type { Root } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Journal } from '@logbook/core';
import { FolderStore } from '@logbook/storage-fs';
import { TauriFsBackend } from '@logbook/storage-fs/tauri';
import { journalFolder, routeLinks } from './bridge.ts';
import { FolderSetup } from './FolderSetup.tsx';
import { flushPendingSaves } from '../lib/pending-saves.ts';

/** Longest the page spends saving when the window closes (Rust gives up after 4 s regardless). */
const CLOSE_WAIT_MS = 3000;

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
  void listen('logbook://save-before-close', async () => {
    const saved = flushPendingSaves().then(() => journal()?.store.whenIdle?.());
    await Promise.race([saved, new Promise((r) => setTimeout(r, CLOSE_WAIT_MS))]);
    await invoke('close_ready');
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
