import { z } from 'zod';
import { coverSchema, ISO_DATE, type Entry } from '../model.ts';
import { DEFAULT_PRODUCT, productSchema } from './products.ts';

export const bookSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('range'), from: z.string().regex(ISO_DATE), to: z.string().regex(ISO_DATE) }),
  z.object({ kind: z.literal('picked'), ids: z.array(z.string().min(1).max(64)).max(5000) }),
]);
export type BookSelection = z.infer<typeof bookSelectionSchema>;

/** Everything the builder decides about a book. No journal content beyond the chosen cover. */
export const bookOptionsSchema = z.object({
  title: z.string().max(120).default('My Logbook'),
  subtitle: z.string().max(200).default(''),
  author: z.string().max(120).default(''),
  /** Printed on the back cover. */
  backText: z.string().max(1000).default(''),
  selection: bookSelectionSchema.default({ kind: 'picked', ids: [] }),
  product: productSchema.default(DEFAULT_PRODUCT),
  cover: coverSchema.default({ kind: 'gradient', gradient: 'dusk' }),
  /** Defaults per D40: reads like a book; each can be switched off to save pages. */
  contents: z.boolean().default(true),
  monthDividers: z.boolean().default(true),
  entryStart: z.enum(['new-page', 'flow']).default('new-page'),
  /** Ignored at 80 pages or fewer (D23). */
  spineText: z.boolean().default(true),
});
export type BookOptions = z.infer<typeof bookOptionsSchema>;
export const DEFAULT_BOOK_OPTIONS: BookOptions = bookOptionsSchema.parse({});

/** The entries a selection covers, oldest first, never including trashed ones. */
export function selectEntries(entries: Entry[], selection: BookSelection): Entry[] {
  const live = entries.filter((e) => !e.deletedAt);
  const chosen =
    selection.kind === 'range'
      ? live.filter((e) => e.date >= selection.from && e.date <= selection.to)
      : ((ids) => live.filter((e) => ids.has(e.id)))(new Set(selection.ids));
  return chosen.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/*
 * Dates in the book are formatted here rather than with Intl, whose output differs between ICU
 * builds (Node vs. Safari vs. Chrome). Identical strings keep preview and server page counts equal.
 */

/** "Wednesday 7 October 2026" */
export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "October 2026" from "2026-10" or "2026-10-07" */
export function formatMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/** "7 Oct 2026" */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]!.slice(0, 3)} ${y}`;
}

/** "January – October 2026", "March 2025 – October 2026" or "7 October 2026" */
export function formatDateRange(from: string, to: string): string {
  if (from === to) return formatLongDate(from).replace(/^\S+ /, '');
  const [fy, fm] = from.split('-');
  const [ty, tm] = to.split('-');
  if (fy === ty && fm === tm) return formatMonth(from);
  if (fy === ty) return `${MONTHS[Number(fm) - 1]} – ${formatMonth(to)}`;
  return `${formatMonth(from)} – ${formatMonth(to)}`;
}
