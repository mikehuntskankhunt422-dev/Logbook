import { entrySchema, extensionFor, isSealed, mimeForExtension, paths, type Entry, type MediaMeta, type RecordStore, type StoreKeys, type StoreName, type StoreRecords } from '@logbook/core';
import { assertRelativePath, type FsBackend } from './backend.ts';

/**
 * The desktop journal: a folder of plain files in the backup zip's layout (PLAN §1.2, core
 * backup.ts), so a backup unzips into a working journal and the folder can sit in OneDrive or
 * Dropbox.
 *
 *   logbook.json                                        settings and, with a passcode, the vault
 *   entries/2026/2026-10-07--a-good-day--k3f9x2.json    one file per entry, named for people
 *   trash/2026/…                                        deleted entries
 *   entries/<id>.json.enc                               an entry when a passcode is on
 *   media/k3/<id>.meta.json + <id>.jpg                  media and their details
 *   media/k3/<id>.meta.json.enc + <id>.bin.enc          the same with a passcode
 *   .logbook/book-draft.json, book-orders.json          the book builder's state; not part of backups
 *
 * The store keeps an index from record ID to file, built by scanning the folder. A file renamed
 * by another computer (an entry's new title) can briefly leave two files for one ID: reads take
 * the higher `rev`, and the next save removes the other. Files a sync tool made when two
 * computers changed the same file ("… (conflicted copy).json", "…-LAPTOP.json") don't match the
 * naming scheme; they are left alone and listed by `conflicts()`.
 */

export const LOGBOOK_FILE = 'logbook.json';
export const FOLDER_FORMAT = 'logbook';
export const FOLDER_VERSION = 1;

const KEY_FILES: Record<'bookDraft' | 'bookOrders', string> = {
  bookDraft: '.logbook/book-draft.json',
  bookOrders: '.logbook/book-orders.json',
};

const ID = '[0-9a-z]+';
const ENTRY_PLAIN = new RegExp(`^(?:entries|trash)/(?:\\d{4}/)?[^/]*--(${ID})\\.json$`);
const ENTRY_SEALED = new RegExp(`^entries/(${ID})\\.json\\.enc$`);
const MEDIA_META = new RegExp(`^media/[^/]+/(${ID})\\.meta\\.json(\\.enc)?$`);
const MEDIA_DATA = new RegExp(`^media/[^/]+/(${ID})\\.(?!meta\\.)([a-z0-9]{1,8})(\\.enc)?$`);
/** Files the operating system or sync tools leave around, and our own temporary files. */
const IGNORED = /(^|\/)(\.DS_Store|desktop\.ini|Thumbs\.db|\.dropbox[^/]*|~\$[^/]*)$|\.logbook-tmp-[^/]*$/i;

export interface ConflictFile {
  path: string;
  /** The record the file probably belongs to, if its name still contains a known ID. */
  id: string | null;
  kind: 'entry' | 'media';
}

interface LogbookFile {
  format: string;
  version: number;
  settings?: unknown;
  vault?: StoreKeys['vault'];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const jsonBytes = (v: unknown) => encoder.encode(`${JSON.stringify(v, null, 2)}\n`);

export class FolderStore implements RecordStore {
  readonly kind = 'filesystem' as const;

  private entries = new Map<string, string[]>();
  private media = new Map<string, string[]>();
  private blobs = new Map<string, string>();
  private strays: string[] = [];
  private unreadable = new Set<string>();
  /** Every change runs in order, so two saves of one entry can't interleave their renames. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(readonly fs: FsBackend) {}

  /** Opens (or starts) a journal in the folder behind `fs`. */
  static async open(fs: FsBackend): Promise<FolderStore> {
    const store = new FolderStore(fs);
    const lb = await store.readLogbook();
    if (lb && lb.format !== FOLDER_FORMAT) throw new Error(`${LOGBOOK_FILE} in this folder isn't a Logbook journal.`);
    if (lb && lb.version > FOLDER_VERSION) throw new Error('This journal was saved by a newer version of Logbook. Update the app first.');
    await store.rescan();
    return store;
  }

