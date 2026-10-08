import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertKey, type ObjectStore, type SignedUpload } from './store.ts';

/** The route the API serves local signed URLs on. */
export const LOCAL_STORAGE_ROUTE = '/api/local-storage';

/**
 * Order files in a folder on this machine, for development and tests (D51). Signed URLs point at the
 * API itself, which checks the signature and expiry before reading or writing. Unlike R2, content
 * does pass through the API process here, so config only allows it in test mode on a loopback
 * host, and Lulu can't fetch these URLs (validation is skipped and says so).
 */
export class LocalStore implements ObjectStore {
  readonly kind = 'local' as const;
  readonly reachableFromInternet = false;
  private readonly secret: Buffer;

  constructor(
    private readonly root: string,
    opts: { secret?: Buffer; baseUrl?: string; now?: () => number } = {},
  ) {
    this.secret = opts.secret ?? randomBytes(32);
    this.baseUrl = (opts.baseUrl ?? '').replace(/\/+$/, '');
    this.now = opts.now ?? Date.now;
  }

  private readonly baseUrl: string;
  private readonly now: () => number;

  private path(key: string): string {
    assertKey(key);
    return join(this.root, ...key.split('/'));
  }

  private signature(method: string, key: string, expires: number, contentType: string): string {
    return createHmac('sha256', this.secret).update(`${method}\n${key}\n${expires}\n${contentType}`).digest('base64url');
  }

  private signed(method: 'PUT' | 'GET', key: string, expiresInSeconds: number, contentType = '', extra: Record<string, string> = {}): string {
    assertKey(key);
    const expires = Math.floor(this.now() / 1000) + expiresInSeconds;
    const q = new URLSearchParams({ expires: String(expires), sig: this.signature(method, key, expires, contentType), ...extra });
    return `${this.baseUrl}${LOCAL_STORAGE_ROUTE}/${key.split('/').map(encodeURIComponent).join('/')}?${q}`;
  }

  async signPut(key: string, opts: { contentType: string; expiresInSeconds: number }): Promise<SignedUpload> {
    return { url: this.signed('PUT', key, opts.expiresInSeconds, opts.contentType), method: 'PUT', headers: { 'content-type': opts.contentType } };
  }

  async signGet(key: string, expiresInSeconds: number, opts: { downloadName?: string } = {}): Promise<string> {
    return this.signed('GET', key, expiresInSeconds, '', opts.downloadName ? { name: opts.downloadName.replace(/[^A-Za-z0-9._-]/g, '_') } : {});
  }

  /** Checks a request against its signature; returns the key it may touch, or null. */
  verify(method: 'PUT' | 'GET', key: string, query: { expires?: string; sig?: string }, contentType = ''): string | null {
    try {
      assertKey(key);
    } catch {
      return null;
    }
    const expires = Number(query.expires);
    if (!Number.isInteger(expires) || expires < Math.floor(this.now() / 1000) || !query.sig) return null;
    const want = Buffer.from(this.signature(method, key, expires, contentType));
    const got = Buffer.from(query.sig);
    return want.length === got.length && timingSafeEqual(want, got) ? key : null;
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.path(key))).size;
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async deletePrefix(prefix: string): Promise<number> {
    const p = this.path(prefix.replace(/\/$/, ''));
    const existed = (await stat(p).catch(() => null)) !== null;
    await rm(p, { recursive: true, force: true });
    return existed ? 1 : 0;
  }
}
