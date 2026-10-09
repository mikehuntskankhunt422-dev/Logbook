import {
  extensionFor,
  isSealed,
  isSealedBlob,
  mimeForExtension,
  newId,
  type EntryRecord,
  type MediaMeta,
  type MediaRecord,
  type RecordStore,
  type StoreKeys,
  type StoreName,
  type StoreRecords,
  type Vault,
} from '@logbook/core';
import type { FileInfo, JournalFs, LocalKeys } from './fs.ts';
import {
  FOLDER_FORMAT,
  FOLDER_VERSION,
  LOGBOOK_FILE,
  TEMP_PREFIX,
  classify,
  entryPath,
  isSafeId,
  isTextKind,
  mediaDataPath,
  mediaMetaPath,
  plainMediaDataPath,
  sealedMediaDataPath,
} from './layout.ts';

/** One file holding a record. Several versions of one id are a sync conflict (D82). */
export interface Version<T> {
  path: string;
  record: T;
  modifiedAt: number;
}

export interface EntryConflict {
  id: string;
  /** The first is the version Logbook currently shows. */
  versions: Version<EntryRecord>[];
}

/** What a rescan found changed, compared with the store's previous view of the folder. */
export interface FolderChanges {
  entries: boolean;
  media: boolean;
  /** The passcode vault in `logbook.json` changed: set, removed or changed on another computer. */
  vault: boolean;
  conflicts: boolean;
}

export class FolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderError';
  }
}

interface LogbookFile {
  format?: unknown;
  version?: unknown;
  createdAt?: unknown;
  vault?: Vault;
  /** Present when a backup zip was unpacked into the folder: used as this device's first settings. */
  settings?: unknown;
}

type LocalKey = Exclude<keyof StoreKeys, 'vault'>;

/** Temporary files older than this are left over from a crash and removed when the folder opens. */
const STALE_TEMP_MS = 10 * 60_000;
/** Marks a file the store just wrote: its real size and time are read on the next scan. */
const UNKNOWN_SIZE = -1;

/**
 * A `RecordStore` over a folder of ordinary files (PLAN §1.2, D80–D83), for the desktop app.
 *
 * It keeps an index of the folder in memory, rebuilt from one listing (`refresh`). Writes go to a
 * temporary file that is renamed into place, and a record whose file name depends on its content
 * (an entry's date and title) is written under the new name before the old one is removed. Files it
 * doesn't recognise are never touched. Two files with the same entry id are two versions of one
 * entry (a sync conflict): the store uses the correctly named one, or else the newest, and keeps the
 * rest until `keepVersion` or `discardVersion` is called.
 */
export class FsStore implements RecordStore {
  readonly kind = 'filesystem' as const;
  /** Files that look like journal files but couldn't be read, from the last scan. */
  problems: string[] = [];

