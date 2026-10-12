import { EXPORT_CSS, LockedError, chronological, entriesHtml, exportEntries, referencedMediaIds, mediaKind, type Entry, type ExportMedia, type Journal, type JournalExportOptions } from '@logbook/core';
import { formatLongDate } from '../components/common.tsx';
import { downloadBlob } from './backup-io.ts';

/**
 * Getting an export out (D89): Markdown, plain text and web pages are saved like a backup (the
 * apps ask where); PDF is the entries laid out for print, handed to the system's print window,
 * where "Save as PDF" makes the file.
 *
 * Either can take a while on a big journal. If Settings closes meanwhile (`signal`), or the
 * journal locks, the export stops before anything is saved or printed: no save dialog or print
 * window over the lock screen, and no decrypted entries left in the page.
 */

export type ExportChoice = JournalExportOptions['format'] | 'pdf';

export interface ExportResult {
  /** False when the person cancelled the save dialog, or the export was stopped. */
  saved: boolean;
  entries: number;
  mediaMissing: number;
}

const stopped = (journal: Journal, signal?: AbortSignal) => Boolean(signal?.aborted) || journal.isLocked;
const NOT_SAVED: ExportResult = { saved: false, entries: 0, mediaMissing: 0 };

/** Makes the file and saves it. */
export async function exportToFile(journal: Journal, entries: Entry[], opts: Omit<JournalExportOptions, 'formatDate'>, signal?: AbortSignal): Promise<ExportResult> {
  let out;
  try {
    out = await exportEntries(journal, entries, { ...opts, signal, formatDate: (d) => formatLongDate(d) });
  } catch (err) {
    if (signal?.aborted) return NOT_SAVED;
    throw err;
  }
  if (journal.isLocked) throw new LockedError();
  if (signal?.aborted) return NOT_SAVED;
  let saved = true;
  if (import.meta.env.VITE_PLATFORM !== 'web') {
    const { saveFile } = await import('../desktop/bridge.ts');
    // Asked again once the save dialog closes, and before each piece is written.
    saved = (await saveFile(out.blob, out.fileName, () => !journal.isLocked)) !== null;
    if (!saved && journal.isLocked) throw new LockedError();
  } else downloadBlob(out.blob, out.fileName);
  return { saved, entries: out.entries, mediaMissing: out.mediaMissing };
}

const PRINT_ROOT = 'lbx-print';
const IMAGE_WAIT_MS = 20_000;
/**
 * How long the print layout stays after Settings closes. On Linux the print dialog returns before
 * the pages are printed, and macOS may print on its own thread: removing the layout at once could
 * blank the pages not yet printed. A lock removes it at once regardless.
 */
const PRINT_HOLD_MS = 60_000;

/** The layout in the page now, with what it needs to be cleaned up. */
let shown: { root: HTMLElement; urls: string[]; unsubscribe: () => void; timer?: ReturnType<typeof setTimeout> } | null = null;

/**
 * Lays the entries out in a part of the page that only shows on paper, then opens the print
 * window. The layout stays until the next print, until `releasePrintView`'s grace period ends, or
 * until the journal locks.
 */
