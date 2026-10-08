import { z } from 'zod';
import { GRADIENT_IDS, ISO_DATE, type Entry, type GradientId } from '../model.ts';
import { DEFAULT_PRODUCT, productSchema } from './products.ts';

const isoDate = z.string().regex(ISO_DATE);

export const bookCoverSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gradient'), gradient: z.enum(GRADIENT_IDS as [GradientId, ...GradientId[]]) }),
  z.object({ kind: z.literal('photo'), mediaId: z.string().min(1).max(64) }),
]);
export type BookCover = z.infer<typeof bookCoverSchema>;

/** Everything the builder decides. The server renders from exactly this, so preview and PDF agree. */
export const bookOptionsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(200).default(''),
  author: z.string().trim().max(120).default(''),
  /** Inclusive date range; null means unbounded. */
  from: isoDate.nullable().default(null),
  to: isoDate.nullable().default(null),
  /** Only entries with at least one of these tags; empty means all. */
  tags: z.array(z.string().min(1).max(40)).max(50).default([]),
  excludeIds: z.array(z.string().min(1).max(64)).max(10_000).default([]),
  contents: z.boolean().default(true),
  spineText: z.boolean().default(true),
  product: productSchema.default(DEFAULT_PRODUCT),
  cover: bookCoverSchema.default({ kind: 'gradient', gradient: 'sunrise' }),
  /** BCP 47 tag for dates in the book, fixed at build time so the server formats them the same way. */
  locale: z.string().min(2).max(35).default('en-AU'),
});
export type BookOptions = z.infer<typeof bookOptionsSchema>;

/** Entries a book contains: not deleted, inside the date range, matching a tag, not excluded; oldest first. */
export function selectEntries(entries: readonly Entry[], opts: Pick<BookOptions, 'from' | 'to' | 'tags' | 'excludeIds'>): Entry[] {
  const excluded = new Set(opts.excludeIds);
  const tags = new Set(opts.tags);
  return entries
    .filter(
      (e) =>
        !e.deletedAt &&
        !excluded.has(e.id) &&
        (!opts.from || e.date >= opts.from) &&
        (!opts.to || e.date <= opts.to) &&
        (tags.size === 0 || e.tags.some((t) => tags.has(t))),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function formatPrintDate(iso: string, locale: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }): string {
  // Noon UTC formatted in UTC: the calendar date never shifts with the renderer's time zone.
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(safeLocale(locale), { ...opts, timeZone: 'UTC' });
}

/** "March 2025 – October 2026", "October 2026", or "" for an empty book. */
export function dateRangeLabel(entries: readonly Pick<Entry, 'date'>[], locale: string): string {
  if (entries.length === 0) return '';
  const dates = entries.map((e) => e.date).sort();
  const fmt = (d: string) => formatPrintDate(d, locale, { month: 'long', year: 'numeric' });
  const first = fmt(dates[0]!);
  const last = fmt(dates.at(-1)!);
  return first === last ? first : `${first} – ${last}`;
}

function safeLocale(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale])[0] ?? 'en-AU';
  } catch {
    return 'en-AU';
  }
}
