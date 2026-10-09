import { useState } from 'react';
import type { Root } from 'react-dom/client';
import { Journal } from '@logbook/core';
import { FsStore } from '@logbook/storage-fs';
import { renderJournal } from '../app/render.tsx';
import { DesktopContext } from './context.ts';
import { TauriJournalFs, chooseJournalFolder, currentJournalFolder, folderLocalKeys } from './tauri-fs.ts';

/** Media nothing refers to waits this long before it's deleted on the desktop (D84). */
const MEDIA_GRACE_DAYS = 7;

/** Desktop start: the remembered journal folder, or the first-run screen to choose one (M5 §2.2). */
export async function bootDesktop(root: Root): Promise<void> {
  const folder = await currentJournalFolder();
  if (folder) await openFolder(root, folder);
  else root.render(<Welcome onChosen={(f) => void openFolder(root, f)} />);
}

async function openFolder(root: Root, folder: string): Promise<void> {
  try {
    const store = await FsStore.open(new TauriJournalFs(folder), folderLocalKeys(folder));
    const journal = await Journal.open(store, { mediaGraceDays: MEDIA_GRACE_DAYS });
    renderJournal(root, journal, (app) => <DesktopContext.Provider value={{ folder, store }}>{app}</DesktopContext.Provider>);
  } catch (err) {
    root.render(<FolderProblem folder={folder} error={err} onRetry={() => void openFolder(root, folder)} onChosen={(f) => void openFolder(root, f)} />);
  }
}

function useChooseFolder(onChosen: (folder: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choose = async () => {
    setBusy(true);
    setError('');
    try {
      const folder = await chooseJournalFolder();
      if (folder) onChosen(folder);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, choose };
}

function Welcome({ onChosen }: { onChosen: (folder: string) => void }) {
  const { busy, error, choose } = useChooseFolder(onChosen);
  return (
    <main className="lock-screen">
      <div className="lock-card welcome-card">
        <div style={{ fontSize: '2.6rem' }} aria-hidden="true">
          📁
        </div>
        <h1>Where should your journal live?</h1>
        <p>Logbook keeps your journal as ordinary files in a folder you choose. Put the folder inside OneDrive, Dropbox or iCloud Drive to have your journal on your other computers too.</p>
        <p className="hint">Choose an empty folder to start a new journal, or a folder that already holds one. If the folder has other files in it, Logbook makes a “Logbook” folder inside.</p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void choose()}>
          {busy ? 'Choosing…' : 'Choose a folder…'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

function FolderProblem({ folder, error, onRetry, onChosen }: { folder: string; error: unknown; onRetry: () => void; onChosen: (folder: string) => void }) {
  const choice = useChooseFolder(onChosen);
  return (
    <main className="lock-screen">
      <div className="lock-card welcome-card">
        <div style={{ fontSize: '2.6rem' }} aria-hidden="true">
          ⚠️
        </div>
        <h1>Logbook can't open your journal folder</h1>
        <p>
          <code className="folder-path">{folder}</code>
        </p>
        <p className="hint">If the folder is on a drive that isn't connected, or a sync service is still downloading it, try again in a moment.</p>
        <p className="error" role="alert">
          {error instanceof Error ? error.message : String(error)}
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="btn" disabled={choice.busy} onClick={() => void choice.choose()}>
            Choose another folder…
          </button>
        </div>
        {choice.error && (
          <p className="error" role="alert">
            {choice.error}
          </p>
        )}
      </div>
    </main>
  );
}
