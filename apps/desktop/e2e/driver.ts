import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Drives the real desktop app through WebDriver: `tauri-driver` in front of WebKitWebDriver
 * (Linux). A small client on `fetch`, enough for the desktop end-to-end tests.
 */

export const APP = resolve(import.meta.dirname, '../src-tauri/target/debug/logbook-desktop');
const PORT = 4444;
const W3C_ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

export interface App {
  folder: string;
  /** Waits for the first element matching the CSS selector. */
  $(css: string, timeoutMs?: number): Promise<string>;
  /** Waits for an element whose text contains `text` (XPath `contains`). */
  text(text: string, timeoutMs?: number): Promise<string>;
  click(el: string): Promise<void>;
  type(el: string, text: string): Promise<void>;
  exec<T>(script: string, ...args: unknown[]): Promise<T>;
  go(hash: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
}

/** Starts the app on `folder` (through LOGBOOK_JOURNAL_FOLDER) with its own config and data folders. */
export async function launch(folder: string): Promise<App> {
  const home = mkdtempSync(join(tmpdir(), 'logbook-e2e-home-'));
  const driver = spawn('tauri-driver', ['--port', String(PORT)], {
    env: { ...process.env, LOGBOOK_JOURNAL_FOLDER: folder, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '';
  driver.stderr!.on('data', (d: Buffer) => (log += d.toString()));
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; ; i++) {
    try {
      await fetch(`${base}/status`);
      break;
    } catch {
      if (i > 100) throw new Error(`tauri-driver didn't start: ${log}`);
      await sleep(100);
    }
  }
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json()) as { value: T & { error?: string; message?: string } };
    if (!res.ok) throw new Error(`${method} ${path}: ${json.value?.error} ${json.value?.message}`);
    return json.value;
  };
  const session = await call<{ sessionId: string }>('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } } });
  const s = `/session/${session.sessionId}`;
  const wait = async <T>(what: string, fn: () => Promise<T | undefined>, timeoutMs: number): Promise<T> => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn().catch(() => undefined);
      if (v !== undefined) return v;
      if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
      await sleep(150);
    }
  };
  const find = (using: string, value: string) => call<Record<string, string>>('POST', `${s}/element`, { using, value }).then((e) => e[W3C_ELEMENT]!);
  const app: App = {
    folder,
    $: (css, timeoutMs = 10_000) => wait(css, () => find('css selector', css), timeoutMs),
    text: (text, timeoutMs = 10_000) => wait(`text “${text}”`, () => find('xpath', `//*[contains(normalize-space(.), ${JSON.stringify(text)}) and not(.//*[contains(normalize-space(.), ${JSON.stringify(text)})])]`), timeoutMs),
    click: (el) => call('POST', `${s}/element/${el}/click`, {}),
    type: (el, text) => call('POST', `${s}/element/${el}/value`, { text }),
    exec: (script, ...args) => call('POST', `${s}/execute/sync`, { script, args }),
    go: (hash) => call('POST', `${s}/execute/sync`, { script: `location.hash = ${JSON.stringify(hash)}`, args: [] }),
    screenshot: async () => Buffer.from(await call<string>('GET', `${s}/screenshot`), 'base64'),
    close: async () => {
      await call('DELETE', s).catch(() => undefined);
      stop(driver);
      await sleep(300);
    },
  };
  return app;
}

function stop(p: ChildProcess): void {
  if (p.exitCode === null) p.kill('SIGTERM');
}
