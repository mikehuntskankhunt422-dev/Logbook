import { useCallback, useEffect, useRef, useState } from 'react';
import { entryPlainText, entryWordCount, newId, referencedMediaIds, type Entry } from '@logbook/core';
import type { EntryConflict } from '@logbook/storage-fs';
import { useJournal } from '../app/journal-context.tsx';
import { useToast } from '../app/toasts.tsx';
import { formatLongDate } from '../components/common.tsx';
import { useDesktop } from './context.ts';
import { dailyCheckDue, describe, updatesEnabled, useUpdater } from './updates.ts';

/**
 * Keeps the desktop app in step with its folder (D83) and asks about what needs a person: entries
 * changed on two computers (D82), and a passcode changed on another computer.
 */
export function DesktopBar() {
  const desktop = useDesktop();
  const { journal } = useJournal();
  const [conflicts, setConflicts] = useState<EntryConflict[]>(() => desktop?.store.conflicts() ?? []);
  const [vaultChanged, setVaultChanged] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const toast = useToast();
  const noticeShown = useRef(false);

  useEffect(() => {
    if (!desktop?.notice || noticeShown.current) return;
    noticeShown.current = true;
    toast(desktop.notice, undefined, 8000);
  }, [desktop?.notice, toast]);

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const changes = await desktop.store.refresh();
      if (changes.entries || changes.media) journal.notifyExternalChange();
      if (changes.vault) setVaultChanged(true);
      setConflicts(desktop.store.conflicts());
    } catch (err) {
      console.warn('Logbook: reading the journal folder again failed', err);
    }
  }, [desktop, journal]);

  useEffect(() => {
    if (!desktop) return;
    let stop: (() => void) | undefined;
    let alive = true;
    void refresh();
    desktop
      .watch(() => void refresh())
      .then((unwatch) => (alive ? (stop = unwatch) : unwatch()))
      .catch((err: unknown) => console.warn('Logbook: watching the journal folder failed; changes are read when the window comes back into focus', err));
    const onFocus = () => void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      stop?.();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [desktop, refresh]);

  // The journal in memory still uses the old key: writing with it could leave entries nobody can
  // open. Reopen at once rather than wait for a click.
  useEffect(() => {
    if (!vaultChanged) return;
    const t = setTimeout(() => location.reload(), 2500);
    return () => clearTimeout(t);
  }, [vaultChanged]);

  const updater = useUpdater();
  const { find } = updater;
  useEffect(() => {
    void updatesEnabled().then((on) => on && dailyCheckDue() && void find(), () => undefined);
  }, [find]);

  if (!desktop) return null;
  if (vaultChanged) {
    return (
      <div className="banner banner-urgent" role="alert">
        <span>🔒 This journal's passcode was changed on another computer. Logbook is reopening it…</span>
      </div>
    );
  }
  const u = updater.state;
  return (
    <>
      {(u.kind === 'available' || u.kind === 'installing' || (u.kind === 'error' && u.during === 'install')) && (
        <div className="banner" role="region" aria-label="Update">
          <span className={u.kind === 'error' ? 'error' : undefined} role={u.kind === 'error' ? 'alert' : undefined}>
            ⬆️ {describe(u)}
          </span>
          {u.kind === 'error' && (
            <button type="button" className="btn btn-small btn-ghost" onClick={updater.dismiss}>
              Dismiss
            </button>
          )}
          {u.kind === 'available' && (
            <span className="row">
              <button type="button" className="btn btn-small btn-primary" onClick={() => void updater.install(u.update)}>
                Install and restart
              </button>
              <button type="button" className="btn btn-small btn-ghost" onClick={updater.dismiss}>
                Later
              </button>
            </span>
          )}
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="banner" role="region" aria-label="Sync conflicts">
          <span>
            🔀 {conflicts.length === 1 ? 'An entry was' : `${conflicts.length} entries were`} changed on two computers at once. Choose which version to keep; nothing is deleted until you do.
          </span>
          <button type="button" className="btn btn-small btn-primary" onClick={() => setReviewing(true)}>
            Review
          </button>
        </div>
      )}
      {reviewing && conflicts.length > 0 && (
        <ConflictDialog
          conflicts={conflicts}
          onClose={() => setReviewing(false)}
          onChanged={() => {
            journal.notifyExternalChange();
            setConflicts(desktop.store.conflicts());
          }}
        />
      )}
    </>
  );
}

