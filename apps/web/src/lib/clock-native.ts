import type { Ring } from './clock.ts';
import { isApp, isDesktop } from './platform.ts';

/**
 * The clock and the system (D92). In the apps, rings go to Rust (src-tauri/src/clock.rs): Android
 * schedules them with its alarm service, the desktop watches them and shows the system's
 * notification. In a browser, a notification shows when a ring goes off while the tab is hidden.
 */

export type NotifyPermission = 'granted' | 'denied' | 'prompt';

export async function scheduleRings(rings: Ring[]): Promise<void> {
  if (!isApp) return;
  const { invoke } = await import('../desktop/ipc.ts');
  await invoke('clock_schedule', { rings: rings.map(({ id, at, title, body }) => ({ id, at, title, body })) });
}

/** Calls `fn` when the desktop app's watcher rings (the page's own timers may run late when hidden). */
export async function onSystemRing(fn: () => void): Promise<() => void> {
  if (!isDesktop) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen('clock-ring', fn);
}

export async function notifyPermission(ask: boolean): Promise<NotifyPermission> {
  if (isApp) {
    const { invoke } = await import('../desktop/ipc.ts');
    const state = await invoke<string>('clock_permission', { ask }).catch(() => 'denied');
    return state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt';
  }
  if (!('Notification' in window)) return 'denied';
  if (ask && Notification.permission === 'default') await Notification.requestPermission().catch(() => undefined);
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

/** In a browser, while the tab is hidden: the system's notification. The apps show their own. */
export function notifyHidden(title: string, body: string): void {
  if (isApp || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    new Notification(title, { body, tag: 'logbook-clock' });
  } catch {
    // Android's Chrome only shows them from a service worker: the page still rings.
  }
}
