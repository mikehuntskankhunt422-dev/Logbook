import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { openVault, type Vault } from './crypto.ts';
import { slugify } from './ids.ts';
import type { Journal } from './journal.ts';
import { entrySchema, mediaMetaSchema, settingsSchema, type Entry, type MediaMeta } from './model.ts';
import { isSealed, type SealedRecord } from './storage.ts';

/**
 * Backup zip = the desktop folder layout (PLAN §1.2) plus manifest.json with SHA-256 checksums.
 *
 *   logbook.json                                   settings (+ vault when exported encrypted)
 *   entries/2026/2026-10-07--a-good-day--k3f9x2.json
 *   trash/2026/2026-09-01--old--a8d2kq.json        soft-deleted entries
 *   media/k3/k3f9x2m4n5p6.meta.json + .jpg
 *   entries/<id>.json.enc, media/<xx>/<id>.meta.json.enc, media/<xx>/<id>.bin.enc   (encrypted export)
 *   manifest.json
 */

export const BACKUP_FORMAT = 'logbook-backup';
export const BACKUP_VERSION = 1;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  app: string;
  encrypted: boolean;
  counts: { entries: number; media: number };
  files: Record<string, string>;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'application/pdf': 'pdf',
};

export function extensionFor(meta: Pick<MediaMeta, 'mime' | 'name'>): string {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(meta.name)?.[1]?.toLowerCase();
  return EXT_BY_MIME[meta.mime] ?? fromName ?? 'bin';
}

export const paths = {
  entry: (e: Entry) =>
    `${e.deletedAt ? 'trash' : 'entries'}/${e.date.slice(0, 4)}/${e.date}--${slugify(e.title || 'untitled')}--${e.id}.json`,
  sealedEntry: (id: string) => `entries/${id}.json.enc`,
  mediaMeta: (id: string) => `media/${id.slice(0, 2)}/${id}.meta.json`,
  sealedMediaMeta: (id: string) => `media/${id.slice(0, 2)}/${id}.meta.json.enc`,
  mediaData: (m: MediaMeta) => `media/${m.id.slice(0, 2)}/${m.id}.${extensionFor(m)}`,
  sealedMediaData: (id: string) => `media/${id.slice(0, 2)}/${id}.bin.enc`,
};

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const json = (v: unknown) => strToU8(JSON.stringify(v, null, 2));

export interface ExportOptions {
  /**
   * Only for an encrypted journal: copy ciphertext as-is (needs the passcode to restore).
   * Otherwise the backup is plaintext.
   */
  keepEncrypted?: boolean;
  app?: string;
  onProgress?: (done: number, total: number) => void;
}

