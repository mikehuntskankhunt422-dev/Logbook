import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { EXPORT_CSS, type Entry } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { href } from '../app/router.ts';
import { useReducedMotion } from '../lib/motion.ts';
import { readableEntry } from '../lib/reader.ts';
import { formatLongDate } from './common.tsx';

/**
 * An entry read like a book (D113): opened from the Library, its words laid out on pages that
 * turn, two at a time on a wide screen; or, from the storage room, a manila folder opened on the
 * desk, its details on the inside cover and its pages one by one. Arrow keys, Page Up and Down,
 * a swipe or a tap on either side turn the pages; Escape closes it.
 */
export function BookReader({ id, kind, onClose }: { id: string; kind: 'book' | 'folder'; onClose: () => void }) {
  const { journal } = useJournal();
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reduced = useReducedMotion();
  const [opened, setOpened] = useState<{ entry: Entry; html: string } | 'missing' | null>(null);
  const [layout, setLayout] = useState({ perView: 1, pages: 1, step: 0 });
  const [at, setAt] = useState(0);
  const [turning, setTurning] = useState<{ how: 'next' | 'back'; n: number } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  // A turn under way: where it's going, and its timers (a second turn takes over at once).
  const going = useRef<number | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  // The entry and its pictures, let go of when the reader closes.
  useEffect(() => {
    let alive = true;
    let release: (() => void) | undefined;
    readableEntry(journal, id).then(
      (r) => {
        if (!alive) return r?.release();
        release = r?.release;
        setOpened(r ? { entry: r.entry, html: r.html } : 'missing');
      },
      () => alive && setOpened('missing'),
    );
    return () => {
      alive = false;
      release?.();
    };
  }, [journal, id]);

  // Nothing stays open once the journal locks.
  useEffect(() => journal.subscribe((e) => e === 'lock' && journal.isLocked && onClose()), [journal, onClose]);

  /** Lays the words out in columns as tall as a page and counts the pages. */
  const measure = useCallback(() => {
    const v = viewport.current;
    const f = flow.current;
    if (!v || !f) return;
    const perView = kind === 'book' && v.clientWidth >= 640 ? 2 : 1;
    const gap = perView === 2 ? 72 : 40;
    f.style.columnCount = String(perView);
    f.style.columnGap = `${gap}px`;
    const page = (v.clientWidth - gap * (perView - 1)) / perView;
    const step = page + gap;
    const pages = Math.max(1, Math.round((f.scrollWidth + gap) / step));
    setLayout((l) => (l.perView === perView && l.pages === pages && l.step === step ? l : { perView, pages, step }));
    setAt((a) => Math.min(a - (a % perView), Math.max(0, pages - 1 - ((pages - 1) % perView))));
  }, [kind]);

  useLayoutEffect(() => {
    const f = flow.current;
    if (!f || !opened || opened === 'missing') return;
    f.innerHTML = `<div class="lbx">${opened.html}</div>`;
    // Web links open beside Logbook (the apps route them to the browser themselves).
    for (const a of f.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    measure();
    // Pictures change the pages as they arrive.
    const again = () => measure();
    f.addEventListener('load', again, true);
    const ro = new ResizeObserver(again);
    ro.observe(viewport.current!);
    return () => {
      f.removeEventListener('load', again, true);
      ro.disconnect();
    };
  }, [opened, measure]);

  const last = Math.max(0, layout.pages - 1 - ((layout.pages - 1) % layout.perView));
  const turn = useCallback(
    (to: number, how: 'next' | 'back') => {
      const target = Math.min(Math.max(0, to - (to % layout.perView)), last);
      if (target === (going.current ?? at)) return;
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
      if (reduced || kind === 'folder') {
        going.current = null;
        setTurning(null);
        setAt(target);
        return;
      }
      // The page turns over; what's under it changes halfway.
      going.current = target;
      setTurning((t) => ({ how, n: (t?.n ?? 0) + 1 }));
      timers.current.push(
        window.setTimeout(() => setAt(target), 220),
        window.setTimeout(() => {
          going.current = null;
          setTurning(null);
        }, 450),
      );
    },
    [at, last, layout.perView, reduced, kind],
  );
  const next = () => turn((going.current ?? at) + layout.perView, 'next');
  const back = () => turn((going.current ?? at) - layout.perView, 'back');

  // Keys turn the pages wherever the focus is (a button just disabled leaves it on the page).
  const keys = useRef<(e: globalThis.KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const on = e.target as HTMLElement;
    if (on.closest?.('input, textarea, select')) return;
    const moves: Record<string, () => void> = { ArrowRight: next, PageDown: next, ' ': next, ArrowLeft: back, PageUp: back, Home: () => turn(0, 'back'), End: () => turn(last, 'next') };
    const move = moves[e.key];
    if (move && !(e.key === ' ' && on.closest?.('button, a'))) {
      e.preventDefault();
      move();
    }
  };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => keys.current(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const onPointerDown = (e: PointerEvent) => (swipe.current = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: PointerEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from || (e.target as HTMLElement).closest('a')) return;
    const dx = e.clientX - from.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - from.y)) return dx < 0 ? next() : back();
    // A tap on a page's outer half turns it.
    if (Math.abs(dx) < 8 && viewport.current) {
      const box = viewport.current.getBoundingClientRect();
      if (e.clientX > box.left + box.width * 0.75) next();
      else if (e.clientX < box.left + box.width * 0.25) back();
    }
  };

  const entry = opened && opened !== 'missing' ? opened.entry : null;
  const title = entry ? entry.title.trim() || 'Untitled' : opened === 'missing' ? 'Not found' : 'Opening…';
  const shown = layout.perView === 2 && at + 1 < layout.pages ? `Pages ${at + 1}–${at + 2} of ${layout.pages}` : `Page ${at + 1} of ${layout.pages}`;

  return (
    <dialog ref={dialog} className={`reader reader-${kind}`} aria-labelledby={titleId} onClose={onClose}>
      <style>{EXPORT_CSS}</style>
      <div className="reader-top">
        <h2 id={titleId} className="reader-title">
          {kind === 'folder' ? '🗂️ ' : '📖 '}
          {title}
        </h2>
        {entry && (
          <a className="btn btn-small" href={href({ name: 'entry', id: entry.id })}>
            Open in the editor
          </a>
        )}
        <button type="button" className="btn btn-small" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
      {opened === 'missing' ? (
        <p className="reader-missing">This entry isn’t in your journal any more.</p>
      ) : (
        <div className="reader-body">
          {kind === 'folder' && entry && (
            <div className="reader-cover" aria-hidden="true">
              <p className="reader-label">{title}</p>
              <p className="reader-stamp">{formatLongDate(entry.date)}</p>
              {entry.mood && <p className="reader-mood">{entry.mood}</p>}
            </div>
          )}
          <div className="reader-paper" data-spread={layout.perView === 2 || undefined} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
            <div ref={viewport} className="reader-viewport">
              <div ref={flow} className="reader-flow" style={{ transform: `translateX(${-at * layout.step}px)` } as CSSProperties} />
            </div>
            {turning && <div key={turning.n} className={`reader-leaf reader-leaf-${turning.how}`} data-spread={layout.perView === 2 || undefined} aria-hidden="true" />}
            <span className="reader-folio reader-folio-left" aria-hidden="true">
              {at + 1}
            </span>
            {layout.perView === 2 && at + 1 < layout.pages && (
              <span className="reader-folio reader-folio-right" aria-hidden="true">
                {at + 2}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="reader-nav">
        <button type="button" className="btn btn-small" onClick={back} disabled={(going.current ?? at) === 0}>
          ‹ Previous page
        </button>
        <span className="reader-where" aria-live="polite">
          {opened && opened !== 'missing' ? shown : ''}
        </span>
        <button type="button" className="btn btn-small" onClick={next} disabled={(going.current ?? at) >= last} autoFocus>
          Next page ›
        </button>
      </div>
    </dialog>
  );
}
