import { useRef, useState } from 'react';
import type { Root } from 'react-dom/client';
import { BackupError, Journal, PasscodeRequiredError, WrongPasscodeError, importBackup, inspectBackup } from '@logbook/core';
import { FsStore } from '@logbook/storage-fs';
import { renderJournal } from '../app/render.tsx';
import { DesktopContext, type DesktopCtx } from './context.ts';
import { TauriJournalFs, chooseJournalFolder, currentJournalFolder, folderLocalKeys } from './tauri-fs.ts';

/** Media nothing refers to waits this long before it's deleted on the desktop (D84). */
const MEDIA_GRACE_DAYS = 7;

interface Opened {
  journal: Journal;
  desktop: Omit<DesktopCtx, 'notice'>;
}

/** Desktop start: the remembered journal folder, or the first-run screen (M5 §2.2, §2.4). */
export async function bootDesktop(root: Root): Promise<void> {
  const show = (opened: Opened, notice?: string) => {
    const desktop: DesktopCtx = { ...opened.desktop, notice };
    renderJournal(root, opened.journal, (app) => <DesktopContext.Provider value={desktop}>{app}</DesktopContext.Provider>);
  };
  const tryFolder = async (folder: string) => {
    try {
      show(await openJournal(folder));
    } catch (err) {
      root.render(<FolderProblem folder={folder} error={err} onRetry={() => void tryFolder(folder)} onChosen={(f) => void tryFolder(f)} />);
    }
  };
  const folder = await currentJournalFolder();
  if (folder) await tryFolder(folder);
  else root.render(<Welcome onOpened={show} />);
}

async function openJournal(folder: string): Promise<Opened> {
  const fs = new TauriJournalFs(folder);
  const store = await FsStore.open(fs, folderLocalKeys(folder));
  const journal = await Journal.open(store, { mediaGraceDays: MEDIA_GRACE_DAYS });
  return { journal, desktop: { folder, store, watch: (onChange) => fs.watch(onChange) } };
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>, explain: (err: unknown) => string = (err) => (err instanceof Error ? err.message : String(err))) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Welcome({ onOpened }: { onOpened: (opened: Opened, notice?: string) => void }) {
  const { busy, error, run } = useBusy();
  const backupInput = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<{ file: File; encrypted: boolean } | null>(null);
  const [passcode, setPasscode] = useState('');
  const [keepEncrypted, setKeepEncrypted] = useState(true);
  // The folder chosen for the backup, kept so a wrong passcode can be retried without choosing again.
  const [target, setTarget] = useState<Opened | null>(null);

  const startNew = () =>
    run(async () => {
      const folder = await chooseJournalFolder();
      if (folder) onOpened(await openJournal(folder));
    });

  const pickBackup = (file: File) =>
    run(async () => {
      const { encrypted } = await inspectBackup(file);
      setPasscode('');
      setBackup({ file, encrypted });
    });

  const restore = () =>
    run(
      async () => {
        if (!backup) return;
        let opened = target;
        if (!opened) {
          const folder = await chooseJournalFolder();
          if (!folder) return;
          opened = await openJournal(folder);
          setTarget(opened);
        }
        const { journal } = opened;
        if (journal.isLocked) throw new Error('That folder holds a journal with a passcode. Open it with “Choose a folder…”, unlock it, and restore the backup from Settings.');
        // Merge: into an empty folder that's everything; into an existing journal the newer copy of each entry wins.
        const report = await importBackup(journal, backup.file, { mode: 'merge', passcode: backup.encrypted ? passcode : undefined });
        if (backup.encrypted && keepEncrypted && !journal.isEncrypted) await journal.enableEncryption(passcode);
        const entries = report.entriesAdded + report.entriesUpdated;
        onOpened(opened, `Restored ${entries} ${entries === 1 ? 'entry' : 'entries'} and ${report.mediaAdded} ${report.mediaAdded === 1 ? 'photo or file' : 'photos and files'} from ${backup.file.name}.`);
      },
      (err) =>
        err instanceof WrongPasscodeError
          ? 'That passcode is not right for this backup.'
          : err instanceof PasscodeRequiredError || err instanceof BackupError || err instanceof Error
            ? err.message
            : String(err),
    );

  return (
    <main className="lock-screen">
      <div className="lock-card welcome-card">
        {backup ? (
          <>
            <div style={{ fontSize: '2.6rem' }} aria-hidden="true">
              🗂️
            </div>
            <h1>Restore a backup</h1>
            <p>
              <code className="folder-path">{backup.file.name}</code>
            </p>
            {backup.encrypted && (
              <form
                className="welcome-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void restore();
                }}
              >
                <label htmlFor="backup-pass">This backup is encrypted. Its passcode:</label>
                <input id="backup-pass" className="text-input" type="password" autoComplete="current-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
                <label className="row">
                  <input type="checkbox" checked={keepEncrypted} onChange={(e) => setKeepEncrypted(e.target.checked)} /> Keep the journal encrypted with this passcode
                </label>
              </form>
            )}
            <p className="hint">
              {target ? (
                <>
                  Restoring into <code className="folder-path">{target.desktop.folder}</code>
                </>
              ) : (
                'Next, choose the folder to keep the journal in: an empty folder, or an existing journal to add the backup to (where both have an entry, the newer one is kept).'
              )}
            </p>
            <button type="button" className="btn btn-primary" disabled={busy || (backup.encrypted && !passcode)} onClick={() => void restore()}>
              {busy ? 'Restoring…' : target ? 'Restore' : 'Choose a folder and restore…'}
            </button>
            {!target && (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setBackup(null)}>
                Back
              </button>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: '2.6rem' }} aria-hidden="true">
              📁
            </div>
            <h1>Where should your journal live?</h1>
            <p>Logbook keeps your journal as ordinary files in a folder you choose. Put the folder inside OneDrive, Dropbox or iCloud Drive to have your journal on your other computers too.</p>
            <p className="hint">Choose an empty folder to start a new journal, or a folder that already holds one. If the folder has other files in it, Logbook makes a “Logbook” folder inside.</p>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void startNew()}>
              {busy ? 'Choosing…' : 'Choose a folder…'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => backupInput.current?.click()}>
              Start from a backup (.zip)…
            </button>
            <p className="hint">A backup from the Logbook website or another computer brings everything with it: entries, photos, recordings and files.</p>
          </>
        )}
        <input
          ref={backupInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="welcome-backup-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void pickBackup(file);
          }}
        />
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
  const choice = useBusy();
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
          <button
            type="button"
            className="btn"
            disabled={choice.busy}
            onClick={() =>
              void choice.run(async () => {
                const f = await chooseJournalFolder();
                if (f) onChosen(f);
              })
            }
          >
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
