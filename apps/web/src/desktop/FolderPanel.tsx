import { useState } from 'react';
import { useDesktop } from './context.ts';
import { chooseJournalFolder } from './tauri-fs.ts';

/** Settings on the desktop: where the journal lives, and moving to another folder (M5 §2.2). */
export function FolderPanel() {
  const desktop = useDesktop();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!desktop) return null;

  const choose = async () => {
    setBusy(true);
    setError('');
    try {
      // The app restarts its view on the new folder; nothing is copied or moved.
      if (await chooseJournalFolder()) location.reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const problems = desktop.store.problems;
  return (
    <section className="panel" aria-labelledby="folder-h">
      <h2 id="folder-h">Journal folder</h2>
      <p>
        Your journal is kept as files in <code className="folder-path">{desktop.folder}</code>
      </p>
      <p className="hint">
        Each entry is a file you can open in any text editor, and photos and recordings keep their original type in the “media” folder. To have the journal on another computer too, keep this folder in OneDrive, Dropbox or iCloud Drive and choose it in
        Logbook there.
      </p>
      {problems.length > 0 && (
        <div className="notice notice-warn">
          <strong>
            {problems.length} {problems.length === 1 ? 'file' : 'files'} in the folder couldn't be read
          </strong>{' '}
          and {problems.length === 1 ? 'is' : 'are'} left as {problems.length === 1 ? 'it is' : 'they are'}:
          <ul>
            {problems.slice(0, 10).map((p) => (
              <li key={p}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" className="btn" disabled={busy} onClick={() => void choose()}>
        Use a different folder…
      </button>
      <p className="hint">Choosing another folder opens the journal in it, or starts a new one there. This journal stays where it is.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
