import type { Root } from 'react-dom/client';
import { Journal } from '@logbook/core';
import { FolderStore } from '@logbook/storage-fs';
import { TauriFsBackend } from '@logbook/storage-fs/tauri';
import { journalFolder, routeLinks } from './bridge.ts';
import { FolderSetup } from './FolderSetup.tsx';

/** The desktop app's start: the journal folder, chosen on first run, instead of browser storage. */
export async function bootDesktop(root: Root, render: (journal: Journal) => void): Promise<void> {
  routeLinks();
  const open = async () => render(await Journal.open(await FolderStore.open(new TauriFsBackend())));
  const { folder, missing } = await journalFolder();
  if (folder) return open();
  root.render(<FolderSetup missing={missing} onReady={() => void open().catch((err: unknown) => showError(root, err))} />);
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
