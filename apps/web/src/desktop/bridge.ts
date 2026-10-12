import { invoke } from '@tauri-apps/api/core';
import { PIECE as TEXT_PIECE, toBase64 } from '@logbook/storage-fs/tauri';
import { announce } from '../app/toasts.tsx';

/** The apps' own commands (apps/desktop/src-tauri/src/lib.rs). Desktop and Android builds only. */

/**
 * The open journal folder (null before one is chosen), a remembered one that has gone missing, and
 * on Android why the journal's folder inside the app couldn't be made.
 */
export function journalFolder(): Promise<{ folder: string | null; missing: string | null; problem: string | null }> {
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

/**
 * Pieces a saved file is sent in, so a big one never crosses over as one block. Android's webview
 * sends them as base64 text (D90), so smaller there.
 */
const android = import.meta.env.VITE_PLATFORM === 'android';
const SAVE_PIECE = android ? TEXT_PIECE : 16 * 1024 * 1024;

/**
 * Asks where to save, then writes the file there in pieces. Returns where it went (on Android the
 * file's name), or null when the dialog was cancelled or `proceed` said no (asked after the dialog
 * and before each piece: a journal that locked meanwhile, say), in which case nothing is left behind.
 */
export async function saveFile(blob: Blob, name: string, proceed: () => boolean = () => true): Promise<string | null> {
  const fail = (err: unknown) => {
    throw new Error(String(err));
  };
  const where = await invoke<string | null>('save_pick', { name }).catch(fail);
  if (!where) return null;
  try {
    for (let at = 0; ; at += SAVE_PIECE) {
      if (!proceed()) {
        await invoke('save_cancel');
        return null;
      }
      const piece = new Uint8Array(await blob.slice(at, at + SAVE_PIECE).arrayBuffer());
      const last = at + SAVE_PIECE >= blob.size;
      await invoke('save_write', android ? { data: toBase64(piece) } : piece, { headers: { 'x-last': last ? '1' : '0' } });
      if (last) return where;
    }
  } catch (err) {
    await invoke('save_cancel').catch(() => {});
    return fail(err);
  }
}

/** The system print window (with "Save as PDF") for what the window shows. */
export function printPage(): Promise<void> {
  return invoke('print_page');
}

/** Opens a web or email link in the default browser. */
export function openExternal(url: string): Promise<void> {
  return invoke('open_url', { url });
}

/**
 * Links in a desktop window: web links open in the browser instead of replacing the app, and
 * downloads (attachments) go through a save dialog, which a webview doesn't offer by itself.
 * Links inside text being edited stay put, as in a browser: a click there places the cursor.
 */
export function routeLinks(): void {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || e.defaultPrevented || a.closest('[contenteditable="true"]')) return;
    const href = a.getAttribute('href') ?? '';
    if (a.hasAttribute('download') && href.startsWith('blob:')) {
      e.preventDefault();
      const name = a.getAttribute('download') || 'file';
      void fetch(href)
        .then((r) => r.blob())
        .then((b) => saveFile(b, name))
        .then((where) => where && announce(`Saved ${where}`))
        .catch((err: unknown) => announce(`Couldn't save ${name}: ${err instanceof Error ? err.message : String(err)}`));
    } else if (/^(https?:|mailto:)/i.test(href) && new URL(href, location.href).origin !== location.origin) {
      e.preventDefault();
      void openExternal(href).catch((err: unknown) => announce(`Couldn't open the link: ${String(err)}`));
    }
  });
}
