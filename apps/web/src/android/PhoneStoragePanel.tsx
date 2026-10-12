import type { ReactNode } from 'react';

/** Settings on the Android app: where the journal is, in place of the desktop's folder panel (D90). */
export function PhoneStoragePanel({ children }: { children?: ReactNode }) {
  return (
    <section className="panel" aria-labelledby="folder-h">
      <h2 id="folder-h">Storage on this phone</h2>
      <p>Your entries, photos and videos are kept inside Logbook on this phone, where other apps can't read them. Nothing is uploaded, not even to your Google backup.</p>
      {children}
      <p className="hint">
        Uninstalling Logbook deletes your journal, and so does clearing Logbook's storage in Android's settings: keep backups. To move your journal to another phone or a computer, save a backup and restore it
        there. (On Android 12 and later, a direct phone-to-phone transfer when you set up a new phone brings it along too; a restore from Google's backup doesn't.)
      </p>
    </section>
  );
}
