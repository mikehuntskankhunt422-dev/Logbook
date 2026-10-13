// Drives the Android app's preview build in an emulator (D90): Playwright attaches to the app's
// WebView over adb (preview builds turn WebView debugging on), and Android's own screens (the file
// picker, the print screen) are read and tapped through uiautomator. First start, an entry saved
// to the app's storage, writing saved as the app goes to the background, the journal after a
// restart, a backup saved through Android's file picker, the PDF export's print screen, and a
// timer ringing as a notification.
//
//   adb install Logbook-preview.apk
//   node --experimental-transform-types --no-warnings e2e/android.ts [folder for screenshots and logs]
//
// No test framework: plain checks, like the desktop smoke test (e2e/smoke.ts).

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _android as android, type AndroidDevice, type Page } from 'playwright';

const PKG = process.env.LOGBOOK_ANDROID_PACKAGE ?? 'app.logbookjournal.android.preview';
const ACTIVITY = 'app.logbookjournal.android.MainActivity';
const OUT = process.argv[2] ?? 'android-e2e';
await mkdir(OUT, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failed = true;
}

async function until<T>(what: string, fn: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: Error | undefined;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      last = err as Error;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

const [device] = await android.devices();
if (!device) throw new Error('No Android device or emulator: is adb running?');
const shell = async (cmd: string) => (await device.shell(cmd)).toString();
let shot = 0;
const screenshot = (name: string) => device.screenshot({ path: join(OUT, `${++shot}-${name}.png`) }).catch(() => undefined);

/** Android's own screen as uiautomator sees it (XML). */
const screen = () => shell('uiautomator dump /sdcard/ui.xml >/dev/null && cat /sdcard/ui.xml');

interface Node {
  text: string;
  desc: string;
  cls: string;
  pkg: string;
  bounds: [number, number, number, number];
}
function nodes(xml: string): Node[] {
  return [...xml.matchAll(/<node [^>]*>/g)].map(([tag]) => {
    const attr = (name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr('bounds'))!;
    return { text: attr('text'), desc: attr('content-desc'), cls: attr('class'), pkg: attr('package'), bounds: [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])] };
  });
}

/** Taps the first node of Android's screen whose text or description matches. */
async function tap(label: RegExp, timeoutMs = 30_000): Promise<void> {
  const node = await until(`${label} on screen`, async () => nodes(await screen()).find((n) => label.test(n.text) || label.test(n.desc)), timeoutMs);
  const [x1, y1, x2, y2] = node.bounds;
  await shell(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
}

async function launch(): Promise<Page> {
  await shell(`am start -W -n ${PKG}/${ACTIVITY}`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
  const page = await webview.page();
  await page.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 60_000 });
  return page;
}

/** Ends the app as Android does when it needs the memory back. */
async function kill(dev: AndroidDevice): Promise<void> {
  await shell(`am force-stop ${PKG}`);
  // The old page's debugging connection must be gone before the next start looks for one.
  await until('the old page to go', async () => !(dev.webViews().some((w) => w.pkg() === PKG)), 20_000).catch(() => undefined);
}

async function open(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => (location.hash = h), hash);
}

