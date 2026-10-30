/**
 * Your own apps (D111): a page of code, pasted in or from a file, that runs inside Logbook walled
 * off from the journal (apps/web/src/lib/apps.ts says how). Kept in the journal as media, so they
 * go with it to other computers and into backups, locked with its passcode: the code as one item,
 * and what the app saves (its localStorage) as another, `<app id>data`.
 */

/** An app's id starts so, so apps are found without reading every photo's details (like fonts). */
export const APP_ID_PREFIX = 'app';
export const APP_NAME_MAX = 60;
/** The most code an app can have: far more than any page of it. */
export const APP_MAX_CODE = 5 * 1024 * 1024;
/** The most an app can save, as in a browser's own localStorage. */
export const APP_MAX_DATA = 5 * 1024 * 1024;

/** A whole web page or a piece of one; plain JavaScript; or a React component, which needs building first. */
export type AppCodeKind = 'html' | 'script' | 'react';

/** What an app saves, as its localStorage had it. */
export type AppItems = Record<string, string>;

/** The id of the item an app's saved things are kept in. */
export function appDataId(appId: string): string {
  return `${appId}data`;
}

export function cleanAppName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, APP_NAME_MAX).trim() || 'My app';
}

/** What kind of code this is: anything starting with a tag is a page. */
export function appCodeKind(code: string): AppCodeKind {
  const text = code.replace(/^\uFEFF/, '').trimStart();
  if (text.startsWith('<')) return 'html';
  if (/^\s*import\s+React\b|\bfrom\s+['"]react['"]|\brequire\(\s*['"]react['"]\s*\)/m.test(text) || /\breturn\s*\(?\s*<[A-Za-z]/.test(text)) return 'react';
  if (/<\/?(html|head|body|div|script|style|canvas|svg|main|section|button|h[1-6]|p|span|ul|ol|table|form|input|label|img|a)\b[^>]*>/i.test(text)) return 'html';
  return 'script';
}

/** A name for new code: its page's title, else the file's name, else "My app". */
export function appNameFrom(code: string, fileName = ''): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(code)?.[1];
  const decoded = title
    ?.replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
  return cleanAppName(decoded || fileName.replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' '));
}

/** How much room saved things take, as a browser counts localStorage (characters of keys and values). */
export function appItemsSize(items: AppItems): number {
  let size = 0;
  for (const [k, v] of Object.entries(items)) size += k.length + v.length;
  return size;
}

/** Saved things as the journal keeps them, or undefined if they aren't (strings only). */
export function isAppItems(value: unknown): value is AppItems {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'string');
}

/**
 * A message from an app's frame: what it now keeps (its whole localStorage), checked before anything
 * is saved. 'too-big' when it's over the limit; undefined when it isn't one of these.
 */
export function readAppMessage(data: unknown): AppItems | 'too-big' | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const msg = data as { logbookApp?: unknown; kind?: unknown; items?: unknown };
  if (msg.logbookApp !== 1 || msg.kind !== 'storage' || !isAppItems(msg.items)) return undefined;
  const items: AppItems = { ...msg.items };
  return appItemsSize(items) > APP_MAX_DATA ? 'too-big' : items;
}

/** JSON that can sit in a script element: no `</script>`, no HTML comment. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Runs first in an app's frame. The frame has an origin of its own, with no storage, so this gives
 * it a localStorage that starts with what it saved before and hands its changes to Logbook to keep
 * (all of it, once the code making them has run), and a sessionStorage that lasts while it's open.
 */
const SHIM = `(function () {
  var saved = JSON.parse(__SAVED__);
  var timer = 0;
  function send(items) {
    clearTimeout(timer);
    timer = 0;
    parent.postMessage({ logbookApp: 1, kind: 'storage', items: Object.fromEntries(items) }, '*');
  }
  function storage(map, kept) {
    function changed() {
      if (!kept) return;
      clearTimeout(timer);
      timer = setTimeout(function () { send(map); }, 0);
    }
    var api = {
      get length() { return map.size; },
      key: function (i) { var keys = Array.from(map.keys()); return i >= 0 && i < keys.length ? keys[i] : null; },
      getItem: function (k) { k = String(k); return map.has(k) ? map.get(k) : null; },
      setItem: function (k, v) { map.set(String(k), String(v)); changed(); },
      removeItem: function (k) { if (map.delete(String(k))) changed(); },
      clear: function () { if (map.size) { map.clear(); changed(); } }
    };
    // localStorage.score = 3 and Object.keys(localStorage) work as in a browser.
    return new Proxy(api, {
      get: function (t, p) { return typeof p === 'string' && !(p in t) ? (map.has(p) ? map.get(p) : undefined) : t[p]; },
      set: function (t, p, v) { if (typeof p !== 'string' || p in t) return false; t.setItem(p, v); return true; },
      deleteProperty: function (t, p) { if (typeof p === 'string' && !(p in t)) t.removeItem(p); return true; },
      has: function (t, p) { return p in t || map.has(p); },
      ownKeys: function () { return Array.from(map.keys()); },
      getOwnPropertyDescriptor: function (t, p) { return map.has(p) ? { value: map.get(p), writable: true, enumerable: true, configurable: true } : undefined; }
    });
  }
  var local = new Map(Object.entries(saved));
  try { Object.defineProperty(window, 'localStorage', { value: storage(local, true), configurable: true, enumerable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: storage(new Map(), false), configurable: true, enumerable: true }); } catch (e) {}
  addEventListener('pagehide', function () { if (timer) send(local); });
})();`;

/** The page an app's frame shows: its code, with Logbook's storage for it first. */
export function appDocument(code: string, saved: AppItems = {}): string {
  const shim = `<script>${SHIM.replace('__SAVED__', () => scriptJson(JSON.stringify(saved)))}</script>`;
  if (appCodeKind(code) === 'html') {
    // After the doctype, so the page keeps its standards mode.
    const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(code)?.[0] ?? '';
    return doctype + shim + code.slice(doctype.length);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${shim}</head><body><script>${code.replace(/<\/(script)/gi, '<\\/$1')}</script></body></html>`;
}
