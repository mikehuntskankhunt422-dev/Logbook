import { useEffect, useState } from 'react';
import { APP_MAX_CODE, appDocument, type AppItems, type Journal, type MediaMeta } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { trackWork } from './pending-saves.ts';

/**
 * Your own apps (D111) run in a frame walled off from Logbook: sandboxed with no origin of Logbook's,
 * so they can't reach the journal's storage or the page around them, and in the apps not Logbook's
 * commands either (each needs the page's secret, src-tauri/src/session.rs). In a browser the frame
 * holds the app's page itself; the apps' window allows no inline scripts, so there Rust serves it
 * from an origin of its own, under a policy of its own (src-tauri/src/appbox.rs).
 */

/** What an app may do in its frame: run, show forms, dialogs and popups, download, lock the pointer for games. Never same-origin. */
export const APP_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock';

const stage = import.meta.env.VITE_PLATFORM === 'desktop' || import.meta.env.VITE_PLATFORM === 'android' ? () => import('../desktop/bridge.ts') : null;

/** Your apps, A to Z, as they change; undefined while loading. */
export function useApps(): MediaMeta[] | undefined {
  const { journal, locked } = useJournal();
  const [apps, setApps] = useState<MediaMeta[]>();
  useEffect(() => {
    if (locked) return;
    let alive = true;
    const load = () => void journal.listApps().then((next) => alive && setApps(next), () => alive && setApps([]));
    load();
    const off = journal.subscribe((e) => (e === 'media' || e === 'external') && load());
    return () => {
      alive = false;
      off();
    };
  }, [journal, locked]);
  return apps;
}

// What each app's frame last handed over, and its writes to the journal under way.
const latest = new Map<string, AppItems>();
const writing = new Map<string, Promise<void>>();
const again = new Set<string>();

/**
 * Keeps what an app's frame handed over: straight away, then, while it keeps changing, its newest
 * at most every 300 ms (a game saving every frame doesn't write the journal 60 times a second).
 */
export function keepAppItems(journal: Journal, appId: string, items: AppItems, onError: (err: Error) => void): void {
  latest.set(appId, items);
  if (writing.has(appId)) {
    again.add(appId);
    return;
  }
  const write = async () => {
    await journal.saveAppData(appId, items);
    while (again.has(appId) && latest.has(appId)) {
      await new Promise((r) => setTimeout(r, 300));
      again.delete(appId);
      const next = latest.get(appId);
      if (next) await journal.saveAppData(appId, next);
    }
  };
  const done = write()
    .catch(onError)
    .finally(() => writing.delete(appId));
  writing.set(appId, done);
  void trackWork(done);
}

/** Deletes an app, once anything it handed over has been written (so nothing is written after). */
export async function deleteApp(journal: Journal, appId: string): Promise<void> {
  latest.delete(appId);
  await writing.get(appId);
  await journal.deleteApp(appId);
}

/** What an app's frame loads: its page, with what it saved (the newest, even before it's written). */
export async function appFrame(journal: Journal, app: MediaMeta): Promise<{ srcDoc: string } | { src: string }> {
  const html = appDocument(await journal.appCode(app.id), latest.get(app.id) ?? (await journal.appData(app.id)));
  if (!stage) return { srcDoc: html };
  const { appAddress } = await stage();
  return { src: await appAddress(html) };
}

/** A file's code: any text file (an .html page, a .js file…); a file that isn't text is refused with a note. */
export async function readCodeFile(file: File): Promise<string> {
  if (/\.zip$/i.test(file.name) || file.type === 'application/zip') throw new Error(`${file.name} is a zip file. Open the app’s .html file instead (unzip it first).`);
  if (file.size > APP_MAX_CODE * 4) throw new Error(`${file.name} is too big to be an app’s code.`);
  const text = await file.text();
  // eslint-disable-next-line no-control-regex
  if (/\u0000/.test(text) || text.includes('���')) throw new Error(`${file.name} isn’t code Logbook can run. Open an .html page or a .js file.`);
  if (text.length > APP_MAX_CODE) throw new Error(`${file.name} is too big to be an app’s code.`);
  return text;
}
