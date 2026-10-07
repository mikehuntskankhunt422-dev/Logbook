import { pageLimits, type Product } from './products.ts';

/**
 * Extra inside margin by page count (L3 p.9). The guide's bands leave 60 uncovered and overlap at
 * 400; both resolve to the larger gutter, which is never wrong, just slightly wider (D22).
 */
export function gutterForPages(pages: number): number {
  if (pages < 60) return 0;
  if (pages <= 150) return 0.125;
  if (pages < 400) return 0.5;
  if (pages <= 600) return 0.625;
  return 0.75;
}

export interface PageCount {
  /** Content pages as laid out, before padding. */
  laidOut: number;
  /** Final page count sent to Lulu: even and at least the product minimum. */
  pages: number;
  /** Blank "Notes" pages appended to get there. */
  notesPages: number;
  /** Above the product maximum: the book must be split into volumes. */
  tooMany: boolean;
}

/** Lulu needs an even page count within the product's limits; we pad with Notes pages. */
export function padPageCount(laidOut: number, product: Product): PageCount {
  const { min, max } = pageLimits(product);
  let pages = Math.max(laidOut, min);
  if (pages % 2) pages++;
  return { laidOut, pages, notesPages: pages - laidOut, tooMany: pages > max };
}

export interface PaginationPlan extends PageCount {
  gutterIn: number;
  /** Layout passes it took; usually 1 or 2. */
  passes: number;
}

/** Five gutter bands and a monotonic layout mean the loop always settles within this many passes. */
const MAX_PASSES = 5;

/**
 * Gutter width depends on page count, and page count depends on gutter width. Lays the book out
 * until the gutter matches its band. If a smaller gutter pushes the book into a larger band and the
 * larger gutter pulls it back (oscillation at a band edge), the larger gutter wins.
 *
 * `layout` returns the number of laid-out content pages for a given gutter (inches).
 */
export async function planPagination(
  product: Product,
  layout: (gutterIn: number) => Promise<number>,
  estimatedPages = 0,
): Promise<PaginationPlan> {
  const tried = new Map<number, PageCount>();
  let gutterIn = gutterForPages(padPageCount(estimatedPages, product).pages);
  for (let passes = 1; passes <= MAX_PASSES; passes++) {
    const count = padPageCount(await layout(gutterIn), product);
    tried.set(gutterIn, count);
    const needed = gutterForPages(count.pages);
    if (needed === gutterIn || (needed < gutterIn && tried.has(needed))) return { ...count, gutterIn, passes };
    gutterIn = needed;
  }
  // Unreachable with a monotonic layout; fall back to the widest gutter that suits its own result.
  const valid = [...tried].filter(([g, c]) => gutterForPages(c.pages) <= g).sort(([a], [b]) => b - a);
  const best = valid[0];
  if (!best) throw new Error('Pagination did not settle on a gutter width.');
  return { ...best[1], gutterIn: best[0], passes: MAX_PASSES };
}

export interface EntryStart {
  date: string;
  /** 1-based page where the entry starts. */
  page: number;
}

export interface VolumeSuggestion {
  from: string;
  to: string;
  /** Approximate content pages in this volume. */
  pages: number;
}

/**
 * Splits a book that's over the page limit into date ranges that each fit, preferring to cut at
 * month boundaries. `reservePages` covers per-volume front matter and padding.
 */
export function suggestVolumes(starts: EntryStart[], totalPages: number, maxPages: number, reservePages = 16): VolumeSuggestion[] {
  const budget = maxPages - reservePages;
  if (!starts.length || budget <= 0) return [];
  const sized = starts.map((s, i) => ({ date: s.date, pages: (starts[i + 1]?.page ?? totalPages + 1) - s.page }));
  const volumes: VolumeSuggestion[] = [];
  let i = 0;
  while (i < sized.length) {
    let pages = 0;
    let end = i;
    while (end < sized.length && (end === i || pages + sized[end]!.pages <= budget)) pages += sized[end++]!.pages;
    // Prefer ending at a month boundary if that keeps the volume at least half full.
    if (end < sized.length) {
      for (let cut = end - 1; cut > i; cut--) {
        if (sized[cut]!.date.slice(0, 7) !== sized[cut - 1]!.date.slice(0, 7)) {
          const cutPages = sized.slice(i, cut).reduce((n, s) => n + s.pages, 0);
          if (cutPages >= budget / 2) {
            end = cut;
            pages = cutPages;
          }
          break;
        }
      }
    }
    volumes.push({ from: sized[i]!.date, to: sized[end - 1]!.date, pages });
    i = end;
  }
  return volumes;
}
