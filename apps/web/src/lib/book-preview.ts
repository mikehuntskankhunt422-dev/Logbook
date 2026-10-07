import pagedUrl from 'pagedjs-polyfill?url';
import {
  bookBodyHtml,
  bookDocument,
  coverHtml,
  coverLayout,
  estimateCoverDimensions,
  formatDateRange,
  planPagination,
  printCss,
  type BookOptions,
  type CoverDimensions,
  type CoverLayout,
  type Entry,
  type Journal,
  type MediaMeta,
  type PaginationPlan,
} from '@logbook/core';
import { printFontCss } from './print-fonts.ts';

/** Preview images are drawn at most this big; plenty for a page on screen, and far lighter than originals. */
const PREVIEW_EDGE = 1400;

/**
 * Downscaled copies of journal photos for the preview, flattened onto white like the print files.
 * Layout uses stored dimensions, never these pixels (D37), so the page count is unaffected.
 */
export class PreviewImages {
  private cache = new Map<string, Promise<string | undefined>>();

  constructor(private journal: Journal) {}

  url(id: string): Promise<string | undefined> {
    let p = this.cache.get(id);
    if (!p) {
      p = this.make(id);
      this.cache.set(id, p);
    }
    return p;
  }

  private async make(id: string): Promise<string | undefined> {
    const blob = await this.journal.getMediaBlob(id);
    if (!blob) return undefined;
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
    } catch {
      // No OffscreenCanvas, or a format the browser can't decode: show the original.
      return URL.createObjectURL(blob);
    }
  }

  /**
   * URLs for many images, prepared a few at a time: decoding runs off the main thread, so this is
   * several times faster than one by one on a book full of photos.
   */
  async urls(ids: string[], onProgress: (done: number) => void, concurrency = 4): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]!;
        const u = await this.url(id);
        if (u) out.set(id, u);
        onProgress(++done);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    return out;
  }

  dispose(): void {
    for (const p of this.cache.values()) void p.then((u) => u && URL.revokeObjectURL(u));
    this.cache.clear();
  }
}

export interface BookPreviewInput {
  options: BookOptions;
  entries: Entry[];
  meta(id: string): MediaMeta | undefined;
  /** Resolved preview image URLs by media id. */
  images: Map<string, string>;
  printedOn: string;
}

export class PreviewCancelled extends Error {
  constructor() {
    super('Preview cancelled');
    this.name = 'PreviewCancelled';
  }
}

/**
 * Shown around the laid-out pages: one spread (or one page on narrow screens) at a time. Other pages
 * are hidden with visibility, not display:none: Paged.js numbers pages with a CSS counter, and
 * undisplayed pages stop counting, which would restart the folios at 1.
 */
const VIEWER_CSS = `
@media screen {
  html, body { margin: 0; background: transparent; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; height: 100vh; }
  .pagedjs_pages { position: relative; display: flex !important; flex-direction: row; justify-content: center; transform-origin: center center; transform: scale(var(--lb-scale, 1)); }
  .pagedjs_page { position: absolute !important; left: 0; top: 0; visibility: hidden; margin: 0 !important; box-shadow: 0 2px 10px rgb(0 0 0 / 0.25); background: #ffffff; }
  .pagedjs_page.lb-show { position: relative !important; visibility: visible; }
}`;

/**
 * Lays a book out with Paged.js inside an iframe, using the same core HTML, stylesheet, fonts and
 * pagination loop as the server. The page count usually matches the PDF, but layout can shift by a
 * page or two between browser engines and even Chromium versions (the 8.5×11 sample is 42 pages in
 * Chromium 141 and 44 in 153), so it's an estimate: the customer approves the server's PDF (D9).
 */
export class BookPreview {
  private generation = 0;

  constructor(private frame: HTMLIFrameElement) {}

  cancel(): void {
    this.generation++;
    this.frame.srcdoc = '';
  }

