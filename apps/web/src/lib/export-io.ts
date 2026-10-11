import { EXPORT_CSS, chronological, entriesHtml, exportEntries, referencedMediaIds, mediaKind, type Entry, type ExportMedia, type Journal, type JournalExportOptions } from '@logbook/core';
import { formatLongDate } from '../components/common.tsx';
import { downloadBlob } from './backup-io.ts';

/**
 * Getting an export out (D89): Markdown, plain text and web pages are saved like a backup (the
 * desktop app asks where); PDF is the entries laid out for print, handed to the system's print
 * window, where "Save as PDF" makes the file.
 */

export type ExportChoice = JournalExportOptions['format'] | 'pdf';

export interface ExportResult {
  saved: boolean;
  entries: number;
  mediaMissing: number;
}

/** Makes the file and saves it; `saved` is false when the person cancelled the save dialog. */
export async function exportToFile(journal: Journal, entries: Entry[], opts: Omit<JournalExportOptions, 'formatDate'>): Promise<ExportResult> {
  const out = await exportEntries(journal, entries, { ...opts, formatDate: (d) => formatLongDate(d) });
  let saved = true;
  if (import.meta.env.VITE_PLATFORM === 'desktop') {
    const { saveFile } = await import('../desktop/bridge.ts');
    saved = (await saveFile(out.blob, out.fileName)) !== null;
  } else downloadBlob(out.blob, out.fileName);
  return { saved, entries: out.entries, mediaMissing: out.mediaMissing };
}

const PRINT_ROOT = 'lbx-print';
const IMAGE_WAIT_MS = 20_000;

/**
 * Lays the entries out in a part of the page that only shows on paper, then opens the print
 * window. The layout stays until `clearPrintView` (or the next print): the macOS print sheet reads
 * the page after this returns, so removing it at once would print a blank page.
 */
export async function printEntries(journal: Journal, chosen: Entry[]): Promise<ExportResult> {
  clearPrintView();
  const entries = chronological(chosen);
  const urls: string[] = [];
  const lookup = new Map<string, ExportMedia>();
  let missing = 0;
  const urlOf = async (id: string) => {
    const blob = await journal.getMediaBlob(id).catch(() => undefined);
    if (!blob) return undefined;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };
  for (const id of new Set(entries.flatMap(referencedMediaIds))) {
    const meta = await journal.getMediaMeta(id).catch(() => undefined);
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

  const root = document.createElement('div');
  root.id = PRINT_ROOT;
  root.dataset['urls'] = JSON.stringify(urls);
  const [first, last] = [entries[0]?.date, entries.at(-1)?.date];
  const span = first && last ? (first === last ? formatLongDate(first) : `${formatLongDate(first)} – ${formatLongDate(last)}`) : '';
  root.innerHTML = `<style>${EXPORT_CSS}${PRINT_ONLY_CSS}</style><header class="lbx-header"><h1>Logbook</h1><p>${escapeText(`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${span ? `, ${span}` : ''}`)}</p></header>${entriesHtml(entries, (id) => lookup.get(id), { mode: 'print', formatDate: (d) => formatLongDate(d) })}`;
  document.body.append(root);
  // Every picture ready before the print window takes its snapshot (but never wait forever).
  const ready = Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
  await Promise.race([ready, new Promise((r) => setTimeout(r, IMAGE_WAIT_MS))]);

  if (import.meta.env.VITE_PLATFORM === 'desktop') {
    const { printPage } = await import('../desktop/bridge.ts');
    await printPage();
  } else window.print();
  return { saved: true, entries: entries.length, mediaMissing: missing };
}

/** Takes the print layout away and frees its pictures. */
export function clearPrintView(): void {
  const old = document.getElementById(PRINT_ROOT);
  if (!old) return;
  for (const url of JSON.parse(old.dataset['urls'] ?? '[]') as string[]) URL.revokeObjectURL(url);
  old.remove();
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