  /** Rebuilds the index from the folder: after a sync tool or another computer changed it. */
  async rescan(): Promise<void> {
    const entries = new Map<string, string[]>();
    const media = new Map<string, string[]>();
    const blobs = new Map<string, string>();
    const strays: string[] = [];
    const add = (m: Map<string, string[]>, id: string, path: string) => m.set(id, [...(m.get(id) ?? []), path]);
    const files = [...(await this.fs.list('entries')), ...(await this.fs.list('trash')), ...(await this.fs.list('media'))];
    for (const path of files.sort()) {
      if (IGNORED.test(path)) continue;
      let m: RegExpExecArray | null;
      if ((m = ENTRY_PLAIN.exec(path) ?? ENTRY_SEALED.exec(path))) add(entries, m[1]!, path);
      else if ((m = MEDIA_META.exec(path))) add(media, m[1]!, path);
      else if ((m = MEDIA_DATA.exec(path)) && (!m[3] || m[2] === 'bin')) {
        // Two data files for one ID only happen mid-change; keep the sealed one if there is one.
        if (!blobs.has(m[1]!) || path.endsWith('.enc')) blobs.set(m[1]!, path);
      } else strays.push(path);
    }
    this.entries = entries;
    this.media = media;
    this.blobs = blobs;
    this.strays = strays;
    this.unreadable.clear();
  }

  /**
   * Files in the journal's folders that don't follow its naming scheme: usually copies a sync
   * tool made when two computers changed the same file. Nothing reads them; a person decides.
   */
  conflicts(): ConflictFile[] {
    return this.strays.map((path) => {
      const ids = [...path.matchAll(/[0-9a-z]{12}/g)].map((m) => m[0]);
      const known = path.startsWith('media/') ? this.media : this.entries;
      return { path, id: ids.find((id) => known.has(id)) ?? null, kind: path.startsWith('media/') ? 'media' : 'entry' };
    });
  }

  /** Files that couldn't be read as JSON the last time they were read (a sync still in progress, or damage). */
  unreadableFiles(): string[] {
    return [...this.unreadable];
  }

  async all<S extends StoreName>(store: S): Promise<StoreRecords[S][]> {
    const out: StoreRecords[S][] = [];
    for (const id of [...this.table(store).keys()]) {
      const r = await this.get(store, id);
      if (r) out.push(r);
    }
    return out;
  }

  async get<S extends StoreName>(store: S, id: string): Promise<StoreRecords[S] | undefined> {
    let best: StoreRecords[S] | undefined;
    for (const path of this.table(store).get(id) ?? []) {
      const r = await this.readJson<StoreRecords[S]>(path);
      if (r && (!best || rev(r) > rev(best))) best = r;
    }
    return best;
  }

  put<S extends StoreName>(store: S, record: StoreRecords[S]): Promise<void> {
    return this.serial(async () => {
      const path = store === 'entries' ? entryPath(record as StoreRecords['entries']) : metaPath(record as StoreRecords['media']);
      assertRelativePath(path);
      await this.fs.write(path, jsonBytes(record));
      const table = this.table(store);
      for (const old of table.get(record.id) ?? []) if (old !== path) await this.fs.remove(old);
      table.set(record.id, [path]);
      this.unreadable.delete(path);
      if (store === 'media') await this.renameBlobFor(record as StoreRecords['media']);
    });
  }

  delete(store: StoreName, id: string): Promise<void> {
    return this.serial(async () => {
      const table = this.table(store);
      for (const path of table.get(id) ?? []) await this.fs.remove(path);
      table.delete(id);
    });
  }

  async getBlob(id: string): Promise<Blob | undefined> {
    const path = this.blobs.get(id);
    if (!path) return undefined;
    const data = await this.fs.read(path);
    if (!data) return undefined;
    return new Blob([data], { type: path.endsWith('.enc') ? 'application/octet-stream' : mimeForExtension(path.slice(path.lastIndexOf('.') + 1)) });
  }

