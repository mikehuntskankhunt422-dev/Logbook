import { useEffect, useId, useRef, useState } from 'react';
import { APP_MAX_CODE, APP_NAME_MAX, appCodeKind, appNameFrom, formatBytes, readAppMessage, type MediaMeta } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { href } from '../app/router.ts';
import { useToast } from '../app/toasts.tsx';
import { APP_SANDBOX, appFrame, deleteApp, keepAppItems, readCodeFile, useApps } from '../lib/apps.ts';
import { trackWork } from '../lib/pending-saves.ts';
import { Dialog } from './common.tsx';

/**
 * Your own apps (D111): paste an app's code (a web page: HTML, CSS and JavaScript, as Claude or
 * Grok writes them), or open its file, and run it here, walled off from the journal.
 */
export function AppsView({ id }: { id?: string }) {
  const apps = useApps();
  if (!id) return <AppList apps={apps} />;
  if (!apps) return null;
  const app = apps.find((a) => a.id === id);
  if (!app)
    return (
      <>
        <h1>App not found</h1>
        <p>It may have been deleted, here or on another computer.</p>
        <a className="btn" href={href({ name: 'apps' })}>
          ← Your apps
        </a>
      </>
    );
  return <AppRunner key={app.id} app={app} />;
}

/** Why some code can't become an app, if it can't. */
function codeProblem(code: string): string | undefined {
  if (!code.trim()) return 'Paste the app’s code first.';
  if (code.length > APP_MAX_CODE) return 'That’s more code than an app can have (5 MB).';
  if (appCodeKind(code) === 'react')
    return 'This looks like a React component (JSX), which has to be built before a browser can run it. Logbook runs apps written as a web page: HTML, CSS and JavaScript. Ask for “a single HTML file” instead.';
  return undefined;
}

