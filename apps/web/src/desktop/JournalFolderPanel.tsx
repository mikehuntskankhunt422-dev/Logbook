import { useEffect, useState, type ReactNode } from 'react';
import { useToast } from '../app/toasts.tsx';
import { journalFolder, openJournalFolder, pickFolder, revealJournalFolder } from './bridge.ts';

const FILE_MANAGER = navigator.userAgent.includes('Mac') ? 'Finder' : navigator.userAgent.includes('Windows') ? 'Explorer' : 'the file manager';

/** Settings on the desktop app: where the journal is, in place of the browser's storage panel. */
export function JournalFolderPanel({ children }: { children?: ReactNode }) {
  const toast = useToast();
  const [folder, setFolder] = useState<string | null>(null);

  useEffect(() => {
    void journalFolder().then((s) => setFolder(s.folder));
  }, []);

  const openAnother = async () => {
    const picked = await pickFolder();
    if (!picked) return;
    try {
      await openJournalFolder(picked);
      // Everything on screen came from the old folder: start again from the new one.
      location.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="panel" aria-labelledby="folder-h">
      <h2 id="folder-h">Journal folder</h2>
      <p>
        Your entries, photos and videos are files in <span className="folder-path">{folder ?? '…'}</span>. Each entry is a file you can open; the folder can sit in OneDrive, Dropbox or iCloud Drive to
        keep a copy in the cloud.
      </p>
      <div className="row">
        <button type="button" className="btn" onClick={() => void revealJournalFolder()}>
          📂 Show in {FILE_MANAGER}
        </button>
        <button type="button" className="btn" onClick={() => void openAnother()}>
          Open a different journal folder…
        </button>
      </div>
      <p className="hint">
        To move your journal, quit Logbook, move the folder, then open Logbook and choose it in its new place. Opening a different folder doesn't copy anything; your current journal stays where it is.
      </p>
      {children}
    </section>
  );
}