export async function exportBackup(journal: Journal, opts: ExportOptions = {}): Promise<Blob> {
  const keepEncrypted = Boolean(opts.keepEncrypted && journal.isEncrypted);
  const parts: Uint8Array[] = [];
  let finish!: () => void;
  let fail!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    finish = res;
    fail = rej;
  });
  const zip = new Zip((err, chunk, final) => {
    if (err) return fail(err);
    parts.push(chunk);
    if (final) finish();
  });

  const files: Record<string, string> = {};
  const add = async (path: string, data: Uint8Array<ArrayBuffer>, compress: boolean) => {
    files[path] = await sha256Hex(data);
    const f = compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
    zip.add(f);
    f.push(data, true);
  };

  const store = journal.store;
  let entryCount = 0;
  let mediaCount = 0;

  if (keepEncrypted) {
    const entries = await store.all('entries');
    const media = await store.all('media');
    const total = entries.length + media.length;
    let n = 0;
    for (const rec of entries) {
      await add(isSealed(rec) ? paths.sealedEntry(rec.id) : paths.entry(entrySchema.parse(rec)), json(rec), true);
      entryCount++;
      opts.onProgress?.(++n, total);
    }
    for (const rec of media) {
      const blob = await store.getBlob(rec.id);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (isSealed(rec)) {
        await add(paths.sealedMediaMeta(rec.id), json(rec), true);
        await add(paths.sealedMediaData(rec.id), bytes, false);
      } else {
        const meta = mediaMetaSchema.parse(rec);
        await add(paths.mediaMeta(meta.id), json(meta), true);
        await add(paths.mediaData(meta), bytes, false);
      }
      mediaCount++;
      opts.onProgress?.(++n, total);
    }
  } else {
    const entries = [...(await journal.listEntries()), ...(await journal.listTrash())];
    const media = await journal.listMediaMeta();
    const total = entries.length + media.length;
    let n = 0;
    for (const e of entries) {
      await add(paths.entry(e), json(e), true);
      entryCount++;
      opts.onProgress?.(++n, total);
    }
    for (const m of media) {
      const blob = await journal.getMediaBlob(m.id);
      if (!blob) continue;
      await add(paths.mediaMeta(m.id), json(m), true);
      await add(paths.mediaData(m), new Uint8Array(await blob.arrayBuffer()), false);
      mediaCount++;
      opts.onProgress?.(++n, total);
    }
  }

  await add(
    'logbook.json',
    json({ format: 'logbook', version: BACKUP_VERSION, settings: journal.getSettings(), vault: keepEncrypted ? journal.getVault() : undefined }),
    true,
  );
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    app: opts.app ?? 'logbook',
    encrypted: keepEncrypted,
    counts: { entries: entryCount, media: mediaCount },
    files,
  };
  const mf = new ZipDeflate('manifest.json', { level: 6 });
  zip.add(mf);
  mf.push(json(manifest), true);
  zip.end();
  await done;
  return new Blob(parts as BlobPart[], { type: 'application/zip' });
}

