import { zipSync, strToU8, type Zippable } from 'fflate';
import { extensionFor } from '../backup.ts';
import { toIsoDate } from '../dates.ts';
import type { Journal } from '../journal.ts';
import { mediaKind, referencedMediaIds, type Entry, type MediaMeta } from '../model.ts';
import { chronological, type ExportMedia, type MediaLookup, type RenderOptions } from './common.ts';
import { exportPageHtml } from './html.ts';
import { entryToMarkdown, entryToText } from './markdown.ts';

/**
 * Exporting entries as documents (D89), as opposed to a backup: Markdown, plain text or a web page,
 * for reading, editing or keeping elsewhere. With pictures and other media, the result is a zip
 * holding the document(s) and a `media/` folder they point to; without, a single file. Exports are
 * never encrypted, even from a journal with a passcode.
 */

export type ExportFormat = 'markdown' | 'text' | 'html';

export interface JournalExportOptions extends RenderOptions {
  format: ExportFormat;
  /** Copy photos, videos, recordings and files into the export (Markdown and web page). */
  includeMedia?: boolean;
  /** Markdown only: one file per entry (with front matter, for notes apps) or all in one. */
  layout?: 'one-file' | 'per-entry';
  now?: Date;
  onProgress?: (done: number, total: number) => void;
}

export interface JournalExport {
  blob: Blob;
  fileName: string;
  entries: number;
  mediaFiles: number;
  /** Media an entry uses that couldn't be read (still syncing, say), left out of the export. */
  mediaMissing: number;
}

const EXTENSION: Record<ExportFormat, string> = { markdown: 'md', text: 'txt', html: 'html' };
const MIME: Record<ExportFormat, string> = { markdown: 'text/markdown', text: 'text/plain', html: 'text/html' };

export async function exportEntries(journal: Journal, chosen: Entry[], opts: JournalExportOptions): Promise<JournalExport> {
  const entries = chronological(chosen);
  const day = toIsoDate(opts.now ?? new Date());
  const includeMedia = opts.format !== 'text' && Boolean(opts.includeMedia);
  const perEntry = opts.format === 'markdown' && opts.layout === 'per-entry';
  const ids = [...new Set(entries.flatMap(referencedMediaIds))];

  // Names and copies of the media, read one at a time.
  const lookup = new Map<string, ExportMedia>();
  const files: Zippable = {};
  const used = new Set<string>();
  let missing = 0;
  let done = 0;
  for (const id of ids) {
    const meta = await journal.getMediaMeta(id).catch(() => undefined);
    const name = meta ? fileNameOf(meta) : '';
    const info: ExportMedia = { kind: meta ? mediaKind(meta.mime) : 'file', name, width: meta?.width, height: meta?.height };
    if (includeMedia && meta) {
      const blob = await journal.getMediaBlob(id).catch(() => undefined);
      if (blob) {
        const file = unique(`media/${name}`, used);
        files[file] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
        // Percent-encoded, parentheses too, so the plain `](path)` form works in every Markdown reader.
        info.src = file
          .split('/')
          .map((seg) => encodeURIComponent(seg).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
          .join('/');
      } else missing++;
    } else if (includeMedia) missing++;
    lookup.set(id, info);
    opts.onProgress?.(++done, ids.length);
  }
  const media: MediaLookup = (id) => lookup.get(id);
  const render = { formatDate: opts.formatDate };
  const subtitle = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${entries.length ? `, ${dateSpan(entries, opts)}` : ''} · exported ${opts.formatDate ? opts.formatDate(day) : day}`;

  const docs: [path: string, text: string][] = [];
  if (perEntry) {
    const names = new Set<string>();
    for (const e of entries) docs.push([unique(`${safeName(`${e.date} ${e.title || 'Untitled'}`)}.md`, names), entryToMarkdown(e, media, { ...render, frontMatter: true, titleLevel: 1 })]);
  } else if (opts.format === 'markdown') {
    const body = entries.map((e) => entryToMarkdown(e, media, { ...render, titleLevel: 2 })).join('\n* * *\n\n');
    docs.push([`Logbook ${day}.md`, `# Logbook\n\n*${subtitle}*\n\n${body}`]);
  } else if (opts.format === 'text') {
    const rule = `\n${'─'.repeat(40)}\n\n`;
    docs.push([`Logbook ${day}.txt`, `Logbook\n${subtitle}${rule}${entries.map((e) => entryToText(e, media, render)).join(rule)}`]);
  } else {
    docs.push([includeMedia ? 'index.html' : `Logbook ${day}.html`, exportPageHtml(entries, media, { ...render, mode: 'page', subtitle })]);
  }

  const mediaFiles = Object.keys(files).length;
  if (docs.length === 1 && mediaFiles === 0) {
    const [[path, text]] = docs as [[string, string]];
    const blob = new Blob([text], { type: `${MIME[opts.format]};charset=utf-8` });
    return { blob, fileName: path.endsWith('index.html') ? `Logbook ${day}.html` : path, entries: entries.length, mediaFiles, mediaMissing: missing };
  }
  // A zip opens into one folder, not a scatter of files.
  const root = `Logbook export ${day}`;
  const zip: Zippable = {};
  for (const [path, text] of docs) zip[`${root}/${path}`] = [strToU8(text), { level: 6 }];
  for (const [path, data] of Object.entries(files)) zip[`${root}/${path}`] = data;
  const bytes = zipSync(zip);
  return { blob: new Blob([bytes as BlobPart], { type: 'application/zip' }), fileName: `${root} (${EXTENSION[opts.format]}).zip`, entries: entries.length, mediaFiles, mediaMissing: missing };
}

function dateSpan(entries: Entry[], opts: RenderOptions): string {
  const f = (iso: string) => (opts.formatDate ? opts.formatDate(iso) : iso);
  const first = entries[0]!.date;
  const last = entries.at(-1)!.date;
  return first === last ? f(first) : `${f(first)} – ${f(last)}`;
}

/** The media's own name, made safe, with the extension its type calls for. */
function fileNameOf(meta: MediaMeta): string {
  const ext = extensionFor(meta);
  const base = safeName(meta.name.replace(/\.[a-z0-9]{1,8}$/i, '')) || meta.id;
  return `${base}.${ext}`;
}

/**
 * A file name every system accepts: no characters Windows forbids, no control characters, no
 * trailing dots or spaces, no reserved device names, and not too long for deep folders.
 */
export function safeName(name: string): string {
  let s = name
    // eslint-disable-next-line no-control-regex -- control characters are exactly what's removed
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = `_${s}`;
  return [...s].slice(0, 80).join('').trim();
}

/** `name`, or `name (2)`, `name (3)`… when it's taken; remembers what it hands out. */
function unique(path: string, used: Set<string>): string {
  const m = /^(.*?)(\.[^./]*)?$/.exec(path)!;
  let candidate = path;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${m[1]} (${n})${m[2] ?? ''}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
