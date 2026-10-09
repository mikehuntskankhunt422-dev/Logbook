import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BackupError, MIN_PASSCODE_LENGTH, PasscodeRequiredError, WrongPasscodeError, formatBytes, importBackup, inspectBackup, type Entry } from '@logbook/core';
import { requestPersistentStorage, storageEstimate } from '@logbook/storage-idb';
import { clearMediaUrlCache, useJournal } from '../app/journal-context.tsx';
import { useToast } from '../app/toasts.tsx';
import { backupToFolder, downloadBackup, forgetFolder, rememberedFolderName, supportsFolderBackup } from '../lib/backup-io.ts';
import { celebrate } from '../lib/motion.ts';
import { Dialog, formatLongDate } from './common.tsx';
import { IS_DESKTOP } from '../platform.ts';

/** On the desktop the journal is a folder, which takes the place of the browser-storage panel (M5). */
const FolderPanel = import.meta.env.VITE_PLATFORM === 'desktop' ? lazy(() => import('../desktop/FolderPanel.tsx').then((m) => ({ default: m.FolderPanel }))) : null;
const UpdatePanel = import.meta.env.VITE_PLATFORM === 'desktop' ? lazy(() => import('../desktop/UpdatePanel.tsx').then((m) => ({ default: m.UpdatePanel }))) : null;

export function SettingsView() {
  return (
    <>
      <h1>Settings</h1>
      <AppearancePanel />
      <BackupPanel />
      <PasscodePanel />
      {FolderPanel ? (
        <Suspense fallback={null}>
          <FolderPanel />
        </Suspense>
      ) : (
        <StoragePanel />
      )}
      {UpdatePanel && (
        <Suspense fallback={null}>
          <UpdatePanel />
        </Suspense>
      )}
      <TrashPanel />
      <DangerPanel />
    </>
  );
}

function AppearancePanel() {
  const { journal, settings } = useJournal();
  return (
    <section className="panel" aria-labelledby="appearance-h">
      <h2 id="appearance-h">Appearance</h2>
      <div className="segmented" role="group" aria-label="Theme">
        {(['system', 'light', 'dark'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={settings.theme === t} onClick={() => void journal.updateSettings({ theme: t })}>
            {t === 'system' ? 'Match device' : t === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
      <p className="hint">Animations follow your device's reduce-motion setting.</p>
    </section>
  );
}

function BackupPanel() {
  const { journal, settings } = useJournal();
  const toast = useToast();
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keepEncrypted, setKeepEncrypted] = useState(true);
  const [pending, setPending] = useState<{ file: File; encrypted: boolean } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [passcode, setPasscode] = useState('');
  const [importError, setImportError] = useState('');
  // In the page rather than made on demand, so desktop end-to-end tests can hand it a file.
  const restoreInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void rememberedFolderName().then(setFolder);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast(`Backup failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const encrypted = journal.isEncrypted && keepEncrypted;

  const startImport = async (file: File) => {
    try {
      const { encrypted } = await inspectBackup(file);
      setImportError('');
      setPasscode('');
      setPending({ file, encrypted });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const doImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await importBackup(journal, pending.file, { mode, passcode: pending.encrypted ? passcode : undefined });
      clearMediaUrlCache();
      setPending(null);
      toast(`Imported ${r.entriesAdded} new and ${r.entriesUpdated} updated entries, ${r.mediaAdded} media files.${r.problems.length ? ` ${r.problems.length} problems: see console.` : ''}`, undefined, 8000);
      if (r.problems.length) console.warn('Backup import problems', r.problems);
    } catch (err) {
      setImportError(err instanceof WrongPasscodeError ? 'That passcode is not right for this backup.' : err instanceof PasscodeRequiredError || err instanceof BackupError ? err.message : `Import failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="backup-h">
      <h2 id="backup-h">Backups</h2>
      <p>
        {IS_DESKTOP
          ? 'A backup zip holds the whole journal in one file, to keep somewhere other than the journal folder. The website can restore it too.'
          : 'Your journal lives only on this device. Back it up regularly. The zip holds everything, and the Logbook desktop app can open it too.'}
        {settings.lastBackupAt ? ` Last backup: ${new Date(settings.lastBackupAt).toLocaleString()}.` : ' You have not made a backup yet.'}
      </p>
      {journal.isEncrypted && (
        <label className="row" style={{ marginBottom: 10 }}>
          <input type="checkbox" checked={keepEncrypted} onChange={(e) => setKeepEncrypted(e.target.checked)} /> Keep the backup encrypted (needs your passcode to restore)
        </label>
      )}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (!(await downloadBackup(journal, encrypted))) return;
              celebrate('backup');
              toast(IS_DESKTOP ? 'Backup saved.' : 'Backup downloaded.');
            })
          }
        >
          ⬇️ {IS_DESKTOP ? 'Save a backup (.zip)…' : 'Download backup (.zip)'}
        </button>
        {supportsFolderBackup() && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const where = await backupToFolder(journal, encrypted);
                setFolder(await rememberedFolderName());
                celebrate('backup');
                toast(`Saved ${where}`);
              })
            }
          >
            📁 {folder ? `Back up to “${folder}”` : 'Back up to a folder…'}
          </button>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => restoreInput.current?.click()}>
          ⬆️ Restore from backup…
        </button>
        <input
          ref={restoreInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="restore-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void startImport(file);
          }}
        />
      </div>
      {folder && (
        <p className="hint">
          Backups go to the folder “{folder}”. A folder synced by OneDrive or Dropbox gives you an off-device copy.{' '}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void run(async () => (await backupToFolder(journal, encrypted, true), setFolder(await rememberedFolderName())))}>
            Choose a different folder
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void forgetFolder().then(() => setFolder(null))}>
            Forget folder
          </button>
        </p>
      )}
      <div className="field" style={{ maxWidth: 320, marginTop: 12 }}>
        <label htmlFor="remind">Remind me to back up every</label>
        <select id="remind" value={settings.backupReminderDays} onChange={(e) => void journal.updateSettings({ backupReminderDays: Number(e.target.value) })}>
          {[7, 14, 30, 60].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </div>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Restore from backup"
        actions={
          <>
            <button type="button" className="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || (pending?.encrypted && !passcode)} onClick={() => void doImport()}>
              {busy ? 'Restoring…' : 'Restore'}
            </button>
          </>
        }
      >
        <p>{pending?.file.name}</p>
        <div className="segmented" role="group" aria-label="Restore mode" style={{ marginBottom: 10 }}>
          <button type="button" aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>
            Merge
          </button>
          <button type="button" aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>
            Replace everything
          </button>
        </div>
        <p className="hint">
          {mode === 'merge'
            ? 'Adds entries from the backup. Where both copies exist, the newer one wins. Nothing is deleted.'
            : 'Deletes every entry and photo on this device first, then restores the backup. Your passcode setting stays as it is.'}
        </p>
        {pending?.encrypted && (
          <div className="field">
            <label htmlFor="restore-pass">Passcode used for this backup</label>
            <input id="restore-pass" type="password" autoComplete="current-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
          </div>
        )}
        {importError && (
          <p className="error" role="alert">
            {importError}
          </p>
        )}
      </Dialog>
    </section>
  );
}

