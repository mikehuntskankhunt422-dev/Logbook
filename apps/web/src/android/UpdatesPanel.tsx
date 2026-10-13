import { checkForUpdate, downloadUpdate, isPreview, useUpdateState } from './updates.ts';

/** Settings on the Android app: this version, and the next one when there is one (D90). */
export function UpdatesPanel() {
  const update = useUpdateState();
  const version = import.meta.env.VITE_APP_VERSION;

  if (isPreview) {
    return (
      <section className="panel" aria-labelledby="updates-h">
        <h2 id="updates-h">Updates</h2>
        <p>
          This is a test build of Logbook {version}, made from work in progress. It's a separate app from Logbook, with a journal of its own, and it doesn't look for updates. Each test build has a
          signature of its own, so the next one installs only after this one is uninstalled, which deletes its journal: save a backup first and restore it there.
        </p>
      </section>
    );
  }

  let status: string;
  switch (update.phase) {
    case 'idle':
      status = 'Logbook looks for a new version when it starts and twice a day.';
      break;
    case 'checking':
      status = 'Looking for a new version…';
      break;
    case 'current':
      status = 'This is the newest version.';
      break;
    case 'available':
      status = `Logbook ${update.version} is available. Download it, then open the downloaded file and tap Update.`;
      break;
    case 'failed':
      status = `Couldn't look for a new version: ${update.error}`;
      break;
  }

  return (
    <section className="panel" aria-labelledby="updates-h">
      <h2 id="updates-h">Updates</h2>
      <p>
        You have Logbook {version}. <span role="status">{status}</span>
      </p>
      <div className="row">
        {update.phase === 'available' ? (
          <button type="button" className="btn btn-primary" onClick={() => void downloadUpdate()}>
            ⬇️ Download Logbook {update.version}
          </button>
        ) : (
          <button type="button" className="btn" disabled={update.phase === 'checking'} onClick={() => void checkForUpdate().catch(() => {})}>
            Check for updates
          </button>
        )}
      </div>
      <p className="hint">
        New versions come from Logbook's releases on GitHub. Android installs one over this one only if it carries Logbook's signature, and your journal stays as it is. Saving a backup first does no harm.
      </p>
    </section>
  );
}