try {
  // ── first start ──
  let page = await launch();
  check(true, 'the app starts and shows the journal');
  await screenshot('first-start');

  // The page sits between the status bar and the navigation bar, not under them (D90).
  // (A dump can come back empty while the page is still drawing: try a few.)
  const webviewNode = await until('the web view on screen', async () => nodes(await screen()).find((n) => /WebView$/.test(n.cls)), 20_000).catch(() => undefined);
  if (!webviewNode) await writeFile(join(OUT, 'first-start.xml'), await screen().catch(() => ''));
  const [, displayHeight] = (/(\d+)x(\d+)/.exec(await shell('wm size')) ?? []).slice(1).map(Number);
  check(Boolean(webviewNode && webviewNode.bounds[1] > 0), `the page starts below the status bar (web view at ${webviewNode?.bounds.join(',')})`);
  check(Boolean(webviewNode && displayHeight && webviewNode.bounds[3] < displayHeight), `the page ends above the navigation bar (screen height ${displayHeight})`);

  // ── an entry ──
  await open(page, '#/new');
  await page.getByLabel('Title').fill('Beach day');
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.type('Swam at Glenelg.');
  await page.getByText('Saved on this device').waitFor({ timeout: 20_000 });
  check(true, 'an entry saves');
  await screenshot('entry');

  // Typed just before leaving the app: saved as it goes to the background.
  await page.keyboard.type(' Then ice cream.');
  await shell('input keyevent KEYCODE_HOME');
  await sleep(2000);
  await kill(device);

  // ── after a restart ──
  page = await launch();
  await page.getByRole('link', { name: /Beach day/ }).click({ timeout: 20_000 });
  const text = await page.getByRole('textbox', { name: 'Entry text' }).innerText({ timeout: 20_000 });
  check(text.includes('Swam at Glenelg.'), 'the entry is there after a restart');
  check(text.includes('Then ice cream.'), 'writing typed just before leaving the app was saved');

  // ── Settings ──
  await open(page, '#/settings');
  await page.getByRole('heading', { name: 'Storage on this phone' }).waitFor({ timeout: 20_000 });
  check(true, 'Settings shows the phone storage panel');
  check((await page.getByText('This is a test build').count()) === 1, 'a preview build says it is one and does not look for updates');
  check((await page.getByRole('heading', { name: 'Journal folder' }).count()) === 0, 'no desktop folder panel');
  await screenshot('settings');

  // ── a backup through Android's file picker ──
  await page.getByRole('button', { name: /Save a backup/ }).click();
  await until("Android's file picker", async () => /com\.(google\.)?android\.documentsui/.test(await screen()), 30_000);
  await screenshot('file-picker');
  // It may open on "Recent", where nothing can be saved: go to Downloads first.
  if (!nodes(await screen()).some((n) => /^save$/i.test(n.text))) {
    await tap(/^(Show roots|More options)$/i, 10_000).catch(() => undefined);
    await tap(/^Downloads?$/i, 10_000).catch(() => undefined);
  }
  await tap(/^save$/i);
  await page.getByText('Backup saved.').waitFor({ timeout: 30_000 });
  const downloads = await shell('ls /sdcard/Download');
  check(/Logbook.*\.zip/i.test(downloads), `the backup is in Downloads (${downloads.trim().replace(/\n/g, ', ')})`);
  const size = Number((await shell(`stat -c %s "/sdcard/Download/$(ls /sdcard/Download | grep -i 'logbook.*zip' | head -1)"`)).trim());
  check(size > 100, `the backup has content (${size} bytes)`);

  // A cancelled save leaves nothing behind.
  await page.getByRole('button', { name: /Save a backup/ }).click();
  await until("Android's file picker again", async () => /com\.(google\.)?android\.documentsui/.test(await screen()), 30_000);
  await shell('input keyevent KEYCODE_BACK');
  await sleep(2000);
  check((await page.getByText('Backup saved.').count()) <= 1, 'cancelling the file picker saves nothing');

  // ── PDF: Android's print screen ──
  // Clicked directly: on the emulator's 320-pixel screen, Playwright's check of what is under the
  // pointer over adb reports the top bar, the New entry button or the panel itself in the way, a
  // different one each time it scrolls. What's tested here is the print screen.
  await page.getByRole('region', { name: 'Export' }).getByRole('button', { name: 'PDF' }).dispatchEvent('click');
  await page.getByRole('button', { name: /Print or save as PDF/ }).dispatchEvent('click');
  await until("Android's print screen", async () => /com\.android\.printspooler/.test(await screen()), 30_000);
  check(true, 'the PDF export opens the print screen');
  await screenshot('print');
  await shell('input keyevent KEYCODE_BACK');

  // ── The clock (D92): a timer rings in the app, and as Android's own notification ──
  await shell(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`).catch(() => '');
  await until('back in Logbook', async () => !/com\.android\.printspooler/.test(await screen()), 20_000);
  await open(page, '#/clock');
  await page.getByRole('tab', { name: /Timer/ }).dispatchEvent('click');
  await page.getByLabel('Minutes').fill('0');
  await page.getByLabel('Seconds').fill('5');
  await page.getByRole('button', { name: /Start/ }).dispatchEvent('click');
  const ringer = page.getByRole('dialog', { name: /Time.s up/ });
  await ringer.waitFor({ timeout: 30_000 });
  check(true, 'the timer rings in the app');
  await screenshot('timer');
  const notified = await until("the timer's notification", async () => /Time.s up/.test(await shell('dumpsys notification --noredact')), 20_000).then(
    () => true,
    () => false,
  );
  check(notified, "the timer's notification is in Android's list");
  await ringer.getByRole('button', { name: 'Stop' }).dispatchEvent('click');
  if (!notified) {
    // What went wrong: the command itself, then Android's side.
    const direct = await page.evaluate(async () => {
      const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
      const tryIt = (cmd: string, args: unknown) => invoke(cmd, args).then((r) => `ok ${JSON.stringify(r)}`, (e: unknown) => `error ${String(e)}`);
      return [await tryIt('clock_permission', { ask: false }), await tryIt('clock_schedule', { rings: [{ id: 4242, at: Date.now() + 3000, title: 'Probe', body: 'probe' }] })];
    });
    console.log(`  clock_permission: ${direct[0]}\n  clock_schedule: ${direct[1]}`);
    await sleep(8000);
    const alarms = (await shell('dumpsys alarm')).split('\n').filter((l) => l.includes(PKG)).slice(0, 10);
    console.log(`  alarms:\n${alarms.join('\n')}`);
    const posted = (await shell('dumpsys notification --noredact')).split('\n').filter((l) => /logbook|Probe|Time.s up/i.test(l)).slice(0, 20);
    console.log(`  notifications:\n${posted.join('\n')}`);
    const log = (await shell('logcat -d')).split('\n').filter((l) => /Tauri|Notification|Clock|AlarmManager|logbook/i.test(l)).slice(-60);
    console.log(`  logcat:\n${log.join('\n')}`);
  }
} catch (err) {
  check(false, String(err instanceof Error ? (err.stack ?? err.message) : err));
  await screenshot('failure');
  await writeFile(join(OUT, 'screen.xml'), await screen().catch(() => ''));
} finally {
  await writeFile(join(OUT, 'logcat.txt'), await shell('logcat -d').catch(() => ''));
  const crashes = await shell('logcat -d -b crash').catch(() => '');
  if (crashes.trim()) {
    console.log(crashes.slice(-4000));
    check(false, 'the app crashed (logcat above)');
  }
  await device.close();
}

console.log(failed ? 'Android test failed.' : 'Android test passed.');
process.exit(failed ? 1 : 0);