function PasscodePanel() {
  const { journal, settings } = useJournal();
  const toast = useToast();
  const [mode, setMode] = useState<null | 'enable' | 'change' | 'disable'>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setMode(null);
    setCurrent('');
    setNext('');
    setConfirm('');
    setUnderstood(false);
    setError('');
  };

  const submit = async () => {
    setError('');
    if (mode !== 'disable' && next !== confirm) return setError('The two new passcodes don’t match.');
    if (mode !== 'disable' && next.length < MIN_PASSCODE_LENGTH) return setError(`Use at least ${MIN_PASSCODE_LENGTH} characters.`);
    setBusy(true);
    try {
      if (mode === 'enable') await journal.enableEncryption(next);
      if (mode === 'change') await journal.changePasscode(current, next);
      if (mode === 'disable') await journal.disableEncryption(current);
      toast(mode === 'enable' ? 'Passcode set. Your journal is encrypted on this device.' : mode === 'change' ? 'Passcode changed.' : 'Passcode removed. Your journal is no longer encrypted.');
      reset();
    } catch (err) {
      setError(err instanceof WrongPasscodeError ? 'Your current passcode is not right.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="pass-h">
      <h2 id="pass-h">Passcode lock</h2>
      {journal.isEncrypted ? (
        <>
          <p>🔒 Your journal is encrypted on this device with AES-256-GCM. The key comes from your passcode via Argon2id.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => journal.lock()}>
              Lock now
            </button>
            <button type="button" className="btn" onClick={() => setMode('change')}>
              Change passcode
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setMode('disable')}>
              Remove passcode
            </button>
          </div>
          <div className="field" style={{ maxWidth: 320, marginTop: 12 }}>
            <label htmlFor="autolock">Lock automatically after</label>
            <select id="autolock" value={settings.autoLockMinutes} onChange={(e) => void journal.updateSettings({ autoLockMinutes: Number(e.target.value) })}>
              <option value={0}>Never</option>
              {[1, 5, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} {m === 1 ? 'minute' : 'minutes'} idle
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <>
          <p>
            {IS_DESKTOP
              ? 'Encrypt your journal so nobody can read it without your passcode, not even someone who can open the journal folder. Entry and photo files then become unreadable on their own.'
              : "Encrypt your journal on this device so nobody can read it without your passcode, not even someone with access to your browser's files."}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setMode('enable')}>
            Set a passcode
          </button>
        </>
      )}

      <Dialog
        open={mode !== null}
        onClose={reset}
        title={mode === 'enable' ? 'Set a passcode' : mode === 'change' ? 'Change passcode' : 'Remove passcode'}
        actions={
          <>
            <button type="button" className="btn" onClick={reset}>
              Cancel
            </button>
            <button type="button" className={`btn ${mode === 'disable' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (mode === 'enable' && !understood)} onClick={() => void submit()}>
              {busy ? 'Working…' : mode === 'disable' ? 'Remove passcode' : 'Save passcode'}
            </button>
          </>
        }
      >
        {mode === 'enable' && (
          <div className="notice notice-warn">
            <strong>A forgotten passcode cannot be recovered.</strong> Nobody can reset it, including us, because the key exists only in your head. Without it, your entries and photos are
            unreadable forever. Keep a backup somewhere safe.
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {mode !== 'enable' && (
            <div className="field">
              <label htmlFor="pc-current">Current passcode</label>
              <input id="pc-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
          )}
          {mode !== 'disable' && (
            <>
              <div className="field">
                <label htmlFor="pc-new">New passcode</label>
                <input id="pc-new" type="password" autoComplete="new-password" minLength={MIN_PASSCODE_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="pc-hint" />
                <span id="pc-hint" className="hint">
                  At least {MIN_PASSCODE_LENGTH} characters. A short phrase is easier to remember and harder to guess.
                </span>
              </div>
              <div className="field">
                <label htmlFor="pc-confirm">Type it again</label>
                <input id="pc-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </>
          )}
          {mode === 'enable' && (
            <label className="row">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand a forgotten passcode means my journal is lost.
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" hidden />
        </form>
      </Dialog>
    </section>
  );
}

function StoragePanel() {
  const { journal, settings } = useJournal();
  const [est, setEst] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  const refresh = () => void storageEstimate().then(setEst);
  useEffect(refresh, []);
  return (
    <section className="panel" aria-labelledby="storage-h">
      <h2 id="storage-h">Storage on this device</h2>
      {est ? (
        <>
          <p>
            Using {formatBytes(est.usage)} of about {formatBytes(est.quota)} available to this site.
          </p>
          <div className="meter" role="img" aria-label={`${Math.round((est.usage / Math.max(1, est.quota)) * 100)} percent used`}>
            <span style={{ width: `${Math.min(100, (est.usage / Math.max(1, est.quota)) * 100)}%` }} />
          </div>
          <p>
            {est.persisted ? (
              '✅ Protected: your browser has agreed not to clear this data to free space.'
            ) : (
              <>
                ⚠️ Not protected yet. The browser may clear site data when space runs low.{' '}
                <button type="button" className="btn btn-small" onClick={() => void requestPersistentStorage().then(refresh)}>
                  Ask for protection
                </button>
              </>
            )}
          </p>
        </>
      ) : (
        <p className="muted">This browser doesn't report storage use.</p>
      )}
      <label className="row">
        <input type="checkbox" checked={settings.compressLargeMedia} onChange={(e) => void journal.updateSettings({ compressLargeMedia: e.target.checked })} /> Shrink very large photos when adding them (still
        sharp enough to print)
      </label>
      <p className="hint">Clearing your browser's site data deletes your journal. Keep backups.</p>
    </section>
  );
}

function TrashPanel() {
  const { journal, entries } = useJournal();
  const [trash, setTrash] = useState<Entry[]>([]);
  useEffect(() => {
    if (!journal.isLocked) void journal.listTrash().then(setTrash);
  }, [journal, entries]);
  if (!trash.length) return null;
  return (
    <section className="panel" aria-labelledby="trash-h">
      <h2 id="trash-h">Recently deleted</h2>
      <p className="hint">Deleted entries stay here for 30 days.</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {trash.map((e) => (
          <li key={e.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              <strong>{e.title || 'Untitled'}</strong> <span className="muted">· {formatLongDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </span>
            <span className="row">
              <button type="button" className="btn btn-small" onClick={() => void journal.restoreEntry(e.id)}>
                Restore
              </button>
              <button type="button" className="btn btn-small btn-danger" onClick={() => void journal.purgeEntry(e.id)}>
                Delete forever
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DangerPanel() {
  const { journal } = useJournal();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <section className="panel" aria-labelledby="danger-h">
      <h2 id="danger-h">Delete everything</h2>
      <p>Permanently removes every entry and file from this device. Back up first.</p>
      {journal.issues.length > 0 && (
        <p className="notice notice-warn">
          {journal.issues.length} {journal.issues.length === 1 ? 'entry' : 'entries'} could not be read and {journal.issues.length === 1 ? 'is' : 'are'} hidden. A backup still includes{' '}
          {journal.issues.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        Delete all entries…
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete everything?"
        actions={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={typed !== 'DELETE'}
              onClick={() =>
                void journal.clearContent().then(() => {
                  clearMediaUrlCache();
                  setOpen(false);
                  setTyped('');
                  toast('Everything was deleted from this device.');
                })
              }
            >
              Delete everything
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="type-delete">Type DELETE to confirm</label>
          <input id="type-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      </Dialog>
    </section>
  );
}
