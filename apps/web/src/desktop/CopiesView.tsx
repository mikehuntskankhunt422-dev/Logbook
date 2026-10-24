import { useCallback, useEffect, useRef, useState } from 'react';
import { entryPlainText, entryWordCount, type CopyChoice, type Entry, type EntryCopy } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { href } from '../app/router.ts';
import { useToast } from '../app/toasts.tsx';
import { Dialog, formatLongDate } from '../components/common.tsx';
import { revealJournalFolder } from './bridge.ts';
import { useFilesToSortOut } from './sync.ts';

/**
 * Copies to sort out (D102): when two computers change the same entry before their sync service
 * has caught up, it keeps both, the second as a copy beside the first ("… (conflicted copy).json"
 * from Dropbox, "…-LAPTOP.json" from OneDrive), and Logbook keeps the version someone was writing
 * when another computer saved first. Here a person compares them and decides; whatever isn't kept
 * goes to Recently deleted.
 */

/** Above every page while the journal folder has files to sort out. */
export function CopiesBanner() {
  const n = useFilesToSortOut();
  if (!n) return null;
  return (
    <div className="banner" role="region" aria-label="Files to sort out">
      <span>
        🔀 {n === 1 ? 'A file in your journal folder needs a look' : `${n} files in your journal folder need a look`}: a copy a sync service made when two computers changed the same thing, or a file Logbook can't read.
      </span>
      <a className="btn btn-small btn-primary" href={href({ name: 'copies' })}>
        Sort them out
      </a>
    </div>
  );
}

const CHOICES: { choice: CopyChoice; label: string; done: string }[] = [
  { choice: 'ours', label: 'Keep the one in your journal', done: 'Kept the one in your journal. The copy is in Recently deleted.' },
  { choice: 'theirs', label: 'Use the copy', done: 'The entry is now the copy. The version it replaced is in Recently deleted.' },
  { choice: 'both', label: 'Keep both', done: 'Kept both: the copy is an entry of its own.' },
];

export function CopiesView() {
  const { journal, entries } = useJournal();
  const toast = useToast();
  const [copies, setCopies] = useState<EntryCopy[] | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Counted the same way as the banner, so this page shows what the banner promised.
  const waiting = useFilesToSortOut();
  const files = journal.store.conflicts?.() ?? [];
  const media = files.filter((f) => f.kind === 'media');
  const unreadable = journal.store.unreadableFiles?.() ?? [];

  const load = useCallback(() => {
    journal.entryCopies().then(setCopies, (err: unknown) => setProblem((err as Error).message));
  }, [journal]);
  useEffect(load, [load, entries, waiting]);

  const act = async (run: () => Promise<void>, done: string) => {
    setBusy(true);
    setProblem('');
    try {
      await run();
      toast(done);
      load();
      // The copy's section is gone: back to the top of the list.
      heading.current?.focus();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nothing = copies !== null && !copies.length && !media.length && !unreadable.length;
  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        Copies to sort out
      </h1>
      <p className="hint">
        When two computers change the same entry before their sync service has caught up, it keeps both: the second as a copy beside the first. Compare them here and choose. Whatever you don't keep goes to Recently deleted, where it stays for 30 days.
      </p>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {copies === null && <p className="muted">Reading the copies…</p>}
      {nothing && <p>Nothing to sort out. Every entry has one version.</p>}
      {copies?.map((c, i) => (
        <section key={c.path} className="panel copy-card" aria-labelledby={`copy-${i}`}>
          <h2 id={`copy-${i}`}>{titleOf(c.current ?? c.copy)}</h2>
          {c.copy ? (
            <>
              <div className="copy-compare">
                {c.current ? <Version label="In your journal" entry={c.current} /> : <p className="muted">This entry isn't in your journal any more.</p>}
                <Version label="The copy" entry={c.copy} />
              </div>
              <div className="row">
                {(c.current ? CHOICES : CHOICES.filter((x) => x.choice !== 'both')).map((x) => (
                  <button key={x.choice} type="button" className={x.choice === 'ours' ? 'btn btn-primary' : 'btn'} disabled={busy} onClick={() => void act(() => journal.settleCopy(c.path, x.choice), x.done)}>
                    {c.current ? x.label : x.choice === 'ours' ? 'Move it to Recently deleted' : 'Put it back in your journal'}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p>Logbook can't read this copy. It may still be syncing; if it stays like this, it may be damaged, or locked with a passcode this journal no longer uses.</p>
              <p className="muted copy-file">{c.path}</p>
              <div className="row">
                <button type="button" className="btn" onClick={() => void revealJournalFolder()}>
                  Show the journal folder
                </button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setDeleting(c.path)}>
                  Delete the copy…
                </button>
              </div>
            </>
          )}
        </section>
      ))}
      {media.length > 0 && (
        <section className="panel" aria-labelledby="copies-media">
          <h2 id="copies-media">Copies of photos and files</h2>
          <p>A sync service copied these photos or their details. Your entries use the originals, so a copy only takes up space.</p>
          <ul className="copy-files">
            {media.map((f) => (
              <li key={f.path}>
                <span className="copy-file">{f.path}</span>
                <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => setDeleting(f.path)}>
                  Delete…
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {unreadable.length > 0 && (
        <section className="panel" aria-labelledby="copies-unreadable">
          <h2 id="copies-unreadable">Files Logbook can't read</h2>
          <p>These may still be syncing. If they stay here, they may be damaged: restore them from a backup.</p>
          <ul className="copy-files">
            {unreadable.map((p) => (
              <li key={p}>
                <span className="copy-file">{p}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn" onClick={() => void revealJournalFolder()}>
            Show the journal folder
          </button>
        </section>
      )}
      <Dialog
        open={deleting !== null}
        title="Delete this copy?"
        onClose={() => setDeleting(null)}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                const path = deleting!;
                setDeleting(null);
                void act(() => journal.deleteCopy(path), 'Deleted the copy.');
              }}
            >
              Delete it
            </button>
          </>
        }
      >
        <p>It's deleted for good, from every computer that shares the journal folder.</p>
        <p className="muted copy-file">{deleting}</p>
      </Dialog>
    </>
  );
}

function titleOf(e: Entry | null | undefined): string {
  return e?.title || 'Untitled entry';
}

/** One version: when it was written and last saved, how long it is, and its words. */
function Version({ label, entry }: { label: string; entry: Entry }) {
  const text = entryPlainText(entry).trim();
  const saved = new Date(entry.updatedAt);
  return (
    <div className="copy-version">
      <h3>{label}</h3>
      <p className="muted">
        {entry.title || 'Untitled'} · {formatLongDate(entry.date)}
        <br />
        Last saved {saved.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {entryWordCount(entry).toLocaleString()} words
        {entry.deletedAt ? ' · in Recently deleted' : ''}
      </p>
      {/* Scrolls by itself, so it takes focus for keyboard scrolling; named for screen readers. */}
      <div className="copy-text" tabIndex={0} role="region" aria-label={`${label}: text`}>
        {text ? text.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>) : <p className="muted">No words.</p>}
      </div>
    </div>
  );
}
