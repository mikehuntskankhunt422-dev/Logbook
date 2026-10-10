import { invoke } from '@tauri-apps/api/core';

/** The desktop app's own commands (apps/desktop/src-tauri/src/lib.rs). Desktop build only. */

/** The open journal folder (null before one is chosen), and a remembered one that has gone missing. */
export function journalFolder(): Promise<{ folder: string | null; missing: string | null }> {
  return invoke('journal_folder');
}

/** `Documents/Logbook`, where a new journal goes unless the person picks somewhere else. */
export function defaultJournalFolder(): Promise<string> {
  return invoke<string>('default_journal_folder');
}

/** The system folder picker; null when cancelled. */
export function pickFolder(): Promise<string | null> {
  return invoke<string | null>('pick_folder');
}

/**
 * Opens or starts the journal in `path` and remembers it for next time. Returns the folder used:
 * a `Logbook` folder inside `path` when `path` already holds other files.
 */
export function openJournalFolder(path: string): Promise<string> {
  return invoke<string>('use_journal_folder', { path }).catch((err: unknown) => {
    throw new Error(String(err));
  });
}

/** Shows the journal folder in Explorer, Finder or the file manager. */
export function revealJournalFolder(): Promise<void> {
  return invoke('reveal_journal_folder');
}

/** Asks where to save, then writes the file. Returns where it went, or null when cancelled. */
export async function saveFile(blob: Blob, name: string): Promise<string | null> {
  const data = new Uint8Array(await blob.arrayBuffer());
  return invoke<string | null>('save_file', data, { headers: { 'x-name': encodeURIComponent(name) } }).catch((err: unknown) => {
    throw new Error(String(err));
  });
}

/** Opens a web or email link in the default browser. */
export function openExternal(url: string): Promise<void> {
  return invoke('open_url', { url });
}

/**
 * Links in a desktop window: web links open in the browser instead of replacing the app, and
 * downloads (attachments) go through a save dialog, which a webview doesn't offer by itself.
 */
export function routeLinks(): void {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || e.defaultPrevented) return;
    const href = a.getAttribute('href') ?? '';
    if (a.hasAttribute('download') && href.startsWith('blob:')) {
      e.preventDefault();
      void fetch(href)
        .then((r) => r.blob())
        .then((b) => saveFile(b, a.getAttribute('download') || 'file'));
    } else if (/^(https?:|mailto:)/i.test(href) && new URL(href, location.href).origin !== location.origin) {
      e.preventDefault();
      void openExternal(href);
    }
  });
}
