import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { EXPORT_CSS, letterSealed, type Entry } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { href } from '../app/router.ts';
import { useLibraryPrefs } from '../lib/library-prefs.ts';
import { useReducedMotion } from '../lib/motion.ts';
import { rustle } from '../lib/paper.ts';
import { readableEntry } from '../lib/reader.ts';
import { findSecret } from '../lib/secrets.ts';
import { formatLongDate } from './common.tsx';

/**
 * An entry read like a book (D113): opened from the Library, its words laid out on pages that
 * turn, two at a time on a wide screen; or, from the storage room, a manila folder opened on the
 * desk, its details on the inside cover and its pages one by one. Arrow keys, Page Up and Down,
 * a swipe or a tap on either side turn the pages; Escape closes it.
 *
 * Pages turn for real (D119): a book's leaf carries the words, this page on its front and the next
 * on its back, over the spine; a folder's sheet lifts over the top. A page can be dragged over
 * with a finger or the mouse, and let go to finish or fall back. With reduced motion, a fade.
 */

/** A turn under way: the leaf (built here, outside React) and how it ends. */
interface Turn {
  how: 'next' | 'back';
  from: number;
  to: number;
  leaf: HTMLElement;
  /** Turned degrees at the start and the end. */
  start: number;
  end: number;
  axis: 'X' | 'Y';
  animation: Animation | null;
  /** A drag that hasn't been let go yet. */
  held: boolean;
  /** Falling back to where it began. */
  undo: boolean;
}

/** Where a turn ends: where it began, while it's held or falling back. */
const dest = (t: Turn) => (t.held || t.undo ? t.from : t.to);

/** A sealed letter's only page (D122). */
function envelope(entry: Entry): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const day = (d: string) => esc(formatLongDate(d));
  return `<div class="lbx-entry"><h1 class="lbx-title">${esc(entry.title.trim() || 'A letter to your future self')}</h1><p class="lbx-meta">A letter to your future self, written ${day(entry.date)}</p></div><p class="quire-blank quire-last">📜 Sealed until ${day(entry.sealedUntil!)}. It opens by itself that day.</p>`;
}

const PAPER_SLOW = 560;
const PAPER_QUICK = 240;
/** Something that isn't one of your entries, read the same way (D119): Silas Quire's book. */
export interface Story {
  title: string;
  html: string;
}

