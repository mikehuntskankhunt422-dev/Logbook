import type { Entry, MediaMeta } from './model.ts';
import type { Vault } from './crypto.ts';

/** An encrypted record. `id` stays visible so stores can key it; everything else is ciphertext. */
export interface SealedRecord {
  id: string;
  sealed: 1;
  iv: string;
  data: string;
}

export type EntryRecord = Entry | SealedRecord;
export type MediaRecord = MediaMeta | SealedRecord;

export interface StoreRecords {
  entries: EntryRecord;
  media: MediaRecord;
}
export type StoreName = keyof StoreRecords;

export interface StoreKeys {
  settings: unknown;
  vault: Vault;
  /** The book builder's last settings: plaintext, or a SealedRecord when a passcode is on. */
  bookDraft: unknown;
  /** Print orders' IDs and secret tokens: plaintext, or a SealedRecord when a passcode is on. */
  bookOrders: unknown;
}

/**
 * Low-level persistence implemented once per platform (memory, IndexedDB, filesystem).
 * Stores are deliberately dumb: no validation, no crypto. The Journal service does that.
 */
export interface RecordStore {
  readonly kind: 'memory' | 'indexeddb' | 'filesystem';
  all<S extends StoreName>(store: S): Promise<StoreRecords[S][]>;
  get<S extends StoreName>(store: S, id: string): Promise<StoreRecords[S] | undefined>;
  put<S extends StoreName>(store: S, record: StoreRecords[S]): Promise<void>;
  delete(store: StoreName, id: string): Promise<void>;
  getBlob(id: string): Promise<Blob | undefined>;
  putBlob(id: string, blob: Blob): Promise<void>;
  deleteBlob(id: string): Promise<void>;
  getKey<K extends keyof StoreKeys>(key: K): Promise<StoreKeys[K] | undefined>;
  setKey<K extends keyof StoreKeys>(key: K, value: StoreKeys[K] | undefined): Promise<void>;
  /** Removes entries, media and blobs. Keys (settings, vault) are left alone. */
  clearContent(): Promise<void>;
  /**
   * Stores other computers can change underneath (the desktop folder): re-read them now. Called
   * before decisions that must see everything, such as turning the passcode off.
   */
  refresh?(): Promise<void>;
  /** Resolves once every change asked for so far is stored (the desktop app waits on it before closing). */
  whenIdle?(): Promise<void>;
  /** Files that exist but couldn't be read when last tried (a sync still in progress, damage). */
  unreadableFiles?(): string[];
}

export function isSealed(r: unknown): r is SealedRecord {
  return typeof r === 'object' && r !== null && (r as SealedRecord).sealed === 1;
}

/** In-memory store for tests and as the reference implementation of the contract. */
export class MemoryStore implements RecordStore {
  readonly kind = 'memory' as const;
  private tables: { [S in StoreName]: Map<string, StoreRecords[S]> } = { entries: new Map(), media: new Map() };
  private blobs = new Map<string, Blob>();
  private keys = new Map<string, unknown>();

  async all<S extends StoreName>(store: S): Promise<StoreRecords[S][]> {
    return [...this.tables[store].values()].map((r) => structuredClone(r));
  }
  async get<S extends StoreName>(store: S, id: string): Promise<StoreRecords[S] | undefined> {
    const r = this.tables[store].get(id);
    return r === undefined ? undefined : structuredClone(r);
  }
  async put<S extends StoreName>(store: S, record: StoreRecords[S]): Promise<void> {
    this.tables[store].set(record.id, structuredClone(record));
  }
  async delete(store: StoreName, id: string): Promise<void> {
    this.tables[store].delete(id);
  }
  async getBlob(id: string): Promise<Blob | undefined> {
    return this.blobs.get(id);
  }
  async putBlob(id: string, blob: Blob): Promise<void> {
    this.blobs.set(id, blob);
  }
  async deleteBlob(id: string): Promise<void> {
    this.blobs.delete(id);
  }
  async getKey<K extends keyof StoreKeys>(key: K): Promise<StoreKeys[K] | undefined> {
    const v = this.keys.get(key);
    return v === undefined ? undefined : (structuredClone(v) as StoreKeys[K]);
  }
  async setKey<K extends keyof StoreKeys>(key: K, value: StoreKeys[K] | undefined): Promise<void> {
    if (value === undefined) this.keys.delete(key);
    else this.keys.set(key, structuredClone(value));
  }
  async clearContent(): Promise<void> {
    this.tables.entries.clear();
    this.tables.media.clear();
    this.blobs.clear();
  }
}