  putBlob(id: string, blob: Blob): Promise<void> {
    return this.serial(async () => {
      const data = new Uint8Array(await blob.arrayBuffer());
      const meta = await this.get('media', id);
      const path = meta ? blobPath(meta) : `media/${id.slice(0, 2)}/${id}.${extensionFor({ mime: blob.type, name: '' })}`;
      assertRelativePath(path);
      await this.fs.write(path, data);
      const old = this.blobs.get(id);
      if (old && old !== path) await this.fs.remove(old);
      this.blobs.set(id, path);
    });
  }

  deleteBlob(id: string): Promise<void> {
    return this.serial(async () => {
      const path = this.blobs.get(id);
      if (path) await this.fs.remove(path);
      this.blobs.delete(id);
    });
  }

  async getKey<K extends keyof StoreKeys>(key: K): Promise<StoreKeys[K] | undefined> {
    if (key === 'settings' || key === 'vault') return (await this.readLogbook())?.[key as 'settings' | 'vault'] as StoreKeys[K] | undefined;
    return (await this.readJson(KEY_FILES[key as 'bookDraft' | 'bookOrders'])) as StoreKeys[K] | undefined;
  }

  setKey<K extends keyof StoreKeys>(key: K, value: StoreKeys[K] | undefined): Promise<void> {
    return this.serial(async () => {
      if (key === 'settings' || key === 'vault') {
        const lb: LogbookFile = (await this.readLogbook()) ?? { format: FOLDER_FORMAT, version: FOLDER_VERSION };
        const field = key as 'settings' | 'vault';
        if (value === undefined) delete lb[field];
        else (lb as unknown as Record<string, unknown>)[field] = value;
        await this.fs.write(LOGBOOK_FILE, jsonBytes(lb));
        return;
      }
      const path = KEY_FILES[key as 'bookDraft' | 'bookOrders'];
      if (value === undefined) await this.fs.remove(path);
      else await this.fs.write(path, jsonBytes(value));
    });
  }

  clearContent(): Promise<void> {
    return this.serial(async () => {
      for (const paths of [...this.entries.values(), ...this.media.values()]) for (const p of paths) await this.fs.remove(p);
      for (const p of this.blobs.values()) await this.fs.remove(p);
      this.entries.clear();
      this.media.clear();
      this.blobs.clear();
    });
  }

  private table(store: StoreName): Map<string, string[]> {
    return store === 'entries' ? this.entries : this.media;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** A media file is named after its details (extension, sealed or not): keep it in step with them. */
  private async renameBlobFor(meta: StoreRecords['media']): Promise<void> {
    const old = this.blobs.get(meta.id);
    const want = blobPath(meta);
    if (!old || old === want) return;
    await this.fs.rename(old, want);
    this.blobs.set(meta.id, want);
  }

  private async readLogbook(): Promise<LogbookFile | undefined> {
    return this.readJson<LogbookFile>(LOGBOOK_FILE);
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    const data = await this.fs.read(path);
    if (!data) return undefined;
    try {
      const value = JSON.parse(decoder.decode(data)) as T;
      this.unreadable.delete(path);
      return value;
    } catch {
      this.unreadable.add(path);
      return undefined;
    }
  }
}

function rev(r: unknown): number {
  const v = (r as { rev?: unknown }).rev;
  return typeof v === 'number' ? v : 0;
}

function entryPath(r: StoreRecords['entries']): string {
  if (isSealed(r)) return paths.sealedEntry(r.id);
  const parsed = entrySchema.safeParse(r);
  // An entry that doesn't parse still gets a file; its name just uses what's there.
  const e: Entry = parsed.success ? parsed.data : ({ ...r, date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) ? r.date : '0000-00-00' } as Entry);
  return paths.entry(e);
}

function metaPath(r: StoreRecords['media']): string {
  return isSealed(r) ? paths.sealedMediaMeta(r.id) : paths.mediaMeta(r.id);
}

function blobPath(r: StoreRecords['media']): string {
  return isSealed(r) ? paths.sealedMediaData(r.id) : paths.mediaData(r as MediaMeta);
}