interface Shown {
  path: string;
  entry: Entry | null;
}

function ConflictDialog({ conflicts, onClose, onChanged }: { conflicts: EntryConflict[]; onClose: () => void; onChanged: () => void }) {
  const desktop = useDesktop()!;
  const { journal } = useJournal();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const conflict = conflicts[0]!;
  const [shown, setShown] = useState<Shown[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all(conflict.versions.map(async (v) => ({ path: v.path, entry: await journal.readEntryRecord(v.record).catch(() => null) }))).then((s) => alive && setShown(s));
    return () => {
      alive = false;
    };
  }, [conflict, journal]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      const left = desktop.store.conflicts().length;
      onChanged();
      if (left === 0) {
        toast('Done: every entry has one version again.');
        onClose();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const keep = (path: string) => act(() => desktop.store.keepVersion(conflict.id, path));
  const keepBoth = () =>
    act(async () => {
      // The first version stays this entry; each other one becomes an entry of its own.
      for (const s of shown.slice(1)) {
        if (!s.entry) continue;
        await journal.saveEntry({ ...s.entry, id: newId(), rev: 0, title: `${s.entry.title || 'Untitled'} (other version)` });
        await desktop.store.discardVersion(s.path);
      }
    });
  const readable = shown.filter((s) => s.entry).length;

  return (
    <dialog ref={ref} className="conflict-dialog" onClose={onClose} aria-labelledby="conflict-title">
      <h2 id="conflict-title">Which version should Logbook keep?</h2>
      <p className="hint">
        {conflicts.length > 1 ? `Entry 1 of ${conflicts.length}. ` : ''}The journal folder has {conflict.versions.length} versions of this entry, usually because it was edited on two computers before they synced.
      </p>
      <div className="conflict-versions">
        {shown.map((s, i) => (
          <section key={s.path} className="conflict-version" aria-label={`Version ${i + 1}`}>
            <h3>
              Version {i + 1}
              {i === 0 && <span className="muted"> · showing now</span>}
            </h3>
            {s.entry ? <VersionSummary entry={s.entry} /> : <p className="error">This version can't be read with this journal's passcode.</p>}
            <p className="hint conflict-file">{s.path.slice(s.path.lastIndexOf('/') + 1)}</p>
            {s.entry ? (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void keep(s.path)}>
                Keep this version
              </button>
            ) : (
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void act(() => desktop.store.discardVersion(s.path))}>
                Delete this version
              </button>
            )}
          </section>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => ref.current?.close()}>
          Decide later
        </button>
        <button type="button" className="btn" disabled={busy || readable < 2 || !shown[0]?.entry} onClick={() => void keepBoth()}>
          Keep both as separate entries
        </button>
      </div>
    </dialog>
  );
}

function VersionSummary({ entry }: { entry: Entry }) {
  const text = entryPlainText(entry).trim();
  const words = entryWordCount(entry);
  const media = referencedMediaIds(entry).length;
  return (
    <>
      <p className="conflict-title">
        <strong>{entry.title || 'Untitled'}</strong>
      </p>
      <p className="muted">
        {formatLongDate(entry.date, { day: 'numeric', month: 'short', year: 'numeric' })} · changed {new Date(entry.updatedAt).toLocaleString()}
      </p>
      <p className="muted">
        {words} {words === 1 ? 'word' : 'words'}
        {media > 0 ? ` · ${media} ${media === 1 ? 'photo or file' : 'photos or files'}` : ''}
      </p>
      <p className="conflict-text">{text ? (text.length > 280 ? `${text.slice(0, 280)}…` : text) : <span className="muted">No text</span>}</p>
    </>
  );
}
