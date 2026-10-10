// Drives the built desktop app through WebDriver (tauri-driver + WebKitWebDriver, Linux only):
// first run in an empty home folder, the default journal folder, an entry with a photo, the files
// that appear on disk, the journal after a restart, and an entry typed just before the window closes.
//
//   npx tauri build --debug --no-bundle            (in apps/desktop)
//   xvfb-run npm run test:e2e [-- path to the app]  (needs tauri-driver and WebKitWebDriver on PATH, and python3-xlib)
//
// No test framework: plain WebDriver calls over fetch, so nothing else needs installing.

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const APP = resolve(process.argv[2] ?? new URL('../src-tauri/target/debug/logbook', import.meta.url).pathname);
const DRIVER = 'http://127.0.0.1:4444';

const home = await mkdtemp(join(tmpdir(), 'logbook-desktop-e2e-'));
// The app's config, documents and webview data all live under this home, so the run starts fresh.
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache') };
const driver = spawn('tauri-driver', ['--port', '4444'], { env, stdio: ['ignore', 'inherit', 'inherit'] });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;
let lastSession: string | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- WebDriver's JSON answers
async function wd(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${DRIVER}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json.value ?? json).slice(0, 300)}`);
  return json.value;
}

async function until<T>(what: string, fn: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: Error | undefined;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      last = err as Error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const find = (s: string, using: string, value: string): Promise<string> => wd('POST', `/session/${s}/element`, { using, value }).then((e) => e[ELEMENT]);
const click = (s: string, el: string) => wd('POST', `/session/${s}/element/${el}/click`, {});
const type = (s: string, el: string, text: string) => wd('POST', `/session/${s}/element/${el}/value`, { text });
const run = (s: string, script: string, args: unknown[] = []) => wd('POST', `/session/${s}/execute/sync`, { script, args });
const bodyText = (s: string): Promise<string> => run(s, 'return document.body.innerText');

async function startApp(): Promise<string> {
  await until('tauri-driver', () => fetch(`${DRIVER}/status`).then((r) => r.ok), 10_000);
  const session = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } } });
  lastSession = session.sessionId;
  return session.sessionId;
}

function check(ok: boolean, message: string) {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failed = true;
}

async function filesUnder(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { recursive: true, withFileTypes: true })).filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name));
  } catch {
    return [];
  }
}

try {
  // ── first run ──
  let s = await startApp();
  const useDefault = await until('the folder choice', () => find(s, 'xpath', "//button[starts-with(normalize-space(.), 'Use ')]"));
  check((await bodyText(s)).includes('Where should Logbook keep your journal?'), 'first run asks where to keep the journal');
  await click(s, useDefault);
  await until('the journal', async () => (await bodyText(s)).includes('New entry'));
  const folder = join(home, 'Logbook');
  check((await readdir(home)).includes('Logbook'), `the journal folder is ${folder}`);

  // ── an entry with a photo ──
  await run(
    s,
    `window.__errors = [];
     addEventListener('error', (e) => window.__errors.push(String(e.message)));
     addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && (e.reason.stack || e.reason))));
     const ce = console.error; console.error = (...a) => (window.__errors.push(a.map(String).join(' ')), ce(...a));
     location.hash = '#/new';`,
  );
  const title = await until('the title field', () => find(s, 'css selector', '#entry-title'));
  await type(s, title, 'Desktop day');
  const editor = await find(s, 'css selector', '[role="textbox"][aria-label="Entry text"]');
  await click(s, editor);
  await type(s, editor, 'Written in the desktop app.');
  // WebKitWebDriver's file upload ends the session, so the photo is handed to the page's file input
  // the way a drop would: same import code from there on.
  await run(
    s,
    `const bytes = Uint8Array.from(atob(arguments[0]), (c) => c.charCodeAt(0));
     const dt = new DataTransfer();
     dt.items.add(new File([bytes], 'sunset.png', { type: 'image/png' }));
     const input = document.querySelector('[data-testid="photo-input"]');
     input.files = dt.files;
     input.dispatchEvent(new Event('change', { bubbles: true }));`,
    [png().toString('base64')],
  );
  await until('the photo', () => find(s, 'css selector', 'img[alt="sunset.png"]'));
  await until('the save', async () => (await bodyText(s)).includes('Saved on this device'));
  await sleep(1500); // the photo's details are saved after the entry

  const files = (await filesUnder(folder)).map((f) => f.slice(folder.length + 1)).sort();
  console.log('  files:', files.join(', '));
  const entryFile = files.find((f) => /^entries\/\d{4}\/\d{4}-\d{2}-\d{2}--desktop-day--[0-9a-z]+\.json$/.test(f));
  check(Boolean(entryFile), 'the entry is a readable file named after its date and title');
  if (entryFile) {
    const entry = JSON.parse(await readFile(join(folder, entryFile), 'utf8'));
    check(entry.title === 'Desktop day' && JSON.stringify(entry.blocks).includes('Written in the desktop app.'), 'the file holds the title and text');
  }
  check(files.some((f) => /^media\/[0-9a-z]{2}\/[0-9a-z]+\.png$/.test(f)) && files.some((f) => /^media\/[0-9a-z]{2}\/[0-9a-z]+\.meta\.json$/.test(f)), 'the photo and its details are files in media/');
  check(files.includes('logbook.json'), 'logbook.json holds the settings');
  await wd('DELETE', `/session/${s}`);

  // ── after a restart ──
  s = await startApp();
  await until('the journal after a restart', async () => (await bodyText(s)).includes('New entry'));
  check(!(await bodyText(s)).includes('Where should Logbook keep your journal?'), 'a restart opens the remembered folder without asking again');
  check(Boolean(await until('the entry', async () => (await bodyText(s)).includes('Desktop day')).catch(() => false)), 'the entry is listed after a restart');
  await run(s, "location.hash = '#/settings'");
  await until('settings', async () => (await bodyText(s)).includes('Journal folder'));
  check((await bodyText(s)).includes(folder), 'Settings shows the journal folder');

  // ── closing the window straight after typing (D86) ──
  await run(s, "location.hash = '#/new'");
  const quick = await until('the title field', () => find(s, 'css selector', '#entry-title'));
  await type(s, quick, 'Closed at once');
  // Well inside the editor's 0.7 s autosave delay: only the close handler can save this. The
  // window manager's close message, as from the close button (WebDriver's close skips it).
  const closed = spawnSync('python3', [new URL('close-window.py', import.meta.url).pathname], { env });
  check(closed.status === 0, 'the window got a close request');
  if (closed.status !== 0) console.log(`  close-window.py: ${String(closed.stderr).trim() || 'no Logbook window found'} (needs python3-xlib)`);
  await until('the window to close', async () => !(await wd('GET', `/session/${s}/window`).then(() => true, () => false)), 10_000).catch(() => undefined);
  await wd('DELETE', `/session/${s}`).catch(() => undefined);
  s = await startApp();
  await until('the journal after closing', async () => (await bodyText(s)).includes('New entry'));
  check((await filesUnder(join(folder, 'entries'))).some((f) => f.includes('--closed-at-once--')), 'text typed just before closing the window is saved');

  // ── closing after switching to a folder that won't open (D86) ──
  // Settings → "Open a different journal folder…" reloads the page onto the folder screen; the
  // window must still close (the close is held in Rust, with a time limit).
  const bad = join(home, 'NotAJournal');
  await mkdir(bad, { recursive: true });
  await writeFile(join(bad, 'logbook.json'), JSON.stringify({ format: 'something-else' }));
  await run(s, `return window.__TAURI_INTERNALS__.invoke('use_journal_folder', { path: arguments[0] })`, [bad]);
  await run(s, 'location.reload()');
  await until('the folder screen with the reason', async () => (await bodyText(s)).includes("couldn't open"));
  check(true, 'a folder that won\'t open shows the folder screen with the reason');
  const asked = Date.now();
  spawnSync('python3', [new URL('close-window.py', import.meta.url).pathname], { env });
  const gone = await until('the window to close', async () => !(await wd('GET', `/session/${s}/window`).then(() => true, () => false)), 8_000).then(
    () => true,
    () => false,
  );
  check(gone, `the window still closes from there (${((Date.now() - asked) / 1000).toFixed(1)} s)`);
  await wd('DELETE', `/session/${s}`).catch(() => undefined);
} catch (err) {
  console.error('✗', (err as Error).message);
  if (process.env.SMOKE_DEBUG && lastSession) {
    console.error(await bodyText(lastSession).catch((e: Error) => `(no page: ${e.message})`));
    console.error(await run(lastSession, 'return JSON.stringify(window.__errors ?? [])').catch(() => ''));
  }
  failed = true;
} finally {
  const exited = new Promise<void>((r) => driver.once('exit', () => r()));
  driver.kill();
  await exited;
  // The webview may still be flushing its caches into the temporary home for a moment.
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
process.exit(failed ? 1 : 0);

/** A 64×48 orange PNG. */
function png(): Buffer {
  const w = 64;
  const h = 48;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([250, 120, 60], y * (w * 3 + 1) + 1 + x * 3);
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (t: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(t), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
