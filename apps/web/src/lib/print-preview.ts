import { PRINT_FONT_STYLESHEETS, standaloneHtml, type PrintDocument } from '@logbook/core';

/**
 * The browser side of the print pipeline: the same HTML, print CSS, static fonts and Paged.js build
 * the render server uses, paginated inside an iframe. Assets load on first use (they're not in the
 * service worker's precache) and are cached at runtime after that.
 */

type Sheet = (typeof PRINT_FONT_STYLESHEETS)[number];
/** Keyed by core's list, so TypeScript fails the build if the preview and the server load different fonts. */
const FONT_SHEETS: Record<Sheet, () => Promise<{ default: string }>> = {
  '@fontsource/newsreader/400.css': () => import('@fontsource/newsreader/400.css?inline'),
  '@fontsource/newsreader/400-italic.css': () => import('@fontsource/newsreader/400-italic.css?inline'),
  '@fontsource/newsreader/600.css': () => import('@fontsource/newsreader/600.css?inline'),
  '@fontsource/newsreader/600-italic.css': () => import('@fontsource/newsreader/600-italic.css?inline'),
  '@fontsource/newsreader/700.css': () => import('@fontsource/newsreader/700.css?inline'),
  '@fontsource/newsreader/700-italic.css': () => import('@fontsource/newsreader/700-italic.css?inline'),
  '@fontsource/bricolage-grotesque/400.css': () => import('@fontsource/bricolage-grotesque/400.css?inline'),
  '@fontsource/bricolage-grotesque/600.css': () => import('@fontsource/bricolage-grotesque/600.css?inline'),
  '@fontsource/bricolage-grotesque/700.css': () => import('@fontsource/bricolage-grotesque/700.css?inline'),
  '@fontsource/bricolage-grotesque/800.css': () => import('@fontsource/bricolage-grotesque/800.css?inline'),
  '@fontsource/noto-emoji/400.css': () => import('@fontsource/noto-emoji/400.css?inline'),
};

interface PrintAssets {
  fontCss: string;
  pagedUrl: string;
}

let assets: Promise<PrintAssets> | null = null;

export function loadPrintAssets(): Promise<PrintAssets> {
  assets ??= Promise.all([Promise.all(PRINT_FONT_STYLESHEETS.map((s) => FONT_SHEETS[s]().then((m) => m.default))), import('pagedjs-polyfill?url')])
    .then(([sheets, paged]) => ({
      // Same treatment as the server: never lay out with a fallback font.
      fontCss: sheets.join('\n').replace(/font-display:\s*swap;/g, 'font-display: block;'),
      pagedUrl: new URL(paged.default, location.href).href,
    }))
    .catch((err: unknown) => {
      assets = null;
      throw err;
    });
  return assets;
}

/** Scripts and fonts from this app only, images from object URLs, nothing else. */
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'self' data:; img-src blob: data:";

/** Screen-only styling for the preview: pages as spreads on a desk-coloured background. Never printed. */
const SCREEN_CSS = `
html { background: #d9d2c7; }
body { margin: 0; }
.pagedjs_pages { display: grid; grid-template-columns: repeat(2, max-content); justify-content: center; row-gap: 28px; padding: 24px 12px 40px; }
html[data-single] .pagedjs_pages { grid-template-columns: max-content; }
.pagedjs_page { background: #ffffff; box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), 0 6px 18px rgb(0 0 0 / 0.12); }
html:not([data-single]) .pagedjs_first_page { grid-column: 2; }
.sheet { margin: 12px auto; box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), 0 6px 18px rgb(0 0 0 / 0.12); }
`;

export class SupersededError extends Error {
  override name = 'SupersededError';
}

/**
 * Lays out print documents in one iframe. A newer render supersedes an older one; the older call
 * rejects with SupersededError instead of reporting a stale page count.
 */
export class PreviewFrame {
  private generation = 0;
  private readonly iframe: HTMLIFrameElement;

  constructor(iframe: HTMLIFrameElement) {
    this.iframe = iframe;
  }

  /** Paginates with Paged.js and returns the page count. */
  async paginate(doc: PrintDocument, view: { zoom: number; single: boolean }): Promise<number> {
    const my = ++this.generation;
    const { fontCss, pagedUrl } = await loadPrintAssets();
    const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style data-pagedjs-ignore>${fontCss}</style>
<style data-pagedjs-ignore media="screen">${SCREEN_CSS}</style>
<script>window.PagedConfig = { auto: false };</script>
<script src="${pagedUrl}"></script>`;
    const win = await this.load(standaloneHtml(doc, head), my);
    await Promise.all([...win.document.fonts].map((f) => f.load().catch(() => undefined)));
    this.check(my);
    const flow = await (win as Window & { PagedPolyfill: { preview(): Promise<{ total: number }> } }).PagedPolyfill.preview();
    this.check(my);
    // Zoom only after layout: Paged.js measures boxes, and a zoomed document would break pages differently from the server.
    this.applyView(view);
    return flow.total;
  }

  /** Shows a single-page document (the cover) as is. */
  async show(doc: PrintDocument, zoom: number): Promise<void> {
    const my = ++this.generation;
    const { fontCss } = await loadPrintAssets();
    await this.load(standaloneHtml(doc, `<meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${fontCss}</style><style media="screen">${SCREEN_CSS}</style>`), my);
    this.applyView({ zoom, single: true });
  }

  applyView(view: { zoom: number; single: boolean }): void {
    const root = this.iframe.contentDocument?.documentElement;
    if (!root) return;
    root.style.zoom = String(view.zoom);
    root.toggleAttribute('data-single', view.single);
  }

  pageCount(): number {
    return this.iframe.contentDocument?.querySelectorAll('.pagedjs_page').length ?? 0;
  }

  /** Scrolls the preview so page `index` (0-based) is at the top. */
  scrollToPage(index: number): void {
    const page = this.iframe.contentDocument?.querySelectorAll<HTMLElement>('.pagedjs_page')[index];
    page?.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
  }

  /** The first page whose top is in view, for the page indicator. */
  firstVisiblePage(): number {
    const doc = this.iframe.contentDocument;
    if (!doc) return 0;
    const pages = doc.querySelectorAll<HTMLElement>('.pagedjs_page');
    for (let i = 0; i < pages.length; i++) if (pages[i]!.getBoundingClientRect().bottom > 40) return i;
    return 0;
  }

  private load(html: string, my: number): Promise<Window> {
    return new Promise((resolve, reject) => {
      this.iframe.addEventListener(
        'load',
        () => {
          if (my !== this.generation) return reject(new SupersededError());
          resolve(this.iframe.contentWindow!);
        },
        { once: true },
      );
      this.iframe.srcdoc = html;
    });
  }

  private check(my: number): void {
    if (my !== this.generation) throw new SupersededError();
  }
}

const PREVIEW_MAX_EDGE = 1600;

/**
 * A screen-resolution copy of a photo for the preview, flattened onto white like the print copy.
 * Keeps memory flat when a book holds hundreds of full-size photos.
 */
export async function previewImage(blob: Blob): Promise<Blob> {
  if (blob.size < 400_000 || typeof OffscreenCanvas === 'undefined') return blob;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob;
  }
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}
