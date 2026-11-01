import { memo, useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { MOODS, parseIsoDate, type Book, type LibraryGallery, type LibraryMonth } from '@logbook/core';
import { href } from '../app/router.ts';
import { useLibrary } from '../lib/library.ts';

/**
 * The Library (D112): every entry a book on the shelves, as thick as the entry is long, shelved
 * by month in a gallery for each year. Past the newest book the empty shelves go on as far as
 * anyone scrolls, drawn by one element that grows, so they cost nothing however far it goes.
 */
export function LibraryView() {
  const library = useLibrary();
  const id = useId();
  const [month, setMonth] = useState('');
  // Back from a book: at its place on the shelf, after the page has gone to the top as pages do.
  const ready = Boolean(library);
  useEffect(() => {
    if (!ready || !lastOpened) return;
    const opened = lastOpened;
    lastOpened = null;
    const frame = requestAnimationFrame(() => goTo(document.querySelector<HTMLElement>(`.library-shelf .book[data-book="${CSS.escape(opened)}"]`), 'center'));
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  if (!library) return null;
  const books = library.reduce((n, g) => n + g.books, 0);
  const words = library.reduce((n, g) => n + g.words, 0);
  const chosen = month && library.some((g) => g.months.some((m) => m.month === month)) ? month : (library.at(-1)?.months.at(-1)?.month ?? '');

  return (
    <>
      <h1>📚 Library</h1>
      <p className="hint">Every entry you write is a book here: the more you wrote, the thicker it is, and a very long one stands taller. Its colour is its mood. The shelves go on for good, with room for everything you’ll write.</p>
      {books > 0 && (
        <div className="library-bar">
          <p className="library-count">
            {books === 1 ? '1 book' : `${books.toLocaleString()} books`} · {words === 1 ? '1 word' : `${words.toLocaleString()} words`}
          </p>
          <div className="library-goto">
            <label className="sr-only" htmlFor={`${id}-month`}>
              Month
            </label>
            <select id={`${id}-month`} className="text-input" value={chosen} onChange={(e) => setMonth(e.target.value)}>
              {library.map((g) => (
                <optgroup key={g.year} label={g.year}>
                  {g.months.map((m) => (
                    <option key={m.month} value={m.month}>
                      {monthName(m.month)} {g.year}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button type="button" className="btn btn-small" onClick={() => goTo(document.getElementById(shelfId(chosen)), 'start')}>
              Go to it
            </button>
            <button type="button" className="btn btn-small" onClick={goToNewest}>
              Newest book
            </button>
          </div>
        </div>
      )}
      {library.map((g) => (
        <Gallery key={g.year} gallery={g} />
      ))}
      <EmptyShelves empty={books === 0} />
    </>
  );
}

// One formatter for every book: a library can hold thousands.
const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
/** The book last opened from the shelves, to come back to. */
let lastOpened: string | null = null;

const monthName = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long' });
const shelfId = (month: string) => `library-${month}`;
const amount = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString()} ${one}s`);

/** Brings a place on the shelves into view and gives it the focus, at once (it may be far). */
function goTo(target: HTMLElement | null, block: ScrollLogicalPosition) {
  if (!target) return;
  target.scrollIntoView({ block });
  target.focus({ preventScroll: true });
}

function goToNewest() {
  const books = document.querySelectorAll<HTMLElement>('.library-shelf .book');
  goTo(books[books.length - 1] ?? null, 'center');
}

// The same gallery (each is made again only when the entries change) isn't drawn again.
const Gallery = memo(function Gallery({ gallery }: { gallery: LibraryGallery }) {
  return (
    <section className="library-gallery" aria-labelledby={`library-${gallery.year}`}>
      <div className="library-sign">
        <h2 id={`library-${gallery.year}`} tabIndex={-1}>
          <span className="library-sign-small">Gallery </span>
          {gallery.year}
        </h2>
        <p>
          {amount(gallery.books, 'book')} · {amount(gallery.words, 'word')}
        </p>
      </div>
      {gallery.months.map((m) => (
        <Shelf key={m.month} month={m} year={gallery.year} />
      ))}
    </section>
  );
});

function Shelf({ month, year }: { month: LibraryMonth; year: string }) {
  const plate = shelfId(month.month);
  return (
    <div className="library-case">
      <h3 className="library-plate" id={plate} tabIndex={-1} aria-label={`${monthName(month.month)} ${year}: ${amount(month.books.length, 'book')}`}>
        {monthName(month.month)}
      </h3>
      <ul className="library-shelf" aria-labelledby={plate}>
        {month.books.map((b) => (
          <li key={b.id}>
            <BookSpine book={b} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BookSpine({ book }: { book: Book }) {
  const title = book.title.trim() || 'Untitled';
  const label = `${title}, ${longDate.format(parseIsoDate(book.date))}, ${amount(book.words, 'word')}`;
  const mood = book.mood ? MOODS.indexOf(book.mood) : -1;
  return (
    <a
      className="book"
      href={href({ name: 'entry', id: book.id })}
      aria-label={label}
      title={label}
      data-book={book.id}
      data-mood={mood >= 0 ? mood : undefined}
      data-tone={mood >= 0 ? undefined : book.tone}
      style={{ '--w': book.thickness, '--h': book.height } as CSSProperties}
      // Opened here (not in another tab or window): come back to it.
      onClick={(e) => {
        if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) lastOpened = book.id;
      }}
    >
      <span className="book-title" aria-hidden="true">
        {title}
      </span>
      <span className="book-day" aria-hidden="true">
        {Number(book.date.slice(8))}
      </span>
    </a>
  );
}

/** How far the empty shelves can reach: far past where anyone scrolls, short of what browsers can lay out. */
const MOST = 8_000_000;
/** Shelves added each time the end comes near, and how near counts. */
const MORE = 3000;
const NEAR = 1500;

/** The empty shelves past the newest book, which grow as they're scrolled through, for good. */
function EmptyShelves({ empty }: { empty: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(() => Math.max(1200, Math.round(window.innerHeight * 2)));
  const grow = useCallback(() => {
    const el = end.current;
    if (el && el.getBoundingClientRect().bottom - window.innerHeight < NEAR) setHeight((h) => Math.min(h + MORE, MOST));
  }, []);
  useEffect(() => {
    let frame = 0;
    const later = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), grow()));
    };
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
    };
  }, [grow]);
  // After each growth too: on a very tall screen the new end may already be near.
  useEffect(grow, [grow, height]);
  return (
    <section className="library-beyond" aria-label="Empty shelves">
      <p className="library-beyond-note">{empty ? 'No books yet. Write an entry and its book takes the first place on these shelves.' : 'Empty shelves, as far as you go, for everything you’ll write.'}</p>
      <div ref={end} className="library-void" style={{ height }}>
        {!empty && (
          <button type="button" className="btn btn-small library-back" onClick={goToNewest}>
            ↑ Back to your newest book
          </button>
        )}
      </div>
    </section>
  );
}
