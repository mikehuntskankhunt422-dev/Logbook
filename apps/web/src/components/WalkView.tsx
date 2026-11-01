import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { archiveRacks, CAST, entrance, libraryFacts, libraryRooms, spotForBook, spotForCast, spotForFolder, today, type Book, type CastId, type LibraryGallery, type Spot } from '@logbook/core';
import { href } from '../app/router.ts';
import { useReducedMotion } from '../lib/motion.ts';
import type { Place, Target, World } from '../world/engine.ts';
import { canWalk } from '../world/support.ts';
import { BOOK_OF_SAND_GALLERIES, findSecret, LAST_FOLDER_AISLES, SECRETS, useSecrets, type SecretId } from '../lib/secrets.ts';
import { libraryPrefs, setLibraryPrefs, useLibraryPrefs } from '../lib/library-prefs.ts';
import type { Take } from '../lib/cast.ts';
import { Dialog, formatLongDate } from './common.tsx';
import { Scare } from './Scare.tsx';
import { TalkDialog } from './TalkDialog.tsx';

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

const CAST_EMOJI: Record<CastId, string> = { librarian: '🧑‍🏫', clerk: '🗂️' };

export function WalkView({ library, storage, reading, onRead, fallback }: { library: LibraryGallery[]; storage: boolean; reading: boolean; onRead: (target: { kind: 'book' | 'folder'; book: Book }) => void; fallback: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<World | null>(null);
  const reduced = useReducedMotion();
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported'>(() => (canWalk() ? 'loading' : 'unsupported'));
  const [place, setPlace] = useState<Place | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [help, setHelp] = useState(() => !seenHelp());
  const rooms = useMemo(() => libraryRooms(library), [library]);
  const racks = useMemo(() => archiveRacks(library), [library]);
  // Someone to talk to (D116), the Library's settings, and The Unwritten's catch.
  const [talking, setTalking] = useState<CastId | null>(null);
  const [settings, setSettings] = useState(false);
  const [scaring, setScaring] = useState(false);
  const [cue, setCue] = useState('');
  const prefs = useLibraryPrefs();
  const secrets = useSecrets();
  const read = useRef<(t: Target) => void>(() => {});
  read.current = (t) => (t.kind === 'npc' ? setTalking(t.id) : onRead(t));
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
          made = createWorld(
            canvas.current,
            { place: setPlace, target: setTarget, open: (t) => read.current(t), cue: setCue, scare: () => setScaring(true) },
            start,
            reduced,
            Number(today().slice(0, 4)),
            libraryPrefs(),
          );
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

  useEffect(() => {
    world.current?.setContent(rooms, racks);
  }, [rooms, racks]);
  // Secrets (D115), far past the last book and the last folder.
  useEffect(() => {
    if (!place) return;
    if (place.world === 'library' && place.at >= rooms.length + BOOK_OF_SAND_GALLERIES - 1) findSecret('sand');
    if (place.world === 'storage' && place.at >= Math.ceil(racks.length / 2) + LAST_FOLDER_AISLES - 1) findSecret('lastfolder');
  }, [place, rooms.length, racks.length]);
  const paused = reading || talking !== null || settings || scaring;
  useEffect(() => {
    world.current?.setPaused(paused);
  }, [paused, state]);
  useEffect(() => {
    world.current?.setMode(prefs);
  }, [prefs, state]);
  // A word about what's happening stays a while; a new one starts it over.
  useEffect(() => {
    if (!cue) return;
    const timer = setTimeout(() => setCue(''), 6000);
    return () => clearTimeout(timer);
  }, [cue]);
  const found = useMemo(() => new Set(SECRETS.flatMap((x) => (secrets.found[x.id] ? [x.id] : [])) as SecretId[]), [secrets.found]);
  const facts = useMemo(() => libraryFacts(library, today(), racks.length), [library, racks.length]);

  /** Where a book or folder is, to be taken to it from what someone said. */
  const spotOf = (take: Take): Spot | null => {
    if (take.kind === 'book') {
      for (const [k, room] of rooms.entries())
        for (const [w, wall] of room.walls.entries())
          for (const [s, row] of wall.entries()) for (const thing of row) if (thing.kind === 'book' && thing.book.id === take.id) return spotForBook(k, w, s, thing);
    } else {
      for (const rack of racks) for (const [s, row] of rack.shelves.entries()) for (const thing of row) if (thing.kind === 'folder' && thing.book.id === take.id) return spotForFolder(rack.index, s, thing);
    }
    return null;
  };

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
  const wake = () => {
    // Caught: you wake at the door of where you were.
    setScaring(false);
    world.current?.goTo(entrance(inStorage ? 'storage' : 'library'));
    setCue(inStorage ? 'You wake at the storage room’s door.' : 'You wake at the Library’s door.');
    canvas.current?.focus({ preventScroll: true });
  };
  const months = rooms.flatMap((r) => r.walls.flat(2).flatMap((t) => (t.kind === 'divider' ? [t.month] : [])));
  const noun = inStorage ? 'folder' : 'book';

  return (
    <div className="walk" data-ring={ring || undefined} data-full={full || undefined} data-ps1={prefs.ps1 || undefined} data-horror={prefs.horror === 'off' ? undefined : prefs.horror}>
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
              else if (v.startsWith('cast:')) go(spotForCast(v.slice(5) as CastId));
              else go((inStorage ? spots.folders : spots.books).get(v));
            }}
          >
            <option value="" disabled>
              Go to…
            </option>
            <option value="library">🚪 The Library’s first gallery</option>
            <option value="storage">🗄️ The storage room</option>
            {CAST.map((c) => (
              <option key={c.id} value={`cast:${c.id}`}>
                {CAST_EMOJI[c.id]} {c.name}
              </option>
            ))}
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
          <button type="button" className="btn btn-small walk-help-button" aria-label="Library settings" title="Library settings: horror, the PS1 look" onClick={() => setSettings(true)}>
            ⚙️
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
          <p>The galleries go on for good, a year in each. The storage room is behind you, through the first gallery’s back door. The Librarian and the Clerk can be talked to: walk up to one and press Enter, or click them.</p>
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
        {cue ? (
          <span className="walk-target walk-cue">{cue}</span>
        ) : target?.kind === 'npc' ? (
          <>
            <span className="walk-target">
              {CAST_EMOJI[target.id]} <strong>{target.name}</strong>
            </span>
            <button type="button" className="btn btn-small btn-primary" onClick={() => setTalking(target.id)}>
              Talk
            </button>
          </>
        ) : target ? (
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
      {talking && (
        <TalkDialog
          id={talking}
          ctx={{ facts, horror: prefs.horror, found }}
          where={place?.label ?? 'the Library'}
          onTake={(take) => {
            setTalking(null);
            // Once the conversation has gone (taking the focus with it), there, with the focus back.
            const spot = spotOf(take);
            requestAnimationFrame(() => go(spot));
          }}
          onClose={() => {
            setTalking(null);
            canvas.current?.focus({ preventScroll: true });
          }}
        />
      )}
      <Dialog
        open={settings}
        title="Library settings"
        onClose={() => {
          setSettings(false);
          canvas.current?.focus({ preventScroll: true });
        }}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setSettings(false)}>
            Done
          </button>
        }
      >
        <fieldset className="walk-horror">
          <legend>Horror</legend>
          {(
            [
              ['off', 'Off', 'The Library as it always is.'],
              ['unsettling', 'Unsettling', 'The empty galleries go dark, and something walks them. No jump scares.'],
              ['intense', 'Intense', 'It’s faster, and if it catches you: a jump scare, with a sudden picture and a loud sound.'],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="row walk-choice">
              <input type="radio" name="walk-horror" value={value} checked={prefs.horror === value} onChange={() => setLibraryPrefs({ horror: value })} />
              <span>
                <strong>{label}</strong> <span className="hint">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="row">
          <input type="checkbox" checked={prefs.sounds} disabled={prefs.horror === 'off'} onChange={(e) => setLibraryPrefs({ sounds: e.target.checked })} /> 🔊 Horror sounds
        </label>
        <label className="row">
          <input type="checkbox" checked={prefs.ps1} onChange={(e) => setLibraryPrefs({ ps1: e.target.checked })} /> 🕹️ PS1 look: big pixels, wobbly corners, fewer colours
        </label>
        <p className="hint">
          Who’s who and what can happen: <a href={href({ name: 'library', view: 'encyclopedia' })}>📖 the Encyclopedia</a>. To talk to the Librarian and the Clerk in your own words, add an API key in{' '}
          <a href={href({ name: 'settings' })}>Settings → AI characters</a>.
        </p>
      </Dialog>
      {scaring && <Scare reduced={reduced} onDone={wake} />}
    </div>
  );
}
