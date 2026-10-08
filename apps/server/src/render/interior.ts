import {
  BLEED_IN,
  TRIMS,
  bookBodyHtml,
  bookDocument,
  planPagination,
  printCss,
  type BookOptions,
  type Entry,
  type MediaMeta,
  type PaginationPlan,
} from '@logbook/core';
import { FONT_LINKS } from './assets.ts';
import { chromiumVersion, openRoutedPage, type RoutedPage } from './browser.ts';
import { finishInterior } from './pdf.ts';

export interface InteriorSource {
  options: BookOptions;
  /** Selected and sorted (selectEntries). */
  entries: Entry[];
  meta(id: string): MediaMeta | undefined;
  /** Print-ready image files by media id (preparePrintImages). */
  images: Map<string, string>;
  audioPeaks?: Record<string, number[]>;
  /** Thumbnail files by YouTube/Vimeo video id (fetchEmbedThumbnail). */
  embedThumbnails?: Map<string, string>;
  printedOn: string;
}

export interface InteriorResult {
  pdf: Uint8Array;
  plan: PaginationPlan;
  chromium: string;
  /** Requests the render page tried to make that weren't ours. Expected to be empty. */
  blocked: string[];
  ms: number;
}

export class TooManyPagesError extends Error {
  constructor(readonly pages: number) {
    super(`The book needs ${pages} pages; Lulu prints at most 800. Split it into volumes.`);
    this.name = 'TooManyPagesError';
  }
}

const LAYOUT_TIMEOUT_MS = 10 * 60_000;

/**
 * Lays the book out with Paged.js until the gutter matches the page count (planPagination), then
 * renders the final pages, Notes padding included, to a PDF with exact page boxes.
 */
export async function renderInterior(src: InteriorSource): Promise<InteriorResult> {
  const started = Date.now();
  const files = new Map<string, string>();
  for (const [id, path] of src.images) files.set(`/media/${id}`, path);
  for (const [videoId, path] of src.embedThumbnails ?? []) files.set(`/media/embed-${videoId}`, path);

  const assets = {
    imageUrl: (id: string) => (src.images.has(id) ? `/media/${encodeURIComponent(id)}` : undefined),
    embedThumbnailUrl: (b: { videoId: string }) => (src.embedThumbnails?.has(b.videoId) ? `/media/embed-${encodeURIComponent(b.videoId)}` : undefined),
    audioPeaks: (id: string) => src.audioPeaks?.[id],
  };
  const doc = (gutter: number, notesPages: number) =>
    bookDocument({
      title: src.options.title,
      head: FONT_LINKS,
      css: printCss(src.options.product, gutter),
      body: bookBodyHtml({ options: src.options, entries: src.entries, meta: src.meta, assets, notesPages, printedOn: src.printedOn }),
    });

  const routed = await openRoutedPage((path) => files.get(path));
  try {
    const plan = await planPagination(src.options.product, (gutter) => paginate(routed, doc(gutter, 0)));
    if (plan.tooMany) throw new TooManyPagesError(plan.pages);
    const pages = await paginate(routed, doc(plan.gutterIn, plan.notesPages));
    if (pages !== plan.pages) throw new Error(`Final layout has ${pages} pages, planned ${plan.pages}.`);
    const raw = await routed.page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: false, outline: false });
    const t = TRIMS[src.options.product.trim];
    const pdf = await finishInterior(raw, { width: t.widthIn, height: t.heightIn }, BLEED_IN);
    return { pdf, plan, chromium: await chromiumVersion(), blocked: [...routed.blocked], ms: Date.now() - started };
  } finally {
    await routed.close();
  }
}

/** Loads a document, runs Paged.js over it and returns the page count. */
async function paginate(routed: RoutedPage, html: string): Promise<number> {
  await routed.show(html);
  await routed.page.evaluate(() => {
    (window as unknown as { PagedConfig: unknown }).PagedConfig = {
      auto: true,
      after: () => {
        (window as unknown as { __pagedDone: boolean }).__pagedDone = true;
      },
    };
  });
  await routed.page.addScriptTag({ url: '/paged.js' });
  await routed.page.waitForFunction(() => (window as unknown as { __pagedDone?: boolean }).__pagedDone === true, null, { timeout: LAYOUT_TIMEOUT_MS });
  return routed.page.evaluate(() => document.querySelectorAll('.pagedjs_page').length);
}