function AppList({ apps }: { apps: MediaMeta[] | undefined }) {
  const { journal } = useJournal();
  const toast = useToast();
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (source: string, given: string, fileName?: string) => {
    const why = codeProblem(source);
    setProblem(why ?? '');
    if (why) return;
    setBusy(true);
    try {
      const app = await trackWork(journal.addApp(given.trim() || appNameFrom(source, fileName), source));
      location.hash = href({ name: 'apps', id: app.id });
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <h1>🧩 Apps</h1>
      <p className="hint">
        Run apps of your own in Logbook: a calculator, a tracker, a game. Paste an app’s code below, or open its file: a web page written in HTML, CSS and JavaScript, like the apps Claude or Grok write. Each app runs walled off from your
        journal, and what it saves is kept in your journal, so it goes with it to your other computers and into backups.
      </p>
      {apps && apps.length > 0 && (
        <ul className="app-list" aria-label="Your apps">
          {apps.map((a) => (
            <li key={a.id}>
              <a href={href({ name: 'apps', id: a.id })}>
                <span aria-hidden="true">🧩</span>
                {a.name}
              </a>
              <span className="muted">{formatBytes(a.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      {apps?.length === 0 && <p className="muted">No apps yet.</p>}
      <form
        className="panel app-new"
        aria-labelledby={`${id}-title`}
        onSubmit={(e) => {
          e.preventDefault();
          void add(code, name);
        }}
      >
        <h2 id={`${id}-title`}>Add an app</h2>
        <div className="field">
          <label htmlFor={`${id}-code`}>Code</label>
          <textarea
            id={`${id}-code`}
            className="text-input app-code"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="<!doctype html>…"
            value={code}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            onChange={(e) => {
              setCode(e.target.value);
              setProblem('');
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} type="text" maxLength={APP_NAME_MAX} placeholder="From its page’s title, if left empty" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {problem && (
          <p id={`${id}-problem`} className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Add app
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => file.current?.click()}>
            📂 Open a file…
          </button>
        </div>
        <input
          ref={file}
          type="file"
          hidden
          data-testid="app-file"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (!picked) return;
            void readCodeFile(picked).then(
              (source) => add(source, name, picked.name),
              (err: Error) => setProblem(err.message),
            );
          }}
        />
      </form>
    </>
  );
}

function AppRunner({ app }: { app: MediaMeta }) {
  const { journal } = useJournal();
  const toast = useToast();
  const id = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState<{ srcDoc: string } | { src: string }>();
  const [run, setRun] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState('');
  const warned = useRef(false);

  // The app's page, with what it saved, each time it (re)starts.
  useEffect(() => {
    let alive = true;
    setSource(undefined);
    appFrame(journal, app).then(
      (next) => alive && setSource(next),
      (err: Error) => alive && setFailed(err.message),
    );
    return () => {
      alive = false;
    };
    // The code changes only through this page, which restarts it; a rename needn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journal, app.id, run]);

  // What it saves, from its frame only, kept in the journal.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const items = readAppMessage(e.data);
      if (items === undefined) return;
      if (items === 'too-big') {
        if (!warned.current) toast(`${app.name} tried to keep more than 5 MB, so its latest changes weren’t saved.`);
        warned.current = true;
        return;
      }
      keepAppItems(journal, app.id, items, (err) => toast(err.message));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [journal, app.id, app.name, toast]);

  const saveCode = async () => {
    const code = editing ?? '';
    const why = codeProblem(code);
    setProblem(why ?? '');
    if (why) return;
    try {
      await trackWork(journal.updateApp(app, { code }));
    } catch (err) {
      toast((err as Error).message);
      return;
    }
    setEditing(null);
    setRun((n) => n + 1);
    toast(`Saved ${app.name}’s code.`);
  };

  return (
    <>
      <div className="app-head">
        <a className="icon-btn" href={href({ name: 'apps' })} aria-label="Your apps">
          ←
        </a>
        <h1>{app.name}</h1>
      </div>
      <div className="row app-actions">
        <button type="button" className="btn btn-small" onClick={() => setRun((n) => n + 1)}>
          ↻ Restart
        </button>
        <button type="button" className="btn btn-small" aria-expanded={editing !== null} onClick={() => (editing === null ? void journal.appCode(app.id).then(setEditing, (err: Error) => toast(err.message)) : setEditing(null))}>
          ✏️ Edit code
        </button>
        <button type="button" className="btn btn-small" onClick={() => setRenaming(app.name)}>
          Rename…
        </button>
        <button type="button" className="btn btn-small btn-danger" onClick={() => setDeleting(true)}>
          Delete…
        </button>
      </div>
      {editing !== null && (
        <form
          className="panel"
          aria-label={`${app.name}’s code`}
          onSubmit={(e) => {
            e.preventDefault();
            void saveCode();
          }}
        >
          <div className="field">
            <label htmlFor={`${id}-code`}>Code</label>
            <textarea
              id={`${id}-code`}
              className="text-input app-code"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={editing}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-problem` : undefined}
              onChange={(e) => {
                setEditing(e.target.value);
                setProblem('');
              }}
            />
          </div>
          {problem && (
            <p id={`${id}-problem`} className="error" role="alert">
              {problem}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary">
              Save and restart
            </button>
            <button type="button" className="btn" onClick={() => (setEditing(null), setProblem(''))}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <p className="app-notice" role="note">
        🧱 This app runs walled off: it can’t see your entries, your files or Logbook’s settings, or use Logbook’s features. It can use the internet. What it saves stays with it, in your journal.
      </p>
      {failed && (
        <p className="error" role="alert">
          {failed}
        </p>
      )}
      {source && <iframe key={run} ref={frame} className="app-frame" title={app.name} sandbox={APP_SANDBOX} allow="fullscreen; autoplay; clipboard-write" referrerPolicy="no-referrer" {...source} />}
      <Dialog
        open={renaming !== null}
        title="Rename this app"
        onClose={() => setRenaming(null)}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setRenaming(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const name = renaming ?? '';
                setRenaming(null);
                void trackWork(journal.updateApp(app, { name })).catch((err: Error) => toast(err.message));
              }}
            >
              Rename
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} type="text" maxLength={APP_NAME_MAX} value={renaming ?? ''} onChange={(e) => setRenaming(e.target.value)} />
        </div>
      </Dialog>
      <Dialog
        open={deleting}
        title={`Delete ${app.name}?`}
        onClose={() => setDeleting(false)}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setDeleting(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setDeleting(false);
                void trackWork(deleteApp(journal, app.id)).then(
                  () => {
                    toast(`Deleted ${app.name}.`);
                    location.hash = href({ name: 'apps' });
                  },
                  (err: Error) => toast(err.message),
                );
              }}
            >
              Delete
            </button>
          </>
        }
      >
        <p>Its code and everything it saved go from your journal. This can’t be undone.</p>
      </Dialog>
    </>
  );
}