export function BookReader({ id, kind, onClose, story }: { id: string; kind: 'book' | 'folder'; onClose: () => void; story?: Story }) {
  const { journal } = useJournal();
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reduced = useReducedMotion();
  const { paper: paperSounds } = useLibraryPrefs();
  const paper = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<{ entry: Entry | null; title: string; html: string } | 'missing' | null>(null);
  const [layout, setLayout] = useState({ perView: 1, pages: 1, step: 0 });
  const [at, setAt] = useState(0);
  /** The page the words show from while a turn goes back over a single page (else `at`). */
  const [under, setUnder] = useState<number | null>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const turn = useRef<Turn | null>(null);
  useEffect(() => () => turn.current?.animation?.cancel(), []);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  // The entry and its pictures, let go of when the reader closes.
  useEffect(() => {
    if (story) return setOpened({ entry: null, title: story.title, html: story.html });
    let alive = true;
    let release: (() => void) | undefined;
    readableEntry(journal, id).then(
      (r) => {
        if (!alive) return r?.release();
        release = r?.release;
        if (r && letterSealed(r.entry)) {
          // A letter to your future self, still sealed (D122): the envelope, not the words.
          r.release();
          release = undefined;
          return setOpened({ entry: r.entry, title: r.entry.title, html: envelope(r.entry) });
        }
        setOpened(r ? { entry: r.entry, title: r.entry.title, html: r.html } : 'missing');
      },
      () => alive && setOpened('missing'),
    );
    return () => {
      alive = false;
      release?.();
    };
  }, [journal, id, story]);

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

  /** Ends the turn under way at once, where it was going. */
  const settle = useCallback(() => {
    const t = turn.current;
    if (!t) return;
    turn.current = null;
    t.animation?.cancel();
    t.leaf.remove();
    stage.current?.replaceChildren();
    setUnder(null);
    setAt(dest(t));
  }, []);

  /** Page `n` of the words, laid out as in the reader, for a face of a leaf whose box is at (`x`, `y`) of the stage, showing it in `slot` (0: left or only, 1: right). */
  const face = useCallback(
    (n: number | null, box: { x: number; y: number; w: number; h: number }, slot: 0 | 1, side: string) => {
      const el = document.createElement('div');
      el.className = `reader-face ${side}`;
      const v = viewport.current;
      const f = flow.current;
      const s = stage.current;
      if (n === null || n >= layout.pages || !v || !f || !s) return el;
      const sr = s.getBoundingClientRect();
      const vr = v.getBoundingClientRect();
      const words = document.createElement('div');
      words.className = 'reader-face-flow';
      words.innerHTML = f.innerHTML;
      // What plays or links stays in the reader itself.
      for (const m of words.querySelectorAll('video, audio, iframe')) m.replaceWith(document.createElement('div'));
      Object.assign(words.style, {
        left: `${vr.left - sr.left - box.x + (slot - n) * layout.step}px`,
        top: `${vr.top - sr.top - box.y}px`,
        width: `${vr.width}px`,
        height: `${vr.height}px`,
        columnCount: f.style.columnCount,
        columnGap: f.style.columnGap,
      });
      el.append(words);
      return el;
    },
    [layout.pages, layout.step],
  );

  /** Builds the leaf for a turn from `from` to `to`, not yet turned; null where nothing can turn. */
  const begin = useCallback(
    (from: number, to: number, how: 'next' | 'back'): Turn | null => {
      const s = stage.current;
      const p = paper.current;
      const v = viewport.current;
      if (!s || !p || !v) return null;
      const sr = s.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      const vr = v.getBoundingClientRect();
      const box = { x: pr.left - sr.left, y: pr.top - sr.top, w: pr.width, h: pr.height };
      const leaf = document.createElement('div');
      leaf.className = `reader-leaf reader-leaf-${how}`;
      const place = (el: HTMLElement, b: typeof box) => Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      let t: Pick<Turn, 'start' | 'end' | 'axis'>;
      if (kind === 'folder') {
        // A sheet lifts over the top of the folder, or comes back down onto it.
        place(leaf, box);
        leaf.style.transformOrigin = 'center top';
        const page = face(how === 'next' ? from : to, box, 0, 'reader-face-front');
        leaf.append(page, Object.assign(document.createElement('div'), { className: 'reader-face reader-face-back reader-face-x' }));
        t = how === 'next' ? { start: 0, end: 178, axis: 'X' } : { start: 178, end: 0, axis: 'X' };
        setUnder(how === 'next' ? to : from);
      } else if (layout.perView === 1) {
        // One page: it turns over its left edge, or comes back over it.
        place(leaf, box);
        leaf.style.transformOrigin = 'left center';
        leaf.append(face(how === 'next' ? from : to, box, 0, 'reader-face-front'), Object.assign(document.createElement('div'), { className: 'reader-face reader-face-back' }));
        t = how === 'next' ? { start: 0, end: -178, axis: 'Y' } : { start: -178, end: 0, axis: 'Y' };
        setUnder(how === 'next' ? to : from);
      } else {
        // Two pages: the leaf turns over the spine, the words on both its sides; what it uncovers
        // is already there, and what it hasn't yet passed stays as it was until it does.
        const spine = vr.left - sr.left + vr.width / 2;
        const left = { x: box.x, y: box.y, w: spine - box.x, h: box.h };
        const right = { x: spine, y: box.y, w: box.x + box.w - spine, h: box.h };
        const stays = how === 'next' ? face(from, left, 0, 'reader-face-held reader-face-l') : face(from + 1, right, 1, 'reader-face-held reader-face-r');
        place(stays, how === 'next' ? left : right);
        s.append(stays);
        if (how === 'next') {
          place(leaf, right);
          leaf.style.transformOrigin = 'left center';
          leaf.append(face(from + 1, right, 1, 'reader-face-front reader-face-r'), face(to, { ...right, x: right.x - right.w }, 0, 'reader-face-back reader-face-l'));
          t = { start: 0, end: -180, axis: 'Y' };
        } else {
          place(leaf, left);
          leaf.style.transformOrigin = 'right center';
          leaf.append(face(from, left, 0, 'reader-face-front reader-face-l'), face(to + 1, { ...left, x: left.x + left.w }, 1, 'reader-face-back reader-face-r'));
          t = { start: 0, end: 180, axis: 'Y' };
        }
        setUnder(to);
      }
      leaf.style.transform = `rotate${t.axis}(${t.start}deg)`;
      s.append(leaf);
      return { ...t, how, from, to, leaf, animation: null, held: false, undo: false };
    },
    [face, kind, layout.perView],
  );

  /** Turns the leaf on from where it is to its end (or back to its start, `undo`), and settles. */
  const run = useCallback(
    (t: Turn, at: number, undo: boolean, ms: number) => {
      t.undo = undo;
      const goal = undo ? t.start : t.end;
      const fade = t.axis === 'X' || layout.perView === 1;
      // A single page or a folder's sheet leaves the paper: it fades as it goes, and comes back
      // out of nothing.
      const opacity = (deg: number) => (fade ? Math.max(0, Math.min(1, 1 - (Math.abs(deg) - 110) / 60)) : 1);
      t.animation = t.leaf.animate(
        [
          { transform: `rotate${t.axis}(${at}deg)`, opacity: opacity(at) },
          { transform: `rotate${t.axis}(${(at + goal) / 2}deg)`, opacity: opacity((at + goal) / 2) },
          { transform: `rotate${t.axis}(${goal}deg)`, opacity: opacity(goal) },
        ],
        { duration: ms, easing: 'ease-in-out', fill: 'forwards' },
      );
      t.animation.finished.then(
        () => turn.current === t && settle(),
        () => undefined,
      );
    },
    [layout.perView, settle],
  );

  /** Where the reader is, or is going. */
  const going = () => (turn.current ? dest(turn.current) : at);
  const go = useCallback(
    (to: number, how: 'next' | 'back', quick = false) => {
      const from = turn.current ? dest(turn.current) : at;
      const target = Math.min(Math.max(0, to - (to % layout.perView)), last);
      if (target === from) return;
      // A turn under way finishes at once: the next takes over, quicker.
      const busy = turn.current !== null;
      settle();
      if (paperSounds) rustle(quick || busy);
      if (reduced) {
        setAt(target);
        viewport.current?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
        return;
      }
      const t = begin(from, target, how);
      if (!t) return setAt(target);
      turn.current = t;
      setAt(target);
      run(t, t.start, false, quick || busy ? PAPER_QUICK : PAPER_SLOW);
    },
    [at, last, layout.perView, reduced, paperSounds, settle, begin, run],
  );

  // A secret (D115): a book (or a folder) of four pages or more read to its last.
  const ready = opened !== null && opened !== 'missing';
  useEffect(() => {
    // (Your own books: Silas Quire's doesn't count, D119.)
    if (ready && !story && layout.pages >= 4 && at >= last) findSecret('bookworm');
  }, [ready, story, layout.pages, at, last]);
  const next = (quick = false) => go(going() + layout.perView, 'next', quick);
  const back = (quick = false) => go(going() - layout.perView, 'back', quick);

  // Keys turn the pages wherever the focus is (a button just disabled leaves it on the page).
  const keys = useRef<(e: globalThis.KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const on = e.target as HTMLElement;
    if (on.closest?.('input, textarea, select')) return;
    // Held down, the pages riffle.
    const moves: Record<string, () => void> = {
      ArrowRight: () => next(e.repeat),
      PageDown: () => next(e.repeat),
      ' ': () => next(e.repeat),
      ArrowLeft: () => back(e.repeat),
      PageUp: () => back(e.repeat),
      Home: () => go(0, 'back'),
      End: () => go(last, 'next'),
    };
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
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('a')) return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  // Dragged sideways, the page comes with the finger (or the mouse) and turns as far as it's taken.
  const onPointerMove = (e: PointerEvent) => {
    const from = swipe.current;
    if (!from || from.id !== e.pointerId || reduced) return;
    const dx = e.clientX - from.x;
    let t = turn.current;
    if (!t || !t.held) {
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(e.clientY - from.y)) return;
      const how = dx < 0 ? 'next' : 'back';
      const start = going();
      const to = how === 'next' ? start + layout.perView : start - layout.perView;
      if (to < 0 || to > last) return;
      settle();
      t = begin(start, to, how);
      if (!t) return;
      t.held = true;
      turn.current = t;
      // A page, not the words on it: nothing selected, nothing dragged away.
      window.getSelection()?.removeAllRanges();
      paper.current?.setAttribute('data-dragging', '');
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    const width = paper.current?.clientWidth ?? 1;
    const share = Math.max(0, Math.min(1, (t.how === 'next' ? -dx : dx) / (width * (layout.perView === 2 ? 0.9 : 0.8))));
    const deg = t.start + (t.end - t.start) * share;
    t.leaf.style.transform = `rotate${t.axis}(${deg}deg)`;
    if (t.axis === 'X' || layout.perView === 1) t.leaf.style.opacity = String(Math.max(0, Math.min(1, 1 - (Math.abs(deg) - 110) / 60)));
  };
  const onPointerUp = (e: PointerEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from || from.id !== e.pointerId) return;
    const dx = e.clientX - from.x;
    const t = turn.current;
    paper.current?.removeAttribute('data-dragging');
    if (t?.held) {
      // Let go: past a third of the way it turns over; short of it, it falls back.
      t.held = false;
      const now = Number(/-?[\d.]+/.exec(t.leaf.style.transform)?.[0] ?? t.start);
      const share = (now - t.start) / (t.end - t.start);
      const undo = share < 0.33;
      if (!undo) {
        setAt(t.to);
        if (paperSounds) rustle();
      }
      run(t, now, undo, Math.max(120, PAPER_SLOW * (undo ? share : 1 - share)));
      return;
    }
    if ((e.target as HTMLElement).closest('a')) return;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - from.y)) return dx < 0 ? next() : back();
    // A tap on a page's outer half turns it.
    if (Math.abs(dx) < 8 && viewport.current) {
      const box = viewport.current.getBoundingClientRect();
      if (e.clientX > box.left + box.width * 0.75) next();
      else if (e.clientX < box.left + box.width * 0.25) back();
    }
  };
  const onPointerCancel = () => {
    swipe.current = null;
    paper.current?.removeAttribute('data-dragging');
    const t = turn.current;
    if (t?.held) {
      t.held = false;
      run(t, Number(/-?[\d.]+/.exec(t.leaf.style.transform)?.[0] ?? t.start), true, 160);
    }
  };

  const entry = opened && opened !== 'missing' ? opened.entry : null;
  const title = opened && opened !== 'missing' ? opened.title.trim() || 'Untitled' : opened === 'missing' ? 'Not found' : 'Opening…';
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
          <div ref={stage} className="reader-stage" aria-hidden="true" inert />
          {kind === 'folder' && entry && (
            <div className="reader-cover" aria-hidden="true">
              <p className="reader-label">{title}</p>
              <p className="reader-stamp">{formatLongDate(entry.date)}</p>
              {entry.mood && <p className="reader-mood">{entry.mood}</p>}
            </div>
          )}
          <div
            ref={paper}
            className="reader-paper"
            data-spread={layout.perView === 2 || undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onDragStart={(e) => e.preventDefault()}
          >
            <div ref={viewport} className="reader-viewport">
              <div ref={flow} className="reader-flow" style={{ transform: `translateX(${-(under ?? at) * layout.step}px)` } as CSSProperties} />
            </div>
            <span className="reader-folio reader-folio-left" aria-hidden="true">
              {(under ?? at) + 1}
            </span>
            {layout.perView === 2 && (under ?? at) + 1 < layout.pages && (
              <span className="reader-folio reader-folio-right" aria-hidden="true">
                {(under ?? at) + 2}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="reader-nav">
        <button type="button" className="btn btn-small" onClick={() => back()} disabled={at === 0}>
          ‹ Previous page
        </button>
        <span className="reader-where" aria-live="polite">
          {opened && opened !== 'missing' ? shown : ''}
        </span>
        <button type="button" className="btn btn-small" onClick={() => next()} disabled={at >= last} autoFocus>
          Next page ›
        </button>
      </div>
    </dialog>
  );
}
