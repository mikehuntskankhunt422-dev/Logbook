import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { extensionFor } from '../backup.ts';
import { toIsoDate } from '../dates.ts';
import { LockedError, type Journal } from '../journal.ts';
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
  /** Stops the export (Settings closed): it rejects with the signal's reason, an AbortError. */
  signal?: AbortSignal;
  /** Tests only: a smaller ceiling than EXPORT_ZIP_LIMIT. */
  zipLimit?: number;
}

export interface JournalExport {
  blob: Blob;
  fileName: string;
  entries: number;
  mediaFiles: number;
  /** Media an entry uses that couldn't be read (still syncing, say), left out of the export. */
  mediaMissing: number;
}

/**
 * fflate writes no Zip64 records, so a zip must stay under 4 GiB; the margin leaves room for the
 * documents and the zip's own headers.
 */
export const EXPORT_ZIP_LIMIT = 0xffffffff - 64 * 1024 * 1024;

export class ExportTooLargeError extends Error {
  constructor() {
    super('These entries have too many photos and videos for one export file (more than 4 GB). Export a year or a shorter range at a time, or leave out the media.');
    this.name = 'ExportTooLargeError';
  }
}

const EXTENSION: Record<ExportFormat, string> = { markdown: 'md', text: 'txt', html: 'html' };
const MIME: Record<ExportFormat, string> = { markdown: 'text/markdown', text: 'text/plain', html: 'text/html' };

export async function exportEntries(journal: Journal, chosen: Entry[], opts: JournalExportOptions): Promise<JournalExport> {
  const entries = chronological(chosen);
  const day = toIsoDate(opts.now ?? new Date());
  const includeMedia = opts.format !== 'text' && Boolean(opts.includeMedia);
  const perEntry = opts.format === 'markdown' && opts.layout === 'per-entry';
  const ids = [...new Set(entries.flatMap(referencedMediaIds))];

  // The zip is written as it goes, one media file at a time, each piece of it moved into a Blob
  // as it comes out, so the export holds about one copy of itself plus the file being added
  // (fflate hands media through without copying it; a Blob made of Blobs copies nothing).
  const root = `Logbook export ${day}`;
  const limit = opts.zipLimit ?? EXPORT_ZIP_LIMIT;
  let archive: { zip: Zip; parts: Blob[]; done: Promise<void> } | undefined;
  let zipBytes = 0;
  const addToZip = (path: string, data: Uint8Array, compress: boolean) => {
    zipBytes += data.length + 128 + 2 * path.length;
    if (zipBytes > limit) throw new ExportTooLargeError();
    if (!archive) {
      const parts: Blob[] = [];
      let zip!: Zip;
      const done = new Promise<void>((resolve, reject) => {
        zip = new Zip((err, chunk, final) => {
          if (err) return reject(err);
          parts.push(new Blob([chunk as BlobPart]));
          if (final) resolve();
        });
      });
      archive = { zip, parts, done };
    }
    const f = compress ? new ZipDeflate(`${root}/${path}`, { level: 6 }) : new ZipPassThrough(`${root}/${path}`);
    archive.zip.add(f);
    f.push(data, true);
  };

  // Names and copies of the media, read one at a time. A lock part-way stops the export: what's
  // left can't be read, and an export with holes in it would look complete.
  const lookup = new Map<string, ExportMedia>();
  const used = new Set<string>();
  const unlessLocked = (err: unknown) => {
    if (err instanceof LockedError || journal.isLocked) throw new LockedError();
    return undefined;
  };
  let missing = 0;
  let mediaFiles = 0;
  let done = 0;
  // Every record first: an export too big for one zip is refused before any media is read.
  const metas = new Map<string, MediaMeta>();
  for (const id of ids) {
    opts.signal?.throwIfAborted();
    const meta = await journal.getMediaMeta(id).catch(unlessLocked);
    if (meta) metas.set(id, meta);
  }
  if (includeMedia && [...metas.values()].reduce((sum, m) => sum + m.bytes + 128 + 2 * (m.name.length + 8), 0) > limit) throw new ExportTooLargeError();
  for (const id of ids) {
    opts.signal?.throwIfAborted();
    const meta = metas.get(id);
    if (!meta) {
      // Without its record the block names itself by its own type ("Photo", "Video").
      if (includeMedia) missing++;
      opts.onProgress?.(++done, ids.length);
      continue;
    }
    const name = fileNameOf(meta);
    const info: ExportMedia = { kind: mediaKind(meta.mime), name, width: meta.width, height: meta.height };
    if (includeMedia) {
      const blob = await journal.getMediaBlob(id).catch(unlessLocked);
      if (blob) {
        const file = unique(`media/${name}`, used);
        addToZip(file, new Uint8Array(await blob.arrayBuffer()), false);
        mediaFiles++;
        // Percent-encoded, parentheses too, so the plain `](path)` form works in every Markdown reader.
        info.src = file
          .split('/')
          .map((seg) => encodeURIComponent(seg).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
          .join('/');
      } else missing++;
    }
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

  if (docs.length === 1 && mediaFiles === 0) {
    const [[path, text]] = docs as [[string, string]];
    const blob = new Blob([text], { type: `${MIME[opts.format]};charset=utf-8` });
    return { blob, fileName: path.endsWith('index.html') ? `Logbook ${day}.html` : path, entries: entries.length, mediaFiles, mediaMissing: missing };
  }
  // A zip opens into one folder, not a scatter of files.
  for (const [path, text] of docs) addToZip(path, strToU8(text), true);
  const { zip, parts, done: finished } = archive!;
  zip.end();
  await finished;
  return { blob: new Blob(parts, { type: 'application/zip' }), fileName: `${root} (${EXTENSION[opts.format]}).zip`, entries: entries.length, mediaFiles, mediaMissing: missing };
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
