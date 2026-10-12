import { formatBytes } from '@logbook/core';
import { checkForUpdate, installUpdate, useUpdateState } from './updates.ts';

/** Settings on the desktop app: this version, and the next one when there is one (D88). */
export function UpdatesPanel() {
  const update = useUpdateState();
  const busy = update.phase === 'checking' || update.phase === 'installing';

  let status: string;
  switch (update.phase) {
    case 'idle':
      status = 'Logbook looks for a new version when it starts and twice a day, and asks before installing it.';
      break;
    case 'checking':
      status = 'Looking for a new version…';
      break;
    case 'current':
      status = 'This is the newest version.';
      break;
    case 'available':
      status = `Logbook ${update.version} is ready to install. Logbook saves your writing, updates and opens again.`;
      break;
    case 'installing':
      status = update.waiting
        ? `Logbook ${update.version} is downloaded. It installs as soon as Logbook has finished what it's doing (adding files, restoring a backup).`
        : update.total && update.received < update.total
          ? `Downloading Logbook ${update.version}: ${formatBytes(update.received)} of ${formatBytes(update.total)}…`
          : `Installing Logbook ${update.version}…`;
      break;
    case 'failed':
      status = update.version ? `Logbook ${update.version} couldn't be installed: ${update.error}` : `Couldn't look for a new version: ${update.error}`;
      break;
  }

  const canInstall = update.phase === 'available' || (update.phase === 'failed' && update.version);

  return (
    <section className="panel" aria-labelledby="updates-h">
      <h2 id="updates-h">Updates</h2>
      <p>
        You have Logbook {import.meta.env.VITE_APP_VERSION}. <span role="status">{status}</span>
      </p>
      <div className="row">
        {canInstall ? (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void installUpdate()}>
            {update.phase === 'failed' ? 'Try again' : 'Update and restart'}
          </button>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => void checkForUpdate().catch(() => {})}>
            Check for updates
          </button>
        )}
      </div>
      <p className="hint">Updates come from Logbook's releases on GitHub and install only if they carry Logbook's signature. Your journal folder isn't touched.</p>
    </section>
  );
}

/**
 * The update offer on the screens shown before a journal is open (choosing a folder, a folder
 * that won't open, which may say "Update the app first"), where there's no Settings and no toast.
 */
export function UpdateOffer() {
  const update = useUpdateState();
  if (update.phase === 'installing') {
    return (
      <p className="hint" role="status">
        Updating to Logbook {update.version}…
      </p>
    );
  }
  const version = update.phase === 'available' || update.phase === 'failed' ? update.version : null;
  if (!version) return null;
  return (
    <p className="hint" role="status">
      Logbook {version} is available.{' '}
      <button type="button" className="btn btn-small" onClick={() => void installUpdate()}>
        {update.phase === 'failed' ? 'Try the update again' : 'Update and restart'}
      </button>
      {update.phase === 'failed' && <span className="error"> {update.error}</span>}
    </p>
  );
}