  private files = new Map<string, FileInfo>();
  private texts = new Map<string, { raw: string; value: unknown }>();
  private entryVersions = new Map<string, Version<EntryRecord>[]>();
  private mediaVersions = new Map<string, Version<MediaRecord>[]>();
  private dataFiles = new Map<string, string[]>();
  private logbook: LogbookFile = {};
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly fs: JournalFs,
    private readonly local: LocalKeys,
  ) {}

  /**
   * Opens the journal in `fs`'s folder, making `logbook.json` if there isn't one yet. Refuses a
   * folder written by a newer version of Logbook.
   */
  static async open(fs: JournalFs, local: LocalKeys, now = Date.now()): Promise<FsStore> {
    const store = new FsStore(fs, local);
    await store.refresh();
    const existing = store.texts.get(LOGBOOK_FILE);
    if (!existing) {
      await store.exclusive(() => store.writeLogbook({ format: FOLDER_FORMAT, version: FOLDER_VERSION, createdAt: new Date(now).toISOString() }));
    } else if (typeof existing.value !== 'object' || existing.value === null) {
      throw new FolderError('This folder’s logbook.json is damaged, so Logbook can’t tell which journal it holds.');
    } else {
      const { format, version } = store.logbook;
      if (format !== FOLDER_FORMAT) throw new FolderError('This folder’s logbook.json isn’t a Logbook journal.');
      if (typeof version === 'number' && version > FOLDER_VERSION) throw new FolderError('This journal was saved by a newer version of Logbook. Update the app to open it.');
    }
    await store.exclusive(async () => {
      for (const f of store.files.values()) {
        if (classify(f.path).kind === 'temp' && now - f.mtimeMs > STALE_TEMP_MS) await store.removeFile(f.path);
      }
    });
    return store;
  }

  // ── scanning ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Lists the folder and reads every journal text file that's new or whose size or time changed,
   * then reports what changed. A file whose content equals what the store last wrote or read isn't
   * a change, so the store's own writes never count (D83).
   */
  refresh(): Promise<FolderChanges> {
    return this.exclusive(async () => {
      const before = this.snapshot();
      const listed = await this.fs.list();
      const next = new Map<string, FileInfo>();
      const toRead: string[] = [];
      for (const f of listed) {
        const kind = classify(f.path).kind;
        if (kind === 'other') continue;
        next.set(f.path, f);
        const known = this.files.get(f.path);
        if (isTextKind(kind) && (!known || known.size !== f.size || known.mtimeMs !== f.mtimeMs || !this.texts.has(f.path))) toRead.push(f.path);
      }
      const raws = toRead.length ? await this.fs.readTexts(toRead) : [];
      toRead.forEach((path, i) => {
        const raw = raws[i];
        if (raw === null || raw === undefined) {
          next.delete(path); // gone between the listing and the read
          this.texts.delete(path);
        } else if (this.texts.get(path)?.raw !== raw) {
          this.setText(path, raw);
        }
      });
      for (const path of [...this.texts.keys()]) if (!next.has(path)) this.texts.delete(path);
      this.files = next;
      this.regroup();
      const after = this.snapshot();
      return {
        entries: !sameMap(before.entries, after.entries),
        media: !sameMap(before.media, after.media),
        vault: before.vault !== after.vault,
        conflicts: before.conflicts !== after.conflicts,
      };
    });
  }

  private setText(path: string, raw: string): void {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = undefined; // reported by regroup(); re-read when the file changes
    }
    this.texts.set(path, { raw, value });
  }

  /** Rebuilds the id → versions index from the files and texts. */
  private regroup(): void {
    this.entryVersions.clear();
    this.mediaVersions.clear();
    this.dataFiles.clear();
    this.problems = [];
    for (const f of this.files.values()) {
      const c = classify(f.path);
      if (c.kind === 'logbook') {
        const v = this.texts.get(f.path)?.value;
        this.logbook = typeof v === 'object' && v !== null ? (v as LogbookFile) : {};
        if (this.texts.has(f.path) && v === undefined) this.problems.push(`${f.path}: not valid JSON`);
      } else if (c.kind === 'entry' || c.kind === 'media-meta') {
        const value = this.texts.get(f.path)?.value;
        const id = (value as { id?: unknown } | undefined)?.id;
        if (typeof value !== 'object' || value === null || !isSafeId(id)) {
          if (this.texts.has(f.path)) this.problems.push(`${f.path}: ${value === undefined ? 'not valid JSON' : 'no usable id'}`);
          continue;
        }
        const map = (c.kind === 'entry' ? this.entryVersions : this.mediaVersions) as Map<string, Version<unknown>[]>;
        const list = map.get(id) ?? [];
        list.push({ path: f.path, record: value, modifiedAt: f.mtimeMs });
        map.set(id, list);
      } else if (c.kind === 'media-data') {
        const list = this.dataFiles.get(c.id!) ?? [];
        list.push(f.path);
        this.dataFiles.set(c.id!, list);
      }
    }
    if (!this.files.has(LOGBOOK_FILE)) this.logbook = {};
    const order = <T>(expected: (r: T) => string | null) => (a: Version<T>, b: Version<T>) =>
      Number(expected(b.record) === b.path) - Number(expected(a.record) === a.path) || b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path);
    for (const list of this.entryVersions.values()) list.sort(order<EntryRecord>(entryPath));
    for (const list of this.mediaVersions.values()) list.sort(order<MediaRecord>(mediaMetaPath));
    for (const list of this.dataFiles.values()) list.sort((a, b) => (this.files.get(b)?.mtimeMs ?? 0) - (this.files.get(a)?.mtimeMs ?? 0) || a.localeCompare(b));
  }

  private snapshot() {
    const entries = new Map<string, string>();
    for (const [id, versions] of this.entryVersions) entries.set(id, `${this.texts.get(versions[0]!.path)?.raw}#${versions.length}`);
    const media = new Map<string, string>();
    for (const [id, versions] of this.mediaVersions) media.set(id, `${this.texts.get(versions[0]!.path)?.raw}#${this.dataFiles.get(id)?.[0] ?? ''}`);
    const conflicts = [...this.entryVersions.values()].filter((v) => v.length > 1).length;
    return { entries, media, vault: JSON.stringify(this.logbook.vault ?? null), conflicts };
  }

  // ── conflicts ─────────────────────────────────────────────────────────────────────────────────

  /** Entries with more than one file (D82). */
  conflicts(): EntryConflict[] {
    return [...this.entryVersions.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([id, versions]) => ({ id, versions: versions.map((v) => ({ ...v, record: structuredClone(v.record) })) }));
  }

  /** Makes the version in `path` the entry, under its correct name, and removes the other versions. */
  keepVersion(id: string, path: string): Promise<void> {
    return this.exclusive(async () => {
      const versions = this.entryVersions.get(id) ?? [];
      const keep = versions.find((v) => v.path === path);
      const raw = this.texts.get(path)?.raw;
      if (!keep || raw === undefined) throw new FolderError('That version of the entry is no longer in the folder.');
      const target = entryPath(keep.record) ?? path;
      if (target !== path) await this.writeText(target, raw);
      for (const v of versions) if (v.path !== target) await this.removeFile(v.path);
      this.regroup();
    });
  }

  /** Deletes one version's file; the entry stays as its other versions. */
  discardVersion(path: string): Promise<void> {
    return this.exclusive(async () => {
      if (classify(path).kind !== 'entry' || !this.files.has(path)) throw new FolderError('That version of the entry is no longer in the folder.');
      await this.removeFile(path);
      this.regroup();
    });
  }

  // ── RecordStore ───────────────────────────────────────────────────────────────────────────────

  async all<S extends StoreName>(store: S): Promise<StoreRecords[S][]> {
    const map = store === 'entries' ? this.entryVersions : this.mediaVersions;
    return [...map.values()].map((v) => structuredClone(v[0]!.record) as StoreRecords[S]);
  }

  async get<S extends StoreName>(store: S, id: string): Promise<StoreRecords[S] | undefined> {
    const map = store === 'entries' ? this.entryVersions : this.mediaVersions;
    const v = map.get(id)?.[0];
    return v ? (structuredClone(v.record) as StoreRecords[S]) : undefined;
  }

  put<S extends StoreName>(store: S, record: StoreRecords[S]): Promise<void> {
    return this.exclusive(async () => {
      assertSafeId(record.id);
      if (store === 'entries') {
        const target = entryPath(record as EntryRecord);
        if (!target) throw new FolderError('An entry needs a valid date to be saved.');
        await this.replaceVersion(this.entryVersions.get(record.id) ?? [], target, record);
      } else {
        const meta = record as MediaRecord;
        await this.replaceVersion(this.mediaVersions.get(meta.id) ?? [], mediaMetaPath(meta), meta);
        if (!isSealed(meta)) await this.nameDataFileFor(meta as MediaMeta);
      }
      this.regroup();
    });
  }

  /**
   * Writes the record under `target` and removes the file the store used before, if it was named
   * differently. Other versions (sync conflicts) stay; one already at `target` is moved aside first
   * so it isn't overwritten.
   */
  private async replaceVersion(versions: Version<unknown>[], target: string, record: unknown): Promise<void> {
    const [current, ...others] = versions;
    if (others.some((v) => v.path === target)) await this.moveAside(target);
    await this.writeText(target, JSON.stringify(record, null, 2));
    if (current && current.path !== target) await this.removeFile(current.path);
  }

  /** Renames a plaintext media file to the extension its details call for (`….bin` → `….heic`). */
  private async nameDataFileFor(meta: MediaMeta): Promise<void> {
    const current = this.dataFiles.get(meta.id)?.[0];
    const want = plainMediaDataPath(meta);
    if (!current || current === want || current.endsWith('.enc')) return;
    await this.fs.rename(current, want);
    this.forget(current);
    this.files.set(want, { path: want, size: UNKNOWN_SIZE, mtimeMs: Date.now() });
  }

  delete(store: StoreName, id: string): Promise<void> {
    return this.exclusive(async () => {
      const map = store === 'entries' ? this.entryVersions : this.mediaVersions;
      for (const v of map.get(id) ?? []) await this.removeFile(v.path);
      this.regroup();
    });
  }

  async getBlob(id: string): Promise<Blob | undefined> {
    const path = this.dataFiles.get(id)?.[0];
    if (!path) return undefined;
    const bytes = await this.fs.readBytes(path);
    if (!bytes) return undefined;
    const ext = path.slice(path.lastIndexOf('.') + 1);
    return new Blob([bytes], { type: (!path.endsWith('.enc') && mimeForExtension(ext)) || 'application/octet-stream' });
  }

  putBlob(id: string, blob: Blob): Promise<void> {
    return this.exclusive(async () => {
      assertSafeId(id);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let path: string;
      if (isSealedBlob(bytes)) {
        path = sealedMediaDataPath(id);
      } else {
        const meta = this.mediaVersions.get(id)?.[0]?.record;
        path = meta && !isSealed(meta) ? plainMediaDataPath(meta as MediaMeta) : mediaDataPath(id, extensionFor({ mime: blob.type, name: '' }));
      }
      await this.atomicWrite(path, bytes);
      for (const other of this.dataFiles.get(id) ?? []) if (other !== path) await this.removeFile(other);
      this.regroup();
    });
  }

  deleteBlob(id: string): Promise<void> {
    return this.exclusive(async () => {
      for (const path of this.dataFiles.get(id) ?? []) await this.removeFile(path);
      this.regroup();
    });
  }

  async getKey<K extends keyof StoreKeys>(key: K): Promise<StoreKeys[K] | undefined> {
    if (key === 'vault') return (this.logbook.vault ? structuredClone(this.logbook.vault) : undefined) as StoreKeys[K] | undefined;
    const raw = this.local.get(key);
    if (raw !== null) return JSON.parse(raw) as StoreKeys[K];
    // A backup unpacked into the folder carries its settings: use them until this device saves its own.
    return (key === 'settings' && this.logbook.settings !== undefined ? structuredClone(this.logbook.settings) : undefined) as StoreKeys[K] | undefined;
  }

  setKey<K extends keyof StoreKeys>(key: K, value: StoreKeys[K] | undefined): Promise<void> {
    if (key !== 'vault') {
      this.local.set(key as LocalKey, value === undefined ? null : JSON.stringify(value));
      return Promise.resolve();
    }
    return this.exclusive(() => {
      const next: LogbookFile = { ...this.logbook };
      if (value === undefined) delete next.vault;
      else next.vault = value as Vault;
      return this.writeLogbook(next);
    });
  }

  /** Removes every entry and media file (all versions). `logbook.json` and unknown files stay. */
  clearContent(): Promise<void> {
    return this.exclusive(async () => {
      for (const f of [...this.files.values()]) {
        const kind = classify(f.path).kind;
        if (kind === 'entry' || kind === 'media-meta' || kind === 'media-data') await this.removeFile(f.path);
      }
      this.regroup();
    });
  }

  // ── writing ───────────────────────────────────────────────────────────────────────────────────

  private async writeLogbook(value: LogbookFile): Promise<void> {
    await this.writeText(LOGBOOK_FILE, JSON.stringify(value, null, 2));
    this.regroup();
  }

  private async writeText(path: string, raw: string): Promise<void> {
    await this.atomicWrite(path, raw);
    this.setText(path, raw);
  }

  /** Writes beside the target under a temporary name, then renames over it (D81). */
  private async atomicWrite(path: string, data: string | Uint8Array<ArrayBuffer>): Promise<void> {
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    const temp = `${dir}${TEMP_PREFIX}${newId(10)}.tmp`;
    await this.fs.writeFile(temp, data);
    try {
      await this.fs.rename(temp, path);
    } catch (err) {
      await this.fs.remove(temp).catch(() => undefined);
      throw err;
    }
    this.files.set(path, { path, size: UNKNOWN_SIZE, mtimeMs: Date.now() });
  }

  private async moveAside(path: string): Promise<void> {
    const aside = path.replace(/(\.json(\.enc)?)$/, `.kept-${newId(6)}$1`);
    await this.fs.rename(path, aside);
    const text = this.texts.get(path);
    this.forget(path);
    this.files.set(aside, { path: aside, size: UNKNOWN_SIZE, mtimeMs: Date.now() });
    if (text) this.texts.set(aside, text);
  }

  private async removeFile(path: string): Promise<void> {
    await this.fs.remove(path);
    this.forget(path);
  }

  private forget(path: string): void {
    this.files.delete(path);
    this.texts.delete(path);
  }

  /** Runs changes one at a time, so a rescan never interleaves with a write. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function assertSafeId(id: unknown): asserts id is string {
  if (!isSafeId(id)) throw new FolderError(`Logbook can’t store a record with the id ${JSON.stringify(id)} as a file.`);
}

function sameMap(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
