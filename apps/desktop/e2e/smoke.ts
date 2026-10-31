// Drives the built desktop app through WebDriver (tauri-driver + WebKitWebDriver, Linux only):
// first run in an empty home folder, the default journal folder, an entry with a photo, the files
// that appear on disk, the journal after a restart, the person's picture as the app's icon, another
// computer's changes arriving in the folder and a sync copy sorted out, and an entry typed just
// before the window closes.
//
//   npx tauri build --debug --no-bundle            (in apps/desktop)
//   xvfb-run npm run test:e2e [-- path to the app]  (needs tauri-driver and WebKitWebDriver on PATH, and python3-xlib)
//
// No test framework: plain WebDriver calls over fetch, so nothing else needs installing.

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { ESCAPED, WALL_CHECK, WALLED_OFF } from './wall-check.ts';

const APP = resolve(process.argv[2] ?? new URL('../src-tauri/target/debug/logbook', import.meta.url).pathname);
const DRIVER = 'http://127.0.0.1:4444';

const home = await mkdtemp(join(tmpdir(), 'logbook-desktop-e2e-'));
// The app's config, documents and webview data all live under this home, so the run starts fresh.
// A system folder with Logbook's desktop entry as its package installs it (tauri-bundler), so the
// app icon's menu entry can be checked (D101).
const system = join(home, 'system');
await mkdir(join(system, 'applications'), { recursive: true });
await writeFile(join(system, 'applications/Logbook.desktop'), '[Desktop Entry]\nCategories=Education;\nExec=logbook\nStartupWMClass=logbook\nIcon=logbook\nName=Logbook\nTerminal=false\nType=Application\n');
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local/share'),
  XDG_CACHE_HOME: join(home, '.cache'),
  XDG_DATA_DIRS: [system, process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share'].join(':'),
};
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
/** What the window's security policy (D104) has blocked since the app started (boot.tsx). */
const blocked = (s: string): Promise<string[]> => run(s, 'return window.logbookBlocked ?? null');
/** One of Logbook's commands, as its page calls them: with the secret Rust hands the page (D111). */
const command = (s: string, cmd: string, args: unknown = {}) =>
  run(
    s,
    `return new Promise((r) => { window.__logbookSession = r; window.__TAURI_INTERNALS__.invoke('session_ready'); })
       .then((key) => window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1], { headers: { 'logbook-session': key } }))`,
    [cmd, args],
  );
/** Keys for WebDriver's element/value: End. */
const END = '';

/** Logbook's window icon as X11 has it: its sizes, and the largest one's colour at (fx, fy). */
function windowIcon(fx = 0.5, fy = 0.5): { sizes: number[][]; pixel: number[] } | null {
  const r = spawnSync('python3', [new URL('window-icon.py', import.meta.url).pathname, String(fx), String(fy)], { env, encoding: 'utf8' });
  return r.status === 0 ? JSON.parse(r.stdout) : null;
}

