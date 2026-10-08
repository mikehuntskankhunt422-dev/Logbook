import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { RecordStore, StoreKeys, StoreName, StoreRecords } from '@logbook/core';

interface LogbookDB extends DBSchema {
  entries: { key: string; value: StoreRecords['entries'] };
  media: { key: string; value: StoreRecords['media'] };
  /** Stored as ArrayBuffer + type: more portable than Blob across older Safari and test shims. */
  blobs: { key: string; value: { type: string; data: ArrayBuffer } };
  keys: { key: string; value: unknown };
}

const DB_VERSION = 1;

/** IndexedDB RecordStore for the website and PWA. One database per journal name. */
export class IndexedDbStore implements RecordStore {
  readonly kind = 'indexeddb' as const;

  private db: IDBPDatabase<LogbookDB>;
  private constructor(db: IDBPDatabase<LogbookDB>) {
    this.db = db;
  }

  static async open(name = 'logbook'): Promise<IndexedDbStore> {
    const db = await openDB<LogbookDB>(name, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('entries', { keyPath: 'id' });
        db.createObjectStore('media', { keyPath: 'id' });
        db.createObjectStore('blobs');
        db.createObjectStore('keys');
      },
      blocking() {
        // Another tab wants to upgrade the schema: close so it can, then that tab takes over.
        db.close();
      },
    });
    return new IndexedDbStore(db);
  }

  close(): void {
    this.db.close();
  }

  all<S extends StoreName>(store: S): Promise<StoreRecords[S][]> {
    return this.db.getAll(store) as Promise<StoreRecords[S][]>;
  }

  get<S extends StoreName>(store: S, id: string): Promise<StoreRecords[S] | undefined> {
    return this.db.get(store, id) as Promise<StoreRecords[S] | undefined>;
  }

  async put<S extends StoreName>(store: S, record: StoreRecords[S]): Promise<void> {
    await this.db.put(store, record as never);
  }

  async delete(store: StoreName, id: string): Promise<void> {
    await this.db.delete(store, id);
  }

  async getBlob(id: string): Promise<Blob | undefined> {
    const row = await this.db.get('blobs', id);
    return row ? new Blob([row.data], { type: row.type }) : undefined;
  }

  async putBlob(id: string, blob: Blob): Promise<void> {
    const data = await blob.arrayBuffer(); // read before opening the transaction so it doesn't auto-commit
    await this.db.put('blobs', { type: blob.type, data }, id);
  }

  async deleteBlob(id: string): Promise<void> {
    await this.db.delete('blobs', id);
  }

  async getKey<K extends keyof StoreKeys>(key: K): Promise<StoreKeys[K] | undefined> {
    return (await this.db.get('keys', key)) as StoreKeys[K] | undefined;
  }

  async setKey<K extends keyof StoreKeys>(key: K, value: StoreKeys[K] | undefined): Promise<void> {
    if (value === undefined) await this.db.delete('keys', key);
    else await this.db.put('keys', value, key);
  }

  async clearContent(): Promise<void> {
    const tx = this.db.transaction(['entries', 'media', 'blobs'], 'readwrite');
    await Promise.all([tx.objectStore('entries').clear(), tx.objectStore('media').clear(), tx.objectStore('blobs').clear(), tx.done]);
  }
}

/**
 * Ask the browser not to evict this site's storage. Browsers grant it more readily once the site
 * has been used or installed, so call this after the first saved entry and again from Settings.
 */
export async function requestPersistentStorage(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return 'unsupported';
  if (await navigator.storage.persisted()) return 'granted';
  return (await navigator.storage.persist()) ? 'granted' : 'denied';
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota, persisted: (await navigator.storage.persisted?.()) ?? false };
}
