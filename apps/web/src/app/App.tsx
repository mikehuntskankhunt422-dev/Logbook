import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { WrongPasscodeError } from '@logbook/core';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useJournal } from './journal-context.tsx';
import { consumeReplaceFlag, href, useRoute, type Route } from './router.ts';
import { useToast } from './toasts.tsx';
import { EntryEditor } from '../components/EntryEditor.tsx';
import { CalendarView, Memories, SearchView, Timeline } from '../components/views.tsx';
import { SettingsView } from '../components/SettingsView.tsx';
import { StreakBadge } from '../components/common.tsx';
import { downloadBackup } from '../lib/backup-io.ts';

/** Print layout and Paged.js load only when someone opens the book builder. */
const BookBuilder = lazy(() => import('../components/BookBuilder.tsx').then((m) => ({ default: m.BookBuilder })));

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: { name: 'home' }, label: 'Journal', icon: '📓' },
  { route: { name: 'calendar' }, label: 'Calendar', icon: '🗓️' },
  { route: { name: 'memories' }, label: 'On this day', icon: '🕰️' },
  { route: { name: 'search' }, label: 'Search', icon: '🔍' },
  { route: { name: 'book' }, label: 'Book', icon: '📖' },
  { route: { name: 'settings' }, label: 'Settings', icon: '⚙️' },
];

export function App() {
  const { journal, locked, settings } = useJournal();
  const route = useRoute();
  useTheme(settings.theme);
  useAutoLock(journal.isEncrypted && !locked ? settings.autoLockMinutes : 0, () => journal.lock());
  usePwaUpdates();

  useEffect(() => {
    // Tidy up once per launch: purge 30-day-old trash and media nothing references.
    if (!locked) void journal.purgeExpiredTrash().then(() => journal.collectGarbage());
  }, [journal, locked]);

  const firstRoute = useRef(true);
  const routeKey = route.name === 'entry' ? route.id : '';
  useEffect(() => {
    document.title = { home: 'Logbook', entry: 'Entry · Logbook', new: 'New entry · Logbook', calendar: 'Calendar · Logbook', memories: 'On this day · Logbook', search: 'Search · Logbook', book: 'Make a book · Logbook', settings: 'Settings · Logbook' }[route.name];
    // Move focus to the new page for screen-reader and keyboard users, but never on first load
    // (the skip link comes first) or on a silent URL update while someone is typing.
    const silent = consumeReplaceFlag();
    if (firstRoute.current || silent) {
      firstRoute.current = false;
      return;
    }
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [route.name, routeKey]);

  if (locked) return <LockScreen />;

  const section = route.name === 'entry' || route.name === 'new' ? 'home' : route.name;
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href={href({ name: 'home' })}>
          <span className="brand-mark" aria-hidden="true">
            ✦
          </span>
          Logbook
        </a>
        <StreakBadge />
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.label} href={href(n.route)} aria-current={section === n.route.name ? 'page' : undefined}>
              <span className="nav-icon" aria-hidden="true">
                {n.icon}
              </span>
              <span className="nav-label">{n.label}</span>
            </a>
          ))}
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <BackupBanner />
        {route.name === 'home' && <Timeline />}
        {(route.name === 'entry' || route.name === 'new') && <EntryEditor entryId={route.name === 'entry' ? route.id : undefined} newDate={route.name === 'new' ? route.date : undefined} />}
        {route.name === 'calendar' && <CalendarView month={route.month} />}
        {route.name === 'memories' && <Memories />}
        {route.name === 'search' && <SearchView tag={route.tag} />}
        {route.name === 'book' && (
          <Suspense fallback={<p className="muted">Opening the book builder…</p>}>
            <BookBuilder />
          </Suspense>
        )}
        {route.name === 'settings' && <SettingsView />}
      </main>
      {route.name !== 'entry' && route.name !== 'new' && (
        <a className="btn btn-primary fab" href={href({ name: 'new' })}>
          ✍️ New entry
        </a>
      )}
    </div>
  );
}

function useTheme(theme: 'system' | 'light' | 'dark') {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}

function useAutoLock(minutes: number, lock: () => void) {
  useEffect(() => {
    if (!minutes) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, minutes * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes, lock]);
}

function usePwaUpdates() {
  const toast = useToast();
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    if (offlineReady) toast('Logbook is ready to work offline.');
  }, [offlineReady, toast]);
  useEffect(() => {
    if (needRefresh) toast('A new version of Logbook is ready.', { label: 'Reload', run: () => void updateServiceWorker(true) }, 0);
  }, [needRefresh, toast, updateServiceWorker]);
}

function BackupBanner() {
  const { journal, settings } = useJournal();
  const toast = useToast();
  const [, force] = useState(0);
  if (!journal.needsBackupReminder()) return null;
  return (
    <div className="banner" role="region" aria-label="Backup reminder">
      <span>
        💾{' '}
        {settings.lastBackupAt
          ? `Your last backup was ${Math.floor((Date.now() - new Date(settings.lastBackupAt).getTime()) / 86_400_000)} days ago.`
          : `You haven't made a backup yet.`}{' '}
        Your journal only lives on this device, so a copy somewhere else keeps it safe.
      </span>
      <span className="row">
        <button type="button" className="btn btn-small btn-primary" onClick={() => void downloadBackup(journal, journal.isEncrypted).then(() => toast('Backup downloaded.'))}>
          Back up now
        </button>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          onClick={() => void journal.updateSettings({ backupSnoozedUntil: new Date(Date.now() + 3 * 86_400_000).toISOString() }).then(() => force((n) => n + 1))}
        >
          Remind me later
        </button>
      </span>
    </div>
  );
}

function LockScreen() {
  const { journal } = useJournal();
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="lock-screen">
      <div className="lock-card">
        <div style={{ fontSize: '2.6rem' }} aria-hidden="true">
          🔒
        </div>
        <h1>Logbook is locked</h1>
        <p className="muted">Enter your passcode to open your journal.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            journal
              .unlock(pass)
              .catch((err: unknown) => setError(err instanceof WrongPasscodeError ? 'That passcode is not right.' : (err as Error).message))
              .finally(() => {
                setBusy(false);
                setPass('');
              });
          }}
        >
          <label className="sr-only" htmlFor="unlock">
            Passcode
          </label>
          <input id="unlock" className="text-input" type="password" autoFocus autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'unlock-error' : undefined} />
          <button className="btn btn-primary" type="submit" disabled={busy || !pass}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
          {error && (
            <p id="unlock-error" className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
