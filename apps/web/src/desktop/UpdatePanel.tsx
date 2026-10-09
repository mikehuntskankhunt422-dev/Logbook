import { useEffect, useState } from 'react';
import { appVersion, describe, updatesEnabled, useUpdater } from './updates.ts';

/** Settings on the desktop: the version, and checking for and installing updates (M5 §2.6). */
export function UpdatePanel() {
  const [version, setVersion] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const { state, find, install } = useUpdater();
  useEffect(() => {
    void appVersion().then(setVersion);
    void updatesEnabled().then(setEnabled, () => setEnabled(false));
  }, []);
  const busy = state.kind === 'checking' || state.kind === 'installing';
  return (
    <section className="panel" aria-labelledby="updates-h">
      <h2 id="updates-h">Updates</h2>
      <p>You have Logbook {version || '…'}.</p>
      {enabled === false ? (
        <p className="hint">This copy of Logbook was built without an update key, so it doesn't update itself. Install new versions from the releases page.</p>
      ) : (
        <>
          <div className="row">
            <button type="button" className="btn" disabled={busy || !enabled} onClick={() => void find()}>
              Check for updates
            </button>
            {state.kind === 'available' && (
              <button type="button" className="btn btn-primary" onClick={() => void install(state.update)}>
                Install and restart
              </button>
            )}
          </div>
          <p className={state.kind === 'error' ? 'error' : 'hint'} role="status" aria-live="polite">
            {describe(state)}
          </p>
          <p className="hint">Logbook also looks for updates when it starts, at most once a day, and never installs one without asking.</p>
        </>
      )}
    </section>
  );
}
