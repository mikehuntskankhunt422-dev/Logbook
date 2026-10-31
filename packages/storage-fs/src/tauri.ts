import { invoke } from '@tauri-apps/api/core';
import { assertRelativePath, type FsBackend } from './backend.ts';

export interface TauriFsOptions {
  /**
   * Android's webview can only send text to the app, and would send bytes as a JSON list of numbers
   * (D90): there, file contents go as base64, and a file over `PIECE` bytes in pieces, so a video
   * never has to cross over as one string.
   */
  textOnly?: boolean;
  /** How the commands are called: the page's own way, with its secret (D111); Tauri's by default. */
  invoke?: typeof invoke;
}

/** The most bytes sent in one call when sending text. */
export const PIECE = 4 * 1024 * 1024;

/**
 * FsBackend for the apps: the journal_* commands in apps/desktop/src-tauri/src/lib.rs, which
 * resolve every path inside the journal folder (the one the person chose on the desktop, the app's
 * own on Android). File contents travel as raw bytes, not JSON, so photos and videos aren't
 * inflated on the way; on Android as base64 (`textOnly`).
 */
export class TauriFsBackend implements FsBackend {
  private readonly call: typeof invoke;

  constructor(private readonly options: TauriFsOptions = {}) {
    this.call = options.invoke ?? invoke;
  }

  async read(path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    assertRelativePath(path);
    try {
      return new Uint8Array(await this.call<ArrayBuffer>('journal_read', { path }));
    } catch (err) {
      if (err === 'ENOENT') return undefined;
      throw asError(err);
    }
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    assertRelativePath(path);
    const headers = { 'x-path': encodeURIComponent(path) };
    if (!this.options.textOnly) {
      await this.call('journal_write', data, { headers }).catch(rethrow);
    } else if (data.length <= PIECE) {
      await this.call('journal_write', { data: toBase64(data) }, { headers }).catch(rethrow);
    } else {
      // Pieces of one write, put together in a temporary file and renamed into place at the end.
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      for (let at = 0; at < data.length; at += PIECE) {
        const part = at === 0 ? 'first' : at + PIECE >= data.length ? 'last' : 'more';
        await this.call('journal_write', { data: toBase64(data.subarray(at, at + PIECE)) }, { headers: { ...headers, 'x-write': id, 'x-part': part } }).catch(rethrow);
      }
    }
  }

  async rename(from: string, to: string): Promise<void> {
    assertRelativePath(from);
    assertRelativePath(to);
    await this.call('journal_rename', { from, to }).catch(rethrow);
  }

  async remove(path: string): Promise<void> {
    assertRelativePath(path);
    await this.call('journal_remove', { path }).catch(rethrow);
  }

  async list(dir: string): Promise<string[]> {
    assertRelativePath(dir);
    return this.call<string[]>('journal_list', { dir }).catch(rethrow);
  }
}

/** Base64, as the apps' commands take it from Android's webview (src-tauri/src/lib.rs `body`). */
export function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** Commands reject with the Rust side's message as a plain string. */
function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function rethrow(err: unknown): never {
  throw asError(err);
}
