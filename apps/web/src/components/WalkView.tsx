import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { archiveRacks, entrance, libraryRooms, spotForBook, spotForFolder, today, type LibraryGallery, type Spot } from '@logbook/core';
import { useReducedMotion } from '../lib/motion.ts';
import type { Place, Target, World } from '../world/engine.ts';
import { canWalk } from '../world/support.ts';
import { BOOK_OF_SAND_GALLERIES, findSecret, LAST_FOLDER_AISLES } from '../lib/secrets.ts';
import { formatLongDate } from './common.tsx';

/**
 * The Library in 3D (D113): walk the galleries, take a book down and read it; through the first
 * gallery's back door, the storage room, an entry in every folder. The view around it says where
 * you are and what you're looking at, and has buttons for everything the keys and the pointer do,
 * so a tap or a click gets anywhere.
 */

/** Where you were, to come back to (from a book's editor, from another page). */
let lastSpot: Spot | null = null;
const HELP = 'logbook.walk.help';

const seenHelp = () => {
  try {
    return localStorage.getItem(HELP) === 'seen';
  } catch {
    return false;
  }
};

const MONTH = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

export function WalkView({ library, storage, reading, onRead, fallback }: { library: LibraryGallery[]; storage: boolean; reading: boolean; onRead: (target: Target) => void; fallback: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<World | null>(null);
  const reduced = useReducedMotion();
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported'>(() => (canWalk() ? 'loading' : 'unsupported'));
  const [place, setPlace] = useState<Place | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [help, setHelp] = useState(() => !seenHelp());
  const rooms = useMemo(() => libraryRooms(library), [library]);
  const racks = useMemo(() => archiveRacks(library), [library]);
  const read = useRef(onRead);
  read.current = onRead;
  const content = useRef({ rooms, racks });
  content.current = { rooms, racks };
  // The focus ring: only for coming in with Tab, never for a click, a drag or the page's own focusing.
  const [ring, setRing] = useState(false);
  const tabbedAt = useRef(-Infinity);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') tabbedAt.current = performance.now();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  // Full screen (D114): the view over the whole window, and the window over the whole screen
  // where the device allows (the desktop app's own window; a browser's full screen elsewhere).
  // The browser's comes and goes a moment after it's asked, so what's under way is kept: turned
  // off and straight back on, it ends on; leaving the page, off.
  const [full, setFull] = useState(false);
  const fullRef = useRef(false);
  const asked = useRef({ on: false, off: false });
  const screenTo = (on: boolean) => {
    if (import.meta.env.VITE_PLATFORM === 'desktop') {
      void import('../desktop/bridge.ts').then((b) => b.setWindowFullscreen(on)).catch(() => {});
      return;
    }
    if (on) {
      if (!document.fullscreenEnabled || document.fullscreenElement || asked.current.on || asked.current.off) return;
      asked.current.on = true;
      document.documentElement.requestFullscreen().then(
        () => {
          asked.current.on = false;
          // Left again while it was coming.
          if (!fullRef.current) screenTo(false);
        },
        () => (asked.current.on = false),
      );
    } else if (document.fullscreenElement && !asked.current.off) {
      asked.current.off = true;
      document.exitFullscreen().catch(() => (asked.current.off = false));
    }
  };
  const fullscreen = useRef((on: boolean) => {
    if (fullRef.current === on) return;
    fullRef.current = on;
    setFull(on);
    screenTo(on);
  });
  const enter = () => {
    fullscreen.current(true);
    canvas.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const to = fullscreen.current;
    const onChange = () => {
      if (document.fullscreenElement) return;
      if (asked.current.off) {
        // Our own way out; asked back in meanwhile, back in.
        asked.current.off = false;
        if (fullRef.current) screenTo(true);
      } else if (!asked.current.on) to(false);
    };
    // Escape ends it (unless it closes a book first); the browser's own way out does too.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && fullRef.current && !document.querySelector('dialog[open]') && to(false);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('keydown', onKey);
      to(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Where each month starts, and the newest book and folder, in each world.
  const spots = useMemo(() => {
    const books = new Map<string, Spot>();
    const folders = new Map<string, Spot>();
    let newestBook: Spot | null = null;
    let newestFolder: Spot | null = null;
    rooms.forEach((room, k) =>
      room.walls.forEach((wall, w) =>
        wall.forEach((row, s) =>
          row.forEach((thing) => {
            if (thing.kind === 'divider') books.set(thing.month, spotForBook(k, w, s, thing));
            else newestBook = spotForBook(k, w, s, thing);
          }),
        ),
      ),
    );
    racks.forEach((rack) =>
      rack.shelves.forEach((row, s) =>
        row.forEach((thing) => {
          if (thing.kind === 'guide') folders.set(thing.month, spotForFolder(rack.index, s, thing));
          else newestFolder = spotForFolder(rack.index, s, thing);
        }),
      ),
    );
    return { books, folders, newestBook: newestBook as Spot | null, newestFolder: newestFolder as Spot | null };
  }, [rooms, racks]);

  // The world, made once for the page's life.
  useEffect(() => {
    if (state === 'unsupported') return;
    let alive = true;
    let made: World | null = null;
    const start = storage ? entrance('storage') : (lastSpot ?? entrance('library'));
    import('../world/engine.ts').then(
      ({ createWorld }) => {
        if (!alive || !canvas.current) return;
        try {
          made = createWorld(canvas.current, { place: setPlace, target: setTarget, open: (t) => read.current(t) }, start, reduced, Number(today().slice(0, 4)));
        } catch {
          setState('unsupported');
          return;
        }
        world.current = made;
        made.setContent(content.current.rooms, content.current.racks);
        setState('ready');
        canvas.current.focus({ preventScroll: true });
      },
      () => alive && setState('unsupported'),
    );
    return () => {
      alive = false;
      if (made) {
        lastSpot = made.where();
        made.dispose();
      }
      world.current = null;
    };
    // Made once for the page: content and reading reach it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => world.current?.setContent(rooms, racks), [rooms, racks]);
  // Secrets (D115), far past the last book and the last folder.
  useEffect(() => {
    if (!place) return;
    if (place.world === 'library' && place.at >= rooms.length + BOOK_OF_SAND_GALLERIES - 1) findSecret('sand');
    if (place.world === 'storage' && place.at >= Math.ceil(racks.length / 2) + LAST_FOLDER_AISLES - 1) findSecret('lastfolder');
  }, [place, rooms.length, racks.length]);
  useEffect(() => world.current?.setPaused(reading), [reading]);

  if (state === 'unsupported')
    return (
      <>
        <p className="notice">This device can’t show the Library in 3D, so here are your shelves.</p>
        {fallback}
      </>
    );

  const inStorage = place?.world === 'storage';
  const go = (spot: Spot | null | undefined) => {
    if (!spot) return;
    world.current?.goTo(spot);
    canvas.current?.focus({ preventScroll: true });
  };
  const months = rooms.flatMap((r) => r.walls.flat(2).flatMap((t) => (t.kind === 'divider' ? [t.month] : [])));
  const noun = inStorage ? 'folder' : 'book';

  return (
    <div className="walk" data-ring={ring || undefined} data-full={full || undefined}>
      <canvas
        ref={canvas}
        className="walk-canvas"
        tabIndex={0}
        onFocus={() => setRing(performance.now() - tabbedAt.current < 1000)}
        onBlur={() => setRing(false)}
        onPointerDown={() => setRing(false)}
        role="application"
        aria-roledescription="3D library"
        aria-label="The Library in 3D. Walk with W, A, S and D or the arrow keys, look around by dragging, and press Enter to read what’s in front of you."
      />
      {state === 'loading' && <p className="walk-loading">Opening the doors…</p>}
      <div className="walk-hud walk-top">
        <p className="walk-place" aria-live="polite">
          {place && (
            <>
              <strong>{place.label}</strong>
              <span>{place.detail}</span>
            </>
          )}
        </p>
        <div className="walk-buttons">
          <label className="sr-only" htmlFor="walk-goto">
            Go to
          </label>
          <select
            id="walk-goto"
            className="walk-select"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'library') go(entrance('library'));
              else if (v === 'storage') go(entrance('storage'));
              else go((inStorage ? spots.folders : spots.books).get(v));
            }}
          >
            <option value="" disabled>
              Go to…
            </option>
            <option value="library">🚪 The Library’s first gallery</option>
            <option value="storage">🗄️ The storage room</option>
            {months.length > 0 && (
              <optgroup label={inStorage ? 'Folders from' : 'Books from'}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {MONTH(m)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button type="button" className="btn btn-small" disabled={!(inStorage ? spots.newestFolder : spots.newestBook)} onClick={() => go(inStorage ? spots.newestFolder : spots.newestBook)}>
            Newest {noun}
          </button>
          <button type="button" className="btn btn-small walk-help-button" aria-label="How to walk" title="How to walk" aria-expanded={help} onClick={() => setHelp((h) => !h)}>
            ?
          </button>
          <button type="button" className="btn btn-small walk-help-button" aria-label={full ? 'Leave full screen' : 'Full screen'} title={full ? 'Leave full screen (Esc)' : 'Full screen'} aria-pressed={full} onClick={() => (full ? fullscreen.current(false) : enter())}>
            {full ? '✕' : '⛶'}
          </button>
        </div>
      </div>
      {help && (
        <div className="walk-hud walk-help" role="note">
          <p>
            <strong>Walk</strong> with W A S D or the arrow keys (Shift to hurry), or the stick that appears where you touch the lower left. <strong>Look around</strong> by dragging. <strong>Read</strong> a{' '}
            {noun}: click or tap it, or face it and press Enter.
          </p>
          <p>The galleries go on for good, a year in each. The storage room is behind you, through the first gallery’s back door.</p>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              setHelp(false);
              try {
                localStorage.setItem(HELP, 'seen');
              } catch {
                // Shown again next time: no harm.
              }
              canvas.current?.focus({ preventScroll: true });
            }}
          >
            Got it
          </button>
        </div>
      )}
      <div className="walk-hud walk-bottom" aria-live="polite">
        {target ? (
          <>
            <span className="walk-target">
              {target.kind === 'folder' ? '🗂️' : '📖'} <strong>{target.book.title.trim() || 'Untitled'}</strong> · {formatLongDate(target.book.date)} · {target.book.words.toLocaleString()} {target.book.words === 1 ? 'word' : 'words'}
            </span>
            <button type="button" className="btn btn-small btn-primary" onClick={() => onRead(target)}>
              Read it
            </button>
          </>
        ) : (
          state === 'ready' && <span className="walk-target walk-hint">Walk up to a {noun} and look at it to see what it is.</span>
        )}
      </div>
      <span className="walk-cross" aria-hidden="true" />
    </div>
  );
}
