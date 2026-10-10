import { invoke } from '@tauri-apps/api/core';
import { assertRelativePath, type FsBackend } from './backend.ts';

/**
 * FsBackend for the desktop app: the journal_* commands in apps/desktop/src-tauri/src/lib.rs,
 * which resolve every path inside the journal folder the person chose. File contents travel as
 * raw bytes, not JSON, so photos and videos aren't inflated on the way.
 */
export class TauriFsBackend implements FsBackend {
  async read(path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    assertRelativePath(path);
    try {
      return new Uint8Array(await invoke<ArrayBuffer>('journal_read', { path }));
    } catch (err) {
      if (err === 'ENOENT') return undefined;
      throw asError(err);
    }
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    assertRelativePath(path);
    await invoke('journal_write', data, { headers: { 'x-path': encodeURIComponent(path) } }).catch(rethrow);
  }

  async rename(from: string, to: string): Promise<void> {
    assertRelativePath(from);
    assertRelativePath(to);
    await invoke('journal_rename', { from, to }).catch(rethrow);
  }

  async remove(path: string): Promise<void> {
    assertRelativePath(path);
    await invoke('journal_remove', { path }).catch(rethrow);
  }

  async list(dir: string): Promise<string[]> {
    assertRelativePath(dir);
    return invoke<string[]>('journal_list', { dir }).catch(rethrow);
  }
}

/** Commands reject with the Rust side's message as a plain string. */
function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function rethrow(err: unknown): never {
  throw asError(err);
}
