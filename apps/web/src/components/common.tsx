import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { GRADIENTS, computeStreak, entryPlainText, parseIsoDate, today, type Entry } from '@logbook/core';
import { useJournal, useMediaUrl } from '../app/journal-context.tsx';
import { href } from '../app/router.ts';
import { spring, useReducedMotion } from '../lib/motion.ts';

export function formatLongDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }): string {
  return parseIsoDate(iso).toLocaleDateString(undefined, opts);
}

/** Background + ink colour for an entry's cover (gradient, or photo with a legibility scrim). */
export function useCoverStyle(entry: Pick<Entry, 'cover'>): { style: CSSProperties; ink: 'light' | 'dark' } {
  const photoUrl = useMediaUrl(entry.cover.kind === 'photo' ? entry.cover.mediaId : null);
  if (entry.cover.kind === 'photo') {
    return {
      style: { backgroundImage: photoUrl ? `linear-gradient(180deg, rgb(0 0 0 / 0) 35%, rgb(0 0 0 / 0.6)), url("${photoUrl}")` : GRADIENTS.dusk.css },
      ink: 'light',
    };
  }
  const g = GRADIENTS[entry.cover.gradient];
  return { style: { backgroundImage: g.css }, ink: g.ink };
}

export function EntryCard({ entry, highlight }: { entry: Entry; highlight?: string[] }) {
  const { style, ink } = useCoverStyle(entry);
  const excerpt = useMemo(() => entryPlainText(entry).replace(/\s+/g, ' ').slice(0, 220), [entry]);
  const reduced = useReducedMotion();
  return (
    <motion.a
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring(reduced)}
      className="entry-card"
      href={href({ name: 'entry', id: entry.id })}
      aria-label={`${entry.title || 'Untitled entry'}, ${formatLongDate(entry.date)}`}
    >
      <div className="entry-cover" style={style} data-ink={ink}>
        {entry.mood && (
          <span className="mood" role="img" aria-label="mood">
            {entry.mood}
          </span>
        )}
        <span className="date-chip">{formatLongDate(entry.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      </div>
      <div className="entry-card-body">
        <h3 className="entry-card-title">{highlight ? <Highlight text={entry.title || 'Untitled'} terms={highlight} /> : entry.title || 'Untitled'}</h3>
        {excerpt && <p className="entry-card-excerpt">{highlight ? <Highlight text={excerpt} terms={highlight} /> : excerpt}</p>}
        {entry.tags.length > 0 && (
          <div className="tags">
            {entry.tags.slice(0, 5).map((t) => (
              <span className="tag" key={t}>
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.a>
  );
}

export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(re);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

export function useStreak() {
  const { entries } = useJournal();
  return useMemo(() => computeStreak(entries.map((e) => e.date), today()), [entries]);
}

export function StreakBadge() {
  const streak = useStreak();
  const reduced = useReducedMotion();
  const label = streak.current === 1 ? '1 day writing streak' : `${streak.current} day writing streak`;
  return (
    <motion.span
      key={streak.current}
      className="streak"
      data-cold={streak.current === 0}
      initial={reduced ? false : { scale: 0.6 }}
      animate={{ scale: 1 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 600, damping: 12 }}
      title={`Longest streak: ${streak.longest} days`}
    >
      <span aria-hidden="true">{streak.current > 0 ? '🔥' : '🪵'}</span>
      <span aria-hidden="true">{streak.current}</span>
      <span className="sr-only">{`${label}. Longest: ${streak.longest} days.`}</span>
    </motion.span>
  );
}

/** Native <dialog> with focus management and Escape handling from the browser. */
export function Dialog({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dialog-title">
      <h2 id="dialog-title">{title}</h2>
      {children}
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}