export async function printEntries(journal: Journal, chosen: Entry[], signal?: AbortSignal): Promise<ExportResult> {
  clearPrintView();
  const entries = chronological(chosen);
  const urls: string[] = [];
  const revoke = () => urls.forEach((u) => URL.revokeObjectURL(u));
  const lookup = new Map<string, ExportMedia>();
  let missing = 0;
  const unlessLocked = (err: unknown) => {
    if (err instanceof LockedError || journal.isLocked) throw new LockedError();
    return undefined;
  };
  const urlOf = async (id: string) => {
    const blob = await journal.getMediaBlob(id).catch(unlessLocked);
    if (!blob) return undefined;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };
  try {
    for (const id of new Set(entries.flatMap(referencedMediaIds))) {
      if (stopped(journal, signal)) break;
      const meta = await journal.getMediaMeta(id).catch(unlessLocked);
      if (!meta) {
        missing++;
        continue;
      }
      const kind = mediaKind(meta.mime);
      const info: ExportMedia = { kind, name: meta.name, width: meta.width, height: meta.height };
      if (kind === 'image') {
        info.src = await urlOf(id);
        if (!info.src) missing++;
      } else if (kind === 'video' && meta.posterId) info.posterSrc = await urlOf(meta.posterId);
      lookup.set(id, info);
    }
  } catch (err) {
    revoke();
    throw err;
  }
  if (journal.isLocked) {
    revoke();
    throw new LockedError();
  }
  if (signal?.aborted) {
    revoke();
    return NOT_SAVED;
  }

  const root = document.createElement('div');
  root.id = PRINT_ROOT;
  const [first, last] = [entries[0]?.date, entries.at(-1)?.date];
  const span = first && last ? (first === last ? formatLongDate(first) : `${formatLongDate(first)} – ${formatLongDate(last)}`) : '';
  root.innerHTML = `<style>${EXPORT_CSS}${PRINT_ONLY_CSS}</style><header class="lbx-header"><h1>Logbook</h1><p>${escapeText(`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${span ? `, ${span}` : ''}`)}</p></header>${entriesHtml(entries, (id) => lookup.get(id), { mode: 'print', formatDate: (d) => formatLongDate(d) })}`;
  document.body.append(root);
  // The decrypted entries never outlive a lock.
  const unsubscribe = journal.subscribe((e) => e === 'lock' && journal.isLocked && clearPrintView());
  shown = { root, urls, unsubscribe };
  // Every picture ready before the print window takes its snapshot (but never wait forever).
  const ready = Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
  await Promise.race([ready, new Promise((r) => setTimeout(r, IMAGE_WAIT_MS))]);
  if (shown?.root !== root || stopped(journal, signal)) {
    if (shown?.root === root) clearPrintView();
    if (journal.isLocked) throw new LockedError();
    return NOT_SAVED;
  }

  if (import.meta.env.VITE_PLATFORM !== 'web') {
    const { printPage } = await import('../desktop/bridge.ts');
    await printPage();
  } else window.print();
  return { saved: true, entries: entries.length, mediaMissing: missing };
}

/** Takes the print layout away now and frees its pictures. */
export function clearPrintView(): void {
  window.removeEventListener('beforeprint', clearPrintView);
  if (shown) {
    clearTimeout(shown.timer);
    shown.unsubscribe();
    shown.urls.forEach((u) => URL.revokeObjectURL(u));
    shown = null;
  }
  // Every copy, should one ever have been left behind.
  document.querySelectorAll(`[id="${PRINT_ROOT}"]`).forEach((el) => el.remove());
}

/**
 * Settings is closing: remove the layout once anything still printing has had time to finish, or
 * as soon as anything else is printed (Ctrl+P on another page), which must show that page.
 */
export function releasePrintView(): void {
  if (shown && !shown.timer) {
    shown.timer = setTimeout(clearPrintView, PRINT_HOLD_MS);
    window.addEventListener('beforeprint', clearPrintView, { once: true });
  }
}

const escapeText = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** On screen the layout is hidden; on paper it's the only thing there. */
const PRINT_ONLY_CSS = `
#${PRINT_ROOT} { display: none; }
@media print {
  html, body { background: #fff !important; color: #000 !important; height: auto !important; overflow: visible !important; }
  body > *:not(#${PRINT_ROOT}) { display: none !important; }
  #${PRINT_ROOT} { display: block; }
  #${PRINT_ROOT} .lbx-header { max-width: none; }
  #${PRINT_ROOT} .lbx-header h1 { font: 700 20pt/1.2 system-ui, sans-serif; margin: 0 0 4pt; color: #000; }
  #${PRINT_ROOT} .lbx-header p { font: 10pt/1.4 system-ui, sans-serif; color: #555; margin: 0 0 14pt; }
  #${PRINT_ROOT} .lbx { max-width: none; }
}
`;
