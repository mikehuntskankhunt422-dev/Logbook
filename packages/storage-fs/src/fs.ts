/** A file in the journal folder. Paths are relative to the folder and always use `/`. */
export interface FileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * The few filesystem operations the store needs, implemented once per platform: Node's `fs` for
 * tests and scripts (`./node.ts`), Tauri in the desktop app. Every path is relative to the journal
 * folder; implementations must refuse anything that would leave it.
 */
export interface JournalFs {
  /** The folder, for display only. */
  readonly root: string;
  /** Every file under the folder, recursively. */
  list(): Promise<FileInfo[]>;
  /** Small text files, in order; `null` for a file that no longer exists. */
  readTexts(paths: string[]): Promise<(string | null)[]>;
  readBytes(path: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /** Writes a file (not atomically: the store writes to a temporary name and renames), creating folders. */
  writeFile(path: string, data: string | Uint8Array<ArrayBuffer>): Promise<void>;
  /** Moves a file, replacing any file at `to` and creating folders. */
  rename(from: string, to: string): Promise<void>;
  /** Deletes a file; no error if it's already gone. */
  remove(path: string): Promise<void>;
}

/**
 * Small per-device values kept outside the folder (D80): device preferences, the book draft and
 * print-order tokens. The desktop app backs this with its own storage; tests use a Map.
 */
export interface LocalKeys {
  get(key: string): string | null;
  set(key: string, value: string | null): void;
}

export function mapLocalKeys(map = new Map<string, string>()): LocalKeys {
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void (v === null ? map.delete(k) : map.set(k, v)),
  };
}
