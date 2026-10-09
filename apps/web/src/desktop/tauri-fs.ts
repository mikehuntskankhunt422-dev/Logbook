import { invoke } from '@tauri-apps/api/core';
import { exists, mkdir, readFile, remove, rename, watch, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { FileInfo, JournalFs } from '@logbook/storage-fs';

/**
 * The journal folder through Tauri. Listing and reading many small files go through Logbook's own
 * commands, one call each (D83); single files and watching go through the fs plugin, which only
 * reaches the folder Rust granted (D79).
 */
export class TauriJournalFs implements JournalFs {
  readonly root: string;
  private readonly sep: string;
  private readonly madeDirs = new Set<string>();

  constructor(root: string) {
    this.sep = /^[A-Za-z]:\\|^\\\\/.test(root) ? '\\' : '/';
    this.root = root.endsWith(this.sep) ? root.slice(0, -1) : root;
  }

  private abs(rel: string): string {
    return `${this.root}${this.sep}${rel.split('/').join(this.sep)}`;
  }

  list(): Promise<FileInfo[]> {
    return invoke<FileInfo[]>('scan_journal');
  }

  readTexts(paths: string[]): Promise<(string | null)[]> {
    return invoke<(string | null)[]>('read_journal_texts', { paths });
  }

  async readBytes(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const abs = this.abs(path);
    try {
      return await readFile(abs);
    } catch (err) {
      if (!(await exists(abs))) return null;
      throw err;
    }
  }

  writeFile(path: string, data: string | Uint8Array<ArrayBuffer>): Promise<void> {
    const abs = this.abs(path);
    return this.withParent(path, () => (typeof data === 'string' ? writeTextFile(abs, data) : writeFile(abs, data)));
  }

  rename(from: string, to: string): Promise<void> {
    return this.withParent(to, () => rename(this.abs(from), this.abs(to)));
  }

  async remove(path: string): Promise<void> {
    const abs = this.abs(path);
    try {
      await remove(abs);
    } catch (err) {
      if (await exists(abs)) throw err;
    }
  }

  /** Calls `onChange` (debounced) whenever anything in the folder changes. */
  watch(onChange: () => void): Promise<() => void> {
    return watch(this.root, () => onChange(), { recursive: true, delayMs: 600 });
  }

  /** Runs `fn` with the file's folder in place; a sync service may have removed it since. */
  private async withParent(rel: string, fn: () => Promise<void>): Promise<void> {
    const dir = rel.slice(0, Math.max(0, rel.lastIndexOf('/')));
    const ensure = async () => {
      if (dir && !this.madeDirs.has(dir)) {
        await mkdir(this.abs(dir), { recursive: true });
        this.madeDirs.add(dir);
      }
    };
    await ensure();
    try {
      await fn();
    } catch (err) {
      if (!dir || !this.madeDirs.has(dir)) throw err;
      this.madeDirs.delete(dir);
      await ensure();
      await fn();
    }
  }
}

/** Device-local values (D80) in the app's own storage, kept per folder. */
export function folderLocalKeys(folder: string) {
  const prefix = `logbook:${folder}:`;
  return {
    get(key: string): string | null {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string | null): void {
      if (value === null) localStorage.removeItem(prefix + key);
      else localStorage.setItem(prefix + key, value);
    },
  };
}

export const chooseJournalFolder = () => invoke<string | null>('choose_journal_folder');
export const currentJournalFolder = () => invoke<string | null>('journal_folder');
