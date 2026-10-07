import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { fontFile, PAGED_JS_PATH } from './assets.ts';

let browser: Promise<Browser> | undefined;

/** One Chromium per process, launched on first use. `LOGBOOK_CHROMIUM_PATH` overrides Playwright's build. */
export function getBrowser(): Promise<Browser> {
  browser ??= chromium.launch({ executablePath: process.env['LOGBOOK_CHROMIUM_PATH'] || undefined });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = undefined;
  if (b) await (await b).close();
}

export async function chromiumVersion(): Promise<string> {
  return (await getBrowser()).version();
}

/**
 * The origin every render page is served from. `.invalid` never resolves, so nothing can leak to a
 * real host even if routing were bypassed.
 */
export const RENDER_ORIGIN = 'http://render.invalid';

export interface RoutedPage {
  page: Page;
  context: BrowserContext;
  /** Requests that were refused: anything not served by this render (D41). */
  blocked: string[];
  /** Loads an HTML document as /index.html on the render origin. */
  show(html: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * A page in a fresh context where every request is answered by us: the document, Paged.js, the
 * print fonts and the files `media` returns. All other requests are aborted and recorded, so the
 * render browser never reaches the network on content's behalf. Paged.js also needs this: it
 * re-fetches stylesheets with XHR, which fails from file:// URLs.
 */
export async function openRoutedPage(media: (pathname: string) => string | undefined): Promise<RoutedPage> {
  const context = await (await getBrowser()).newContext({ javaScriptEnabled: true });
  const page = await context.newPage();
  const blocked: string[] = [];
  let html = '';
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== RENDER_ORIGIN) {
      blocked.push(url.href.slice(0, 200));
      return route.abort('blockedbyclient');
    }
    const path = decodeURIComponent(url.pathname);
    if (path === '/index.html') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
    const file = path === '/paged.js' ? PAGED_JS_PATH : path.startsWith('/fonts/') ? fontFile(path) : path.startsWith('/media/') ? media(path) : undefined;
    if (!file) {
      blocked.push(url.href.slice(0, 200));
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ body: await readFile(file), contentType: contentType(file) });
  });
  return {
    page,
    context,
    blocked,
    async show(next) {
      html = next;
      await page.goto(`${RENDER_ORIGIN}/index.html`, { waitUntil: 'load' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        const pending = [...document.images].filter((img) => !img.complete);
        await Promise.all(
          pending.map(
            (img) =>
              new Promise((done) => {
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
              }),
          ),
        );
      });
    },
    close: () => context.close(),
  };
}

function contentType(file: string): string {
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.woff')) return 'font/woff';
  if (file.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}
