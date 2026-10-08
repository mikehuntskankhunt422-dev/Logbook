import { gutterIn } from './geometry.ts';

export interface PagePlan {
  gutterIn: number;
  /** Pages the content fills (front matter included), as measured by the renderer. */
  contentPages: number;
  /** Blank "Notes" pages appended to reach an even count and the product minimum. */
  notesPages: number;
  totalPages: number;
  /** How many layouts were measured. */
  measurements: number;
}

export class PageCountError extends Error {
  override name = 'PageCountError';
  readonly pageCount: number;
  readonly maxPages: number;
  constructor(pageCount: number, maxPages: number) {
    super(`This book needs ${pageCount} pages, more than the ${maxPages} Lulu can bind. Split it into ${Math.ceil(pageCount / maxPages)} volumes.`);
    this.pageCount = pageCount;
    this.maxPages = maxPages;
  }
  get suggestedVolumes(): number {
    return Math.ceil(this.pageCount / this.maxPages);
  }
}

/** Even, and at least the product minimum (PLAN §1.4). */
export function paddedPageCount(contentPages: number, minPages: number): number {
  return Math.max(minPages, contentPages + (contentPages % 2));
}

/**
 * Gutter depends on page count and page count depends on the gutter. Measure the layout at a
 * gutter, look up the gutter the resulting total needs, and repeat until they agree, at most 3 times.
 * At a band edge the two can oscillate; the larger gutter is never wrong, so it wins (PLAN §1.4).
 *
 * `measure` lays the book out at a gutter and returns the content page count.
 */
export async function planPages(
  measure: (gutterIn: number) => Promise<number>,
  limits: { minPages: number; maxPages: number },
  estimatedPages = limits.minPages,
): Promise<PagePlan> {
  const measured = new Map<number, number>();
  const at = async (g: number) => {
    let n = measured.get(g);
    if (n === undefined) {
      n = await measure(g);
      if (!Number.isInteger(n) || n < 1) throw new RangeError(`Renderer reported ${n} pages`);
      measured.set(g, n);
    }
    return n;
  };
  const finish = (g: number, n: number): PagePlan => {
    const total = paddedPageCount(n, limits.minPages);
    if (total > limits.maxPages) throw new PageCountError(total, limits.maxPages);
    if (gutterIn(total) > g) throw new Error(`Page plan did not settle: ${total} pages need a ${gutterIn(total)}″ gutter, laid out at ${g}″`);
    return { gutterIn: g, contentPages: n, notesPages: total - n, totalPages: total, measurements: measured.size };
  };

  let g = gutterIn(paddedPageCount(estimatedPages, limits.minPages));
  for (let i = 0; i < 3; i++) {
    const n = await at(g);
    const next = gutterIn(paddedPageCount(n, limits.minPages));
    if (next === g) return finish(g, n);
    if (measured.has(next)) {
      const larger = Math.max(g, next);
      return finish(larger, await at(larger));
    }
    g = next;
  }
  const largest = Math.max(...measured.keys());
  return finish(largest, await at(largest));
}