export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `logbook-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
}

// ── import ───────────────────────────────────────────────────────────────────────────────────────

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export class PasscodeRequiredError extends BackupError {
  constructor() {
    super('This backup is encrypted. Enter the passcode it was made with.');
    this.name = 'PasscodeRequiredError';
  }
}

async function unzipBlob(blob: Blob): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const pending = new Map<string, Uint8Array[]>();
  let error: unknown;
  const unzip = new Unzip((file) => {
    if (file.name.endsWith('/')) return;
    const chunks: Uint8Array[] = [];
    pending.set(file.name, chunks);
    file.ondata = (err, data, final) => {
      if (err) {
        error = err;
        return;
      }
      chunks.push(data);
      if (final) {
        const size = chunks.reduce((s, c) => s + c.length, 0);
        const out = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) {
          out.set(c, o);
          o += c.length;
        }
        files.set(file.name, out);
        pending.delete(file.name);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    unzip.push(value);
    if (error) break;
  }
  if (!error) unzip.push(new Uint8Array(0), true);
  if (error) throw new BackupError('This zip file is damaged or not a Logbook backup.');
  return files;
}

export interface ImportOptions {
  /** `merge` keeps existing entries and takes newer versions; `replace` empties the journal first. */
  mode: 'merge' | 'replace';
  passcode?: string;
}

export interface ImportReport {
  entriesAdded: number;
  entriesUpdated: number;
  entriesUnchanged: number;
  mediaAdded: number;
  verified: boolean;
  problems: string[];
}

export async function inspectBackup(blob: Blob): Promise<{ manifest: BackupManifest | null; encrypted: boolean }> {
  const files = await unzipBlob(blob);
  const mf = files.get('manifest.json');
  const manifest = mf ? (JSON.parse(strFromU8(mf)) as BackupManifest) : null;
  const encrypted = manifest?.encrypted ?? [...files.keys()].some((p) => p.endsWith('.enc'));
  return { manifest, encrypted };
}

export async function importBackup(journal: Journal, blob: Blob, opts: ImportOptions): Promise<ImportReport> {
  const files = await unzipBlob(blob);
  const looksLikeBackup = [...files.keys()].some((p) => p === 'manifest.json' || p === 'logbook.json' || /^(entries|trash|media)\//.test(p));
  if (!looksLikeBackup) throw new BackupError('This file is not a Logbook backup.');
  const report: ImportReport = { entriesAdded: 0, entriesUpdated: 0, entriesUnchanged: 0, mediaAdded: 0, verified: false, problems: [] };

  const mfBytes = files.get('manifest.json');
  if (mfBytes) {
    const manifest = JSON.parse(strFromU8(mfBytes)) as BackupManifest;
    if (manifest.format !== BACKUP_FORMAT) throw new BackupError('This zip is not a Logbook backup.');
    if (manifest.version > BACKUP_VERSION) throw new BackupError('This backup was made by a newer version of Logbook. Update the app first.');
    for (const [path, hash] of Object.entries(manifest.files)) {
      const data = files.get(path);
      if (!data) throw new BackupError(`The backup is incomplete: ${path} is missing.`);
      if ((await sha256Hex(data)) !== hash) throw new BackupError(`The backup is damaged: ${path} does not match its checksum.`);
    }
    report.verified = true;
  } else {
    report.problems.push('No manifest found, so file checksums could not be verified.');
  }

  const lbBytes = files.get('logbook.json');
  const lb = lbBytes ? (JSON.parse(strFromU8(lbBytes)) as { settings?: unknown; vault?: Vault }) : {};
  const anySealed = [...files.keys()].some((p) => p.endsWith('.enc'));
  let cipher = null;
  if (anySealed) {
    if (!lb.vault) throw new BackupError('This backup is encrypted but its key file is missing.');
    if (!opts.passcode) throw new PasscodeRequiredError();
    cipher = await openVault(lb.vault, opts.passcode); // throws WrongPasscodeError
  }

  // Decode everything before touching the journal, so a bad file can't leave a half-replaced journal.
  const entries: Entry[] = [];
  const metas = new Map<string, MediaMeta>();
  const blobsByStem = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [path, data] of files) {
    try {
      if (/^(entries|trash)\/.*\.json(\.enc)?$/.test(path)) {
        const raw: unknown = JSON.parse(strFromU8(data));
        const value = isSealed(raw) ? await cipher!.openJson<unknown>('entry', raw as SealedRecord) : raw;
        entries.push(entrySchema.parse(value));
      } else if (/^media\/.*\.meta\.json(\.enc)?$/.test(path)) {
        const raw: unknown = JSON.parse(strFromU8(data));
        const value = isSealed(raw) ? await cipher!.openJson<unknown>('media', raw as SealedRecord) : raw;
        const meta = mediaMetaSchema.parse(value);
        metas.set(meta.id, meta);
      } else if (path.startsWith('media/')) {
        const stem = path.slice(path.lastIndexOf('/') + 1).split('.')[0]!;
        blobsByStem.set(stem, path.endsWith('.bin.enc') ? await cipher!.openBytes(stem, data) : data);
      }
    } catch (err) {
      if ((err as Error).name === 'WrongPasscodeError') throw err;
      report.problems.push(`Skipped ${path}: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  if (opts.mode === 'replace') {
    await journal.clearContent();
    const s = settingsSchema.safeParse(lb.settings ?? {});
    if (s.success) {
      const { theme, backupReminderDays, autoLockMinutes, compressLargeMedia } = s.data;
      await journal.updateSettings({ theme, backupReminderDays, autoLockMinutes, compressLargeMedia });
    }
  }

  for (const [id, meta] of metas) {
    const data = blobsByStem.get(id);
    if (!data) {
      report.problems.push(`Media ${meta.name} has no data file; skipped.`);
      continue;
    }
    if (opts.mode === 'merge' && (await journal.getMediaMeta(id))) continue;
    await journal.importMedia(meta, new Blob([data], { type: meta.mime }));
    report.mediaAdded++;
  }

  for (const e of entries) {
    const existing = opts.mode === 'merge' ? await journal.getEntry(e.id) : undefined;
    if (!existing) {
      await journal.importEntry(e);
      report.entriesAdded++;
    } else if (e.updatedAt > existing.updatedAt) {
      await journal.importEntry(e);
      report.entriesUpdated++;
    } else {
      report.entriesUnchanged++;
    }
  }

  journal.notifyImported();
  return report;
}