  async render(input: BookPreviewInput, onProgress: (message: string) => void): Promise<PaginationPlan> {
    const gen = ++this.generation;
    const assets = { imageUrl: (id: string) => input.images.get(id) };
    const doc = (gutter: number, notesPages: number) =>
      bookDocument({
        title: input.options.title,
        css: `${printFontCss()}\n${printCss(input.options.product, gutter)}`,
        body: bookBodyHtml({ options: input.options, entries: input.entries, meta: input.meta, assets, notesPages, printedOn: input.printedOn }),
      });
    let pass = 0;
    const plan = await planPagination(input.options.product, async (gutter) => {
      onProgress(pass++ ? `Re-flowing pages for a wider inside margin (pass ${pass})…` : 'Laying out pages…');
      return this.paginate(doc(gutter, 0), gen);
    });
    if (plan.notesPages) {
      onProgress('Adding Notes pages…');
      const pages = await this.paginate(doc(plan.gutterIn, plan.notesPages), gen);
      if (pages !== plan.pages) throw new Error(`Preview has ${pages} pages, expected ${plan.pages}.`);
    }
    const d = this.frame.contentDocument!;
    const style = d.createElement('style');
    style.textContent = VIEWER_CSS;
    d.head.append(style);
    return plan;
  }

  /** Shows pages `first`..`first + count - 1` (1-based) scaled to fit the frame. */
  show(first: number, count: number): void {
    const d = this.frame.contentDocument;
    if (!d) return;
    const pages = [...d.querySelectorAll<HTMLElement>('.pagedjs_page')];
    pages.forEach((p, i) => p.classList.toggle('lb-show', i + 1 >= first && i + 1 < first + count));
    const one = pages[first - 1];
    if (!one?.offsetWidth) return;
    const pageW = one.offsetWidth;
    const pageH = one.offsetHeight;
    const scale = Math.min((this.frame.clientWidth - 24) / (pageW * count), (this.frame.clientHeight - 24) / pageH);
    d.documentElement.style.setProperty('--lb-scale', String(Math.max(0.1, scale)));
  }

  pageCount(): number {
    return this.frame.contentDocument?.querySelectorAll('.pagedjs_page').length ?? 0;
  }

  /** Loads a document into the frame, waits for Paged.js, returns the page count. */
  private paginate(html: string, gen: number): Promise<number> {
    if (gen !== this.generation) return Promise.reject(new PreviewCancelled());
    const token = `${gen}-${Math.random().toString(36).slice(2)}`;
    const t = JSON.stringify(token);
    // Reports completion, and any script error (a Paged.js failure would otherwise hang the preview).
    const boot =
      `<script>window.addEventListener('error',function(e){parent.postMessage({logbookPaged:${t},error:String(e.message||e.error||'error')},'*');});` +
      `window.addEventListener('unhandledrejection',function(e){parent.postMessage({logbookPaged:${t},error:String(e.reason&&e.reason.message||e.reason)},'*');});` +
      `window.PagedConfig={auto:true,after:function(){parent.postMessage({logbookPaged:${t}},'*');}};</script>` +
      `<script src="${pagedUrl}"></script>`;
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        const data = e.data as { logbookPaged?: string; error?: string } | null;
        if (e.source !== this.frame.contentWindow || data?.logbookPaged !== token) return;
        cleanup();
        if (gen !== this.generation) reject(new PreviewCancelled());
        else if (data.error) reject(new Error(`Page layout stopped: ${data.error}`));
        else resolve(this.pageCount());
      };
      const watchdog = setInterval(() => {
        if (gen !== this.generation) {
          cleanup();
          reject(new PreviewCancelled());
        }
      }, 250);
      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        clearInterval(watchdog);
      };
      window.addEventListener('message', onMessage);
      this.frame.srcdoc = html.replace('</head>', `${boot}</head>`);
    });
  }
}

/**
 * The cover for the preview, at Lulu's size when the API could ask (D39); otherwise at the offline
 * estimate, labelled approximate.
 */
export function coverPreviewDocument(
  options: BookOptions,
  entries: Entry[],
  pages: number,
  frontImageUrl: string | undefined,
  dims?: CoverDimensions | null,
): { html: string; layout: CoverLayout } {
  const layout = coverLayout(options.product, pages, dims ?? estimateCoverDimensions(options.product, pages), options.spineText, !dims);
  const range = entries.length ? formatDateRange(entries[0]!.date, entries.at(-1)!.date) : '';
  const { css, body } = coverHtml({ options, layout, dateRange: range, frontImageUrl });
  const fit = `@media screen { html { background: transparent; } body { box-shadow: 0 2px 10px rgb(0 0 0 / 0.25); } }`;
  return { html: bookDocument({ title: options.title, css: `${printFontCss()}\n${css}\n${fit}`, body }), layout };
}

/** Pages to show together: the first page alone on the right, then left/right spreads. */
export function spreadStarts(pages: number, single: boolean): number[] {
  if (single) return Array.from({ length: pages }, (_, i) => i + 1);
  const starts = [1];
  for (let p = 2; p <= pages; p += 2) starts.push(p);
  return starts;
}
