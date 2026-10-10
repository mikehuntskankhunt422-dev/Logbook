import { useEffect, useState } from 'react';
import { defaultJournalFolder, openJournalFolder, pickFolder } from './bridge.ts';

/**
 * First run of the desktop app (and after the remembered folder went missing): where the journal
 * lives. Picking a folder that already holds a journal opens it, so this is also how a second
 * computer joins a journal kept in OneDrive or Dropbox, or how an unzipped backup is opened.
 */
export function FolderSetup({
  onReady,
  missing,
  error: openError,
  folder,
}: {
  onReady: (folder: string) => void;
  missing?: string | null;
  /** Opening a folder failed: why, and which folder (D86). */
  error?: string;
  folder?: string | null;
}) {
  const [suggested, setSuggested] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void defaultJournalFolder().then(setSuggested, () => setSuggested(null));
  }, []);

  const use = async (path: string | null) => {
    if (!path) return;
    setBusy(true);
    setError('');
    try {
      onReady(await openJournalFolder(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="lock-screen">
      <div className="lock-card folder-setup">
        <div style={{ fontSize: '2.6rem' }} aria-hidden="true">
          📓
        </div>
        <h1>Where should Logbook keep your journal?</h1>
        {missing && <p className="error">Logbook can't find your journal at {missing}. If it's on a drive that isn't connected, connect it and restart Logbook, or choose the folder again.</p>}
        {openError && (
          <p className="error" role="alert">
            Logbook couldn't open {folder ? <span className="folder-path">{folder}</span> : 'that folder'}: {openError}
          </p>
        )}
        <p className="muted">
          Your journal is saved as ordinary files in a folder on this computer. Nothing is uploaded. To keep a copy in the cloud, put the folder inside OneDrive, Dropbox or iCloud Drive.
        </p>
        <div className="folder-setup-actions">
          {suggested && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void use(suggested)}>
              Use {suggested}
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => void pickFolder().then(use)}>
            Choose a folder…
          </button>
        </div>
        <p className="hint">Already have a Logbook folder, from another computer or an unzipped backup? Choose it and Logbook opens it.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
