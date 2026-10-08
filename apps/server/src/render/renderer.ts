import { chromium, type Browser, type BrowserContext, type Route } from 'playwright-core';
import { RENDER_ORIGIN, loadRenderAssets, type Asset, type RenderAssets } from './assets.ts';

export interface RenderedPdf {
  pages: number;
  pdf: Buffer | null;
  /** Requests refused because they left the render origin or asked for an unknown file. */
  blocked: string[];
}

/**
 * Headless Chromium that renders print HTML to PDF. Each render gets a fresh browser context whose
 * every request is answered from memory (fonts, Paged.js, the book's own images) or aborted, so a
 * book can never make the server fetch anything from the network.
 */
export class Renderer {
  readonly assets: RenderAssets;
  private readonly browser: Browser;

  private constructor(browser: Browser, assets: RenderAssets) {
    this.browser = browser;
    this.assets = assets;
  }

  static async launch(opts: { executablePath?: string } = {}): Promise<Renderer> {
    const [browser, assets] = await Promise.all([
      chromium.launch({ ...(opts.executablePath ? { executablePath: opts.executablePath } : {}), args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] }),
      loadRenderAssets(),
    ]);
    return new Renderer(browser, assets);
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  /** `<head>` content for a document Paged.js paginates. Fonts are kept away from Paged.js's stylesheet rewriting. */
  pagedHead(): string {
    return `<style data-pagedjs-ignore>${this.assets.fontCss}</style>
<script>window.PagedConfig = { auto: false };</script>
<script src="${RENDER_ORIGIN}/paged.polyfill.js"></script>`;
  }

  /** `<head>` content for a single-page document (the cover). */
  plainHead(): string {
    return `<style>${this.assets.fontCss}</style>`;
  }

  /** Paginates with Paged.js and returns the page count, plus the PDF when `pdf` is set. */
  async paginate(html: string, files: ReadonlyMap<string, Asset>, opts: { pdf: boolean }): Promise<RenderedPdf> {
    return this.withPage(html, files, async (page, blocked) => {
      const pages = await page.evaluate(async () => {
        await loadAllFonts();
        const flow = await (window as unknown as { PagedPolyfill: { preview(): Promise<{ total: number }> } }).PagedPolyfill.preview();
        await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
        return flow.total;

        async function loadAllFonts() {
          await Promise.all([...document.fonts].map((f) => f.load().catch(() => undefined)));
          await document.fonts.ready;
        }
      });
      const pdf = opts.pdf ? await page.pdf({ preferCSSPageSize: true, printBackground: true }) : null;
      return { pages, pdf, blocked };
    });
  }

  /** Prints a document as-is (no pagination step). */
  async print(html: string, files: ReadonlyMap<string, Asset>): Promise<Buffer> {
    return this.withPage(html, files, async (page) => {
      await page.evaluate(async () => {
        await Promise.all([...document.fonts].map((f) => f.load().catch(() => undefined)));
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
      });
      return page.pdf({ preferCSSPageSize: true, printBackground: true });
    });
  }

  private async withPage<T>(html: string, files: ReadonlyMap<string, Asset>, fn: (page: Awaited<ReturnType<BrowserContext['newPage']>>, blocked: string[]) => Promise<T>): Promise<T> {
    const context = await this.browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, bypassCSP: false });
    const blocked: string[] = [];
    const refuse = (route: Route, url: string) => {
      blocked.push(url);
      return route.abort('blockedbyclient');
    };
    try {
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (!url.startsWith(`${RENDER_ORIGIN}/`)) return refuse(route, url);
        const p = decodeURIComponent(new URL(url).pathname);
        if (p === '/book.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
        const asset = files.get(p) ?? this.assets.files.get(p);
        return asset ? route.fulfill({ status: 200, contentType: asset.contentType, body: asset.body }) : refuse(route, url);
      });
      // WebSockets don't go through route(); refuse them too.
      await context.routeWebSocket(/.*/, (ws) => {
        blocked.push(ws.url());
        return ws.close();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5 * 60_000);
      await page.goto(`${RENDER_ORIGIN}/book.html`, { waitUntil: 'load' });
      return await fn(page, blocked);
    } finally {
      await context.close();
    }
  }
}
