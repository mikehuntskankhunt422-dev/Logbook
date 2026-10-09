import { ISO_DATE, extensionFor, isSealed, paths, type Entry, type EntryRecord, type MediaMeta, type MediaRecord } from '@logbook/core';

/**
 * The journal folder uses the backup zip's layout (PLAN §1.2, D7), so a folder and a backup of it
 * hold the same files:
 *
 *   logbook.json                                         format, version, passcode vault (D80)
 *   entries/2026/2026-10-07--a-good-day--k3f9x2m4n5p6.json
 *   trash/2026/…json                                     deleted entries
 *   media/k3/k3f9x2m4n5p6.meta.json + k3f9x2m4n5p6.jpg   media details and the file itself
 *   entries/<id>.json.enc, media/<xx>/<id>.meta.json.enc, media/<xx>/<id>.bin.enc   with a passcode
 */

export const LOGBOOK_FILE = 'logbook.json';
export const FOLDER_FORMAT = 'logbook';
export const FOLDER_VERSION = 1;

/** Temporary files the store writes before renaming them into place (D81). */
export const TEMP_PREFIX = '~lb-';

/**
 * Ids become file names, so only these are accepted from files or for writing. Every id Logbook
 * makes (`newId`) fits; anything else in a synced folder (`../x`) is ignored rather than followed.
 */
const SAFE_ID = /^[0-9A-Za-z_-]{1,64}$/;

export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id);
}

export type FileKind = 'logbook' | 'entry' | 'media-meta' | 'media-data' | 'temp' | 'other';

/** What a path in the folder is, from its name alone. Entry and meta ids come from the content. */
export function classify(path: string): { kind: FileKind; id?: string } {
  if (path === LOGBOOK_FILE) return { kind: 'logbook' };
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name.startsWith(TEMP_PREFIX) && name.endsWith('.tmp')) return { kind: 'temp' };
  if (/^(entries|trash)\//.test(path) && /\.json(\.enc)?$/.test(name)) return { kind: 'entry' };
  if (/^media\/[^/]+\/[^/]+$/.test(path)) {
    if (/\.meta\.json(\.enc)?$/.test(name)) return { kind: 'media-meta' };
    const dot = name.indexOf('.');
    const stem = name.slice(0, dot);
    if (dot > 0 && isSafeId(stem)) return { kind: 'media-data', id: stem };
  }
  return { kind: 'other' };
}

export function isTextKind(kind: FileKind): boolean {
  return kind === 'logbook' || kind === 'entry' || kind === 'media-meta';
}

/**
 * Where an entry record belongs: dated and titled for plaintext (trash when deleted), by id when
 * sealed. `null` for a plaintext record without a valid date, which can't be placed.
 */
export function entryPath(rec: EntryRecord): string | null {
  if (isSealed(rec)) return paths.sealedEntry(rec.id);
  const e = rec as Partial<Entry>;
  if (!isSafeId(e.id) || typeof e.date !== 'string' || !ISO_DATE.test(e.date)) return null;
  return paths.entry({ ...(e as Entry), title: typeof e.title === 'string' ? e.title : '', deletedAt: e.deletedAt ?? null });
}

export function mediaMetaPath(rec: MediaRecord): string {
  return isSealed(rec) ? paths.sealedMediaMeta(rec.id) : paths.mediaMeta(rec.id);
}

/** A plaintext media file is named by id and the type in its details (`k3f9….jpg`). */
export function mediaDataPath(id: string, ext: string): string {
  return `media/${id.slice(0, 2)}/${id}.${ext}`;
}

export function sealedMediaDataPath(id: string): string {
  return paths.sealedMediaData(id);
}

export function plainMediaDataPath(meta: MediaMeta): string {
  return mediaDataPath(meta.id, extensionFor(meta));
}

/** Files operating systems drop into folders; a folder holding only these counts as empty. */
export const OS_JUNK = new Set(['.DS_Store', 'desktop.ini', 'Thumbs.db', '.localized']);
