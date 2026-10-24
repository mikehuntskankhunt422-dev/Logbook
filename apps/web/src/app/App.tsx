import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { WrongPasscodeError, fontFor, fontStack, type Settings } from '@logbook/core';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useJournal } from './journal-context.tsx';
import { consumeReplaceFlag, href, useRoute, type Route } from './router.ts';
import { useToast } from './toasts.tsx';
import { EntryEditor } from '../components/EntryEditor.tsx';
import { CalendarView, Memories, SearchView, Timeline } from '../components/views.tsx';
import { SettingsView } from '../components/SettingsView.tsx';
import { ClockView } from '../components/ClockView.tsx';
import { Ringer } from './clock.tsx';
import { useGarden, useGardenEffects } from './garden.tsx';
import { GardenView } from '../components/GardenView.tsx';
import { useGardenPrefs } from '../lib/garden-prefs.ts';
import { StreakBadge } from '../components/common.tsx';
import { BACKUP_DONE, downloadBackup } from '../lib/backup-io.ts';
import { spring, useReducedMotion } from '../lib/motion.ts';
import { motion } from 'motion/react';


/** The desktop app's copies to sort out (D102): a banner above every page, and their own page. */
const CopiesBanner = import.meta.env.VITE_PLATFORM === 'desktop' ? lazy(() => import('../desktop/CopiesView.tsx').then((m) => ({ default: m.CopiesBanner }))) : null;
const CopiesView = import.meta.env.VITE_PLATFORM === 'desktop' ? lazy(() => import('../desktop/CopiesView.tsx').then((m) => ({ default: m.CopiesView }))) : null;

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: { name: 'home' }, label: 'Journal', icon: '📓' },
  { route: { name: 'calendar' }, label: 'Calendar', icon: '🗓️' },
  { route: { name: 'memories' }, label: 'On this day', icon: '🕰️' },
  { route: { name: 'search' }, label: 'Search', icon: '🔍' },
  { route: { name: 'garden' }, label: 'Garden', icon: '🌱' },
  { route: { name: 'clock' }, label: 'Clock', icon: '⏰' },
  { route: { name: 'settings' }, label: 'Settings', icon: '⚙️' },
];

export function App() {
  const { journal, locked, settings } = useJournal();
  const route = useRoute();
  const reduced = useReducedMotion();
  useTheme(settings.theme);
  useReadability(settings);
  useAutoLock(journal.isEncrypted && !locked ? settings.autoLockMinutes : 0, () => journal.lock());
  usePwaUpdates();
  const gardenHidden = useGardenPrefs().hidden;
  const garden = useGarden(!gardenHidden);
  useGardenEffects(garden);

  useEffect(() => {
    // Tidy up once per launch: purge 30-day-old trash and media nothing references, and the book
    // builder's leftovers from earlier versions (D96).
    if (!locked)
      void journal
        .purgeExpiredTrash()
        .then(() => journal.collectGarbage())
        .then(() => journal.dropBookData())
        .catch(() => {});
  }, [journal, locked]);

  // Entries that were set to expire go to the trash when their time comes (D91), checked every
  // minute; the one open in the editor waits until it's closed.
  const openEntry = route.name === 'entry' ? route.id : undefined;
  useEffect(() => {
    if (locked) return;
    const sweep = () => void journal.trashExpired(new Date(), openEntry).catch(() => {});
    sweep();
    const timer = setInterval(sweep, 60_000);
    return () => clearInterval(timer);
  }, [journal, locked, openEntry]);

  const firstRoute = useRef(true);
  // The garden's own pages (D98) count as pages too, while the garden is shown.
  const routeKey = route.name === 'entry' ? route.id : route.name === 'garden' && !gardenHidden ? (route.view ?? '') : '';
  useEffect(() => {
    document.title = { home: 'Logbook', entry: 'Entry · Logbook', new: 'New entry · Logbook', calendar: 'Calendar · Logbook', memories: 'On this day · Logbook', search: 'Search · Logbook', clock: 'Clock · Logbook', garden: { '': 'Garden · Logbook', herbarium: 'Herbarium · Garden · Logbook', almanac: 'Almanac · Garden · Logbook' }[routeKey] ?? 'Garden · Logbook', settings: 'Settings · Logbook', copies: 'Copies to sort out · Logbook' }[route.name];
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

  if (locked)
    return (
      <>
        <LockScreen />
        <Ringer />
      </>
    );

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
          {NAV.filter((n) => !(gardenHidden && n.route.name === 'garden')).map((n) => (
            <a key={n.label} href={href(n.route)} title={n.label} aria-current={section === n.route.name ? 'page' : undefined}>
              {/* One highlight that glides from item to item. */}
              {section === n.route.name && <motion.span layoutId="nav-pill" className="nav-pill" transition={spring(reduced)} aria-hidden="true" />}
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
        {CopiesBanner && route.name !== 'copies' && (
          <Suspense fallback={null}>
            <CopiesBanner />
          </Suspense>
        )}
        {/* Keyed by page, so each page comes in with its animation; a new entry and the same entry
            once saved are one page (the URL changes on the first save, the editor stays). */}
        <div className="page" key={route.name === 'new' ? 'entry' : route.name}>
          {(route.name === 'home' || (route.name === 'copies' && !CopiesView)) && <Timeline />}
          {route.name === 'copies' && CopiesView && (
            <Suspense fallback={null}>
              <CopiesView />
            </Suspense>
          )}
          {(route.name === 'entry' || route.name === 'new') && <EntryEditor entryId={route.name === 'entry' ? route.id : undefined} newDate={route.name === 'new' ? route.date : undefined} />}
          {route.name === 'calendar' && <CalendarView month={route.month} />}
          {route.name === 'memories' && <Memories />}
          {route.name === 'search' && <SearchView tag={route.tag} />}
          {route.name === 'clock' && <ClockView />}
          {route.name === 'garden' && <GardenView garden={garden} view={route.view} />}
          {route.name === 'settings' && <SettingsView />}
        </div>
      </main>
      {route.name !== 'entry' && route.name !== 'new' && route.name !== 'clock' && (
        <a className="btn btn-primary fab" href={href({ name: 'new' })}>
          ✍️ New entry
        </a>
      )}
      <Ringer />
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

/** Text size, line spacing and the writing font (Settings → Appearance, D91), on the whole app. */
function useReadability({ textSize, lineSpacing, writingFont }: Pick<Settings, 'textSize' | 'lineSpacing' | 'writingFont'>) {
  useEffect(() => {
    const root = document.documentElement;
    if (textSize === 'normal') root.removeAttribute('data-text-size');
    else root.setAttribute('data-text-size', textSize);
    if (lineSpacing === 'normal') root.removeAttribute('data-line-spacing');
    else root.setAttribute('data-line-spacing', lineSpacing);
    const font = fontFor(writingFont);
    if (font) root.style.setProperty('--font-body', fontStack(font));
    else root.style.removeProperty('--font-body');
  }, [textSize, lineSpacing, writingFont]);
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
        <button type="button" className="btn btn-small btn-primary" onClick={() =>
            void downloadBackup(journal, journal.isEncrypted).then(
              (saved) => saved && toast(BACKUP_DONE),
              (err: unknown) => toast(`Couldn't save the backup: ${err instanceof Error ? err.message : String(err)}`),
            )
          }>
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