/** Serious and critical accessibility problems axe finds in what `selector` matches. */
async function axeProblems(s: string, selector: string): Promise<string[]> {
  const source = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  // axe's source is part of the script itself: the window's security policy (D104) refuses eval.
  return wd('POST', `/session/${s}/execute/async`, {
    script: `${source}
      const done = arguments[arguments.length - 1];
      axe.run(document.querySelector(arguments[0]), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
        .then((r) => done(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', '))))
        .catch((e) => done(['axe failed: ' + e]));`,
    args: [selector],
  });
}

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
  const firstRun = await blocked(s);
  check(Array.isArray(firstRun) && firstRun.length === 0, `the window's security policy blocked nothing on a first run with a photo (${JSON.stringify(firstRun)})`);
  await wd('DELETE', `/session/${s}`);

  // ── after a restart ──
  s = await startApp();
  await until('the journal after a restart', async () => (await bodyText(s)).includes('New entry'));
  check(!(await bodyText(s)).includes('Where should Logbook keep your journal?'), 'a restart opens the remembered folder without asking again');
  check(Boolean(await until('the entry', async () => (await bodyText(s)).includes('Desktop day')).catch(() => false)), 'the entry is listed after a restart');
  await run(s, "location.hash = '#/settings'");
  await until('settings', async () => (await bodyText(s)).includes('Journal folder'));
  check((await bodyText(s)).includes(folder), 'Settings shows the journal folder');

  // ── the person's picture as the app's icon (D101) ──
  const usual = windowIcon();
  check(Boolean(usual), `the window has its usual icon (${JSON.stringify(usual?.sizes)})`);
  await until('the app icon panel', async () => (await bodyText(s)).includes('App icon'));
  // Blue on the left third, orange beyond: where the square sits shows in the icon's colours.
  const picture = png(900, 600, (x) => (x < 300 ? [20, 60, 230] : [250, 120, 60]));
  await run(
    s,
    `const bytes = Uint8Array.from(atob(arguments[0]), (c) => c.charCodeAt(0));
     const dt = new DataTransfer();
     dt.items.add(new File([bytes], 'me.png', { type: 'image/png' }));
     const input = document.querySelector('[data-testid="app-icon-input"]');
     input.files = dt.files;
     input.dispatchEvent(new Event('change', { bubbles: true }));`,
    [picture.toString('base64')],
  );
  await until('the crop', () => find(s, 'xpath', "//dialog[@open]//h2[contains(., 'Logbook’s icon')]"));
  const across = await find(s, 'xpath', "//dialog[@open]//label[contains(., 'Left and right')]/input");
  const placed = () => run(s, 'return arguments[0].getAttribute("aria-valuetext")', [{ [ELEMENT]: across }]);
  check((await placed()) === 'Centred', 'the square starts centred');
  await type(s, across, END);
  check((await placed()) === 'At the right', 'the keyboard moves the square to the right');
  // Once the dialog has faded in (0.3 s): partway, its colours are paler than they end up.
  await sleep(500);
  await until('the dialog to settle', () => run(s, "return document.getAnimations().every((a) => a.playState !== 'running') && getComputedStyle(document.querySelector('dialog[open]')).opacity === '1'"));
  const problems = await axeProblems(s, 'dialog[open]');
  check(problems.length === 0, `the crop has no serious accessibility problems${problems.length ? `: ${problems.join('; ')}` : ''}`);
  await click(s, await find(s, 'xpath', "//dialog[@open]//button[normalize-space(.)='Use this picture']"));
  await until('the icon', async () => (await bodyText(s)).includes('Logbook’s icon is now your picture'));
  const configDir = join(home, '.config/app.logbookjournal.desktop');
  const config = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8'));
  const kept = (await filesUnder(join(configDir, 'app-icon'))).map((f) => f.slice(configDir.length + 1)).sort();
  check(
    typeof config.appIcon === 'string' && ['128', '256', '512'].every((n) => kept.includes(`app-icon/${config.appIcon}/${n}.png`)),
    `the picture is kept in the app's config folder (${kept.join(', ')})`,
  );
  const menuEntry = join(home, '.local/share/applications/Logbook.desktop');
  const lines = (await readFile(menuEntry, 'utf8').catch(() => '')).split('\n');
  check(
    lines.includes(`Icon=${join(configDir, 'app-icon', config.appIcon, '512.png')}`) && lines.includes('TryExec=logbook') && lines.includes('StartupWMClass=logbook'),
    "the app menu's entry shows the picture",
  );
  // At the right, an eighth of the way in is orange (centred, it would be blue).
  const mine = windowIcon(0.125, 0.5);
  check(Boolean(mine?.sizes.some(([w]) => w === 256)) && mine!.pixel[0] > 200 && mine!.pixel[2] < 120, `the window's icon is the picture, cut where it was put (${JSON.stringify(mine)})`);
  await wd('DELETE', `/session/${s}`);
  s = await startApp();
  await until('the journal after a restart', async () => (await bodyText(s)).includes('New entry'));
  const again = await until('the icon after a restart', async () => {
    const icon = windowIcon(0.125, 0.5);
    return icon?.sizes.some(([w]) => w === 256) ? icon : null;
  }).catch(() => null);
  check(again !== null && again.pixel[0] > 200, 'the picture is the icon again after a restart');
  await run(s, "location.hash = '#/settings'");
  await click(s, await until('the usual icon button', () => find(s, 'xpath', "//button[normalize-space(.)='Use the usual icon']")));
  await until('the usual icon', async () => (await bodyText(s)).includes('Logbook has its usual icon again.'));
  check(!(await readFile(menuEntry, 'utf8').then(() => true, () => false)), "the app menu's own entry is back");
  check((await filesUnder(join(configDir, 'app-icon'))).length === 0 && !JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8')).appIcon, 'the picture is deleted');
  check(JSON.stringify(windowIcon()?.sizes) === JSON.stringify(usual?.sizes), 'the window has its usual icon again');

  // ── opening at sign-in (D110): the system's own autostart entry, made and taken away ──
  const autostartEntry = join(home, '.config', 'autostart', 'Logbook.desktop');
  const startSwitch = "//label[contains(., 'when you sign in to this computer')]/input";
  await click(s, await until('the start-at-sign-in switch', () => find(s, 'xpath', `${startSwitch}[not(@disabled)]`)));
  const entry = await until('the autostart entry', () => readFile(autostartEntry, 'utf8').catch(() => '')).catch(() => '');
  check(/^Exec=.*logbook/im.test(entry), `switching it on adds Logbook to the computer's autostart entries (${autostartEntry})`);
  await click(s, await until('the switch, on', () => find(s, 'xpath', `${startSwitch}[not(@disabled)]`)));
  const entryGone = await until('the entry to go', () => readFile(autostartEntry, 'utf8').then(() => false, () => true)).catch(() => false);
  check(entryGone, 'switching it off takes the entry away');

  // ── another computer's changes, through a sync service (D102) ──
  await run(s, "location.hash = '#/'");
  const deskFile = (await filesUnder(join(folder, 'entries'))).find((f) => f.includes('--desktop-day--'))!;
  const desk = JSON.parse(await readFile(deskFile, 'utf8'));
  const year = desk.date.slice(0, 4);
  const laptopId = 'laptop0000a1';
  const laptopFile = join(folder, `entries/${year}/${desk.date}--from-the-laptop--${laptopId}.json`);
  await writeFile(laptopFile, JSON.stringify({ ...desk, id: laptopId, title: 'From the laptop', rev: 1 }, null, 2));
  check(Boolean(await until('the laptop entry', async () => (await bodyText(s)).includes('From the laptop')).catch(() => false)), 'an entry another computer added shows up without a restart');
  // Open in the editor, untouched, while the laptop renames it: the editor shows the laptop's version.
  await run(s, `location.hash = '#/entry/${desk.id}'`);
  const titleNow = () => run(s, "return document.querySelector('#entry-title')?.value ?? ''");
  await until('the entry in the editor', async () => (await titleNow()) === 'Desktop day');
  const renamed = join(folder, `entries/${year}/${desk.date}--desktop-day-on-the-laptop--${desk.id}.json`);
  await writeFile(renamed, JSON.stringify({ ...desk, title: 'Desktop day, on the laptop', rev: desk.rev + 1 }, null, 2));
  await rm(deskFile);
  check(Boolean(await until('the laptop’s version in the editor', async () => (await titleNow()) === 'Desktop day, on the laptop').catch(() => false)), 'an entry open in the editor shows the version another computer saved');
  // A sync service's copy: a banner, then the page to sort it out.
  await run(s, "location.hash = '#/'");
  const copyFile = laptopFile.replace('.json', ' (conflicted copy).json');
  await writeFile(copyFile, JSON.stringify({ ...desk, id: laptopId, title: 'From the laptop, other version', rev: 1 }, null, 2));
  const sortOut = await until('the banner', () => find(s, 'xpath', "//a[normalize-space(.)='Sort it out']")).catch(() => null);
  check(Boolean(sortOut) && (await bodyText(s)).includes('needs a look'), 'a sync service’s copy brings a banner');
  if (sortOut) {
    await click(s, sortOut);
    await until('the copy', async () => (await bodyText(s)).includes('From the laptop, other version'));
    check((await bodyText(s)).includes('In your journal') && (await bodyText(s)).includes('The copy'), 'the copy is shown beside the entry it belongs to');
    await sleep(500);
    const copyProblems = await axeProblems(s, 'main');
    check(copyProblems.length === 0, `the copies page has no serious accessibility problems${copyProblems.length ? `: ${copyProblems.join('; ')}` : ''}`);
    await click(s, await find(s, 'xpath', "//button[normalize-space(.)='Keep both']"));
    await until('the choice', async () => (await bodyText(s)).includes('Nothing to sort out'));
    const after = await filesUnder(join(folder, 'entries'));
    check(!after.includes(copyFile) && after.filter((f) => f.includes('--from-the-laptop')).length === 2, `keeping both makes the copy an entry of its own (${after.map((f) => f.slice(folder.length + 1)).join(', ')})`);
  }
  // Deleting the open entry is this computer's own change, not news from another.
  const fromElsewhere = async () => (await bodyText(s)).split('another computer').length - 1;
  await run(s, `location.hash = '#/entry/${laptopId}'`);
  await until('the laptop entry in the editor', async () => (await titleNow()) === 'From the laptop');
  const toldBefore = await fromElsewhere();
  await click(s, await find(s, 'xpath', "//button[contains(., 'Delete')]"));
  await until('the deletion', async () => (await bodyText(s)).includes('Moved to trash.'));
  await sleep(1500);
  check((await fromElsewhere()) === toldBefore, 'deleting an open entry doesn’t say another computer changed it');

  // ── the window's security policy (D104) ──
  // A video site's player as an entry's music: allowed, whether or not the site can be reached.
  await run(s, `location.hash = '#/entry/${desk.id}'`);
  await until('the entry in the editor', async () => (await titleNow()).startsWith('Desktop day'));
  await click(s, await find(s, 'xpath', "//button[contains(., 'Music')]"));
  await click(s, await until('the link button', () => find(s, 'xpath', "//button[contains(., 'Paste a link')]")));
  await type(s, await until('the link field', () => find(s, 'css selector', 'input[placeholder^="YouTube"]')), 'https://www.youtube.com/watch?v=jfKfPfyJRdk');
  await click(s, await find(s, 'xpath', "//button[normalize-space(.)='Play']"));
  const player = await until('the player', () => run(s, "return document.querySelector('iframe[src*=\"youtube-nocookie.com\"]') ? true : null")).catch(() => false);
  await sleep(1000);
  const sessionBlocked = await blocked(s);
  check(Boolean(player) && Array.isArray(sessionBlocked) && sessionBlocked.length === 0, `nothing the app needs is blocked: a photo, the app icon's crop, sync, the copies page, a video player (${JSON.stringify(sessionBlocked)})`);
  // The passcode's key derivation runs WebAssembly (hash-wasm, D6): allowed. WebKit lets a module
  // compile anyway; making an instance of it is what the policy decides.
  const wasm = await run(s, "return WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then((m) => WebAssembly.instantiate(m, {})).then(() => 'runs', (e) => String(e))");
  check(wasm === 'runs', `WebAssembly runs, for the passcode (${wasm})`);
  // Fonts of your own (D107) go into the page from their bytes, which the policy has no say over.
  const font = await run(
    s,
    `const rules = [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules]; } catch { return []; } });
     const rule = rules.find((r) => r instanceof CSSFontFaceRule && /url\\(["']?[^"')]+\\.woff2?["']?\\)/.test(r.cssText));
     const file = rule && new URL(/url\\(["']?([^"')]+\\.woff2?)["']?\\)/.exec(rule.cssText)[1], rule.parentStyleSheet.href ?? location.href).href;
     return file ? fetch(file).then((r) => r.arrayBuffer()).then((b) => new FontFace('Smoke Font', b).load()).then(() => 'loads', (e) => String(e)) : 'no font file to try';`,
  );
  const fontBlocked = await blocked(s);
  check(font === 'loads' && Array.isArray(fontBlocked) && fontBlocked.length === 0, `a font of your own loads in the window (${font}, ${JSON.stringify(fontBlocked)})`);
  // What it's for: script slipped into the page (a crafted entry from a synced folder) doesn't run,
  // and can't send anything anywhere.
  await run(
    s,
    `const tag = document.createElement('script'); tag.textContent = 'window.__injected = true'; document.body.append(tag);
     window.__attempt = null;
     fetch('https://example.com/collect').then(() => 'sent', () => 'refused').then((sent) => { window.__attempt = { ran: window.__injected === true, sent }; });`,
  );
  const attempt = await until('the attempt', () => run(s, 'return window.__attempt')).catch(() => ({ ran: undefined, sent: undefined }));
  check(attempt.ran === false && attempt.sent === 'refused', `script slipped into the page doesn't run or send anything (${JSON.stringify(attempt)})`);
  const reported = (await blocked(s)) ?? [];
  check(reported.some((b) => b.startsWith('script-src')) && reported.some((b) => b.startsWith('connect-src')), `the policy says what it blocked (${JSON.stringify(reported)})`);

  // ── your own apps (D111): walled off from Logbook's page and commands ──
  const refused = await run(s, "return window.__TAURI_INTERNALS__.invoke('journal_folder').then(() => 'ran', (e) => String(e))");
  check(refused === "Only Logbook's own page can do that.", `a command without the page's secret is refused (${refused})`);
  const emitted = await run(s, "return window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'logbook://save-before-close', payload: null }).then(() => 'sent', (e) => String(e))");
  check(/not allowed/i.test(emitted), `nothing in the window can send Logbook's own events (${emitted})`);
  await run(s, "location.hash = '#/apps'");
  await type(s, await until('the code box', () => find(s, 'css selector', 'textarea.app-code')), WALL_CHECK);
  await click(s, await find(s, 'xpath', "//button[normalize-space(.)='Add app']"));
  const appFrame = await until('the app', () => find(s, 'css selector', 'iframe.app-frame[src]'));
  const src: string = await run(s, "return document.querySelector('iframe.app-frame').src");
  await wd('POST', `/session/${s}/frame`, { id: { [ELEMENT]: appFrame } });
  const walls = await until('the app to check', async () => {
    const text: string = await run(s, "return document.getElementById('walls')?.textContent ?? ''");
    return text && text !== 'checking' ? text : null;
  }).catch((e: Error) => `never finished (${e.message})`);
  await wd('POST', `/session/${s}/frame/parent`, {});
  check(src.startsWith('appbox:'), `an app opens from an origin of its own (${src.slice(0, 20)}…)`);
  check(WALLED_OFF.test(walls) && !(await readFile(join(folder, ESCAPED)).then(() => true, () => false)), `an app can't reach Logbook's commands or page (${walls})`);
  const appData = await until('what the app saved', async () => (await filesUnder(join(folder, 'media'))).find((f) => /app[0-9a-z]+data\./.test(f)) ?? null).catch(() => null);
  check(Boolean(appData), 'what an app saves is kept in the journal folder');
  const appsBlocked = await blocked(s);
  check(Array.isArray(appsBlocked) && appsBlocked.length === reported.length, `the window lets the app's frame in (${JSON.stringify(appsBlocked?.slice(reported.length))})`);

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
  await command(s, 'use_journal_folder', { path: bad });
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
function png(w = 64, h = 48, colour: (x: number, y: number) => number[] = () => [250, 120, 60]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(colour(x, y), y * (w * 3 + 1) + 1 + x * 3);
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
