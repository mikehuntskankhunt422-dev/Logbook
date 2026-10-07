import { AwsClient } from 'aws4fetch';
import { assertKey, type ObjectStore, type SignedUpload } from './store.ts';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Defaults to `https://<accountId>.r2.cloudflarestorage.com`. */
  endpoint?: string;
}

/**
 * Cloudflare R2 through its S3 API, signed with AWS SigV4 (aws4fetch, the client Cloudflare
 * documents for R2). Signed URLs carry the signature in the query string, so a browser or Lulu can
 * use them without credentials. The bucket's lifecycle rule deletes `orders/` after 7 days (D16).
 */
export class R2Store implements ObjectStore {
  readonly kind = 'r2' as const;
  readonly reachableFromInternet = true;
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(
    private readonly config: R2Config,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: 'auto' });
    this.base = `${(config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '')}/${encodeURIComponent(config.bucket)}`;
  }

  private url(key: string): string {
    assertKey(key);
    return `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async signPut(key: string, opts: { contentType: string; expiresInSeconds: number }): Promise<SignedUpload> {
    const url = new URL(this.url(key));
    url.searchParams.set('X-Amz-Expires', String(opts.expiresInSeconds));
    const signed = await this.client.sign(url.toString(), { method: 'PUT', headers: { 'content-type': opts.contentType }, aws: { signQuery: true, allHeaders: true } });
    return { url: signed.url, method: 'PUT', headers: { 'content-type': opts.contentType } };
  }

  async signGet(key: string, expiresInSeconds: number, opts: { downloadName?: string } = {}): Promise<string> {
    const url = new URL(this.url(key));
    url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
    if (opts.downloadName) url.searchParams.set('response-content-disposition', `inline; filename="${opts.downloadName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    return (await this.client.sign(url.toString(), { method: 'GET', aws: { signQuery: true } })).url;
  }

  private async send(method: string, key: string, init: RequestInit = {}): Promise<Response> {
    const req = await this.client.sign(this.url(key), { method, ...init });
    return this.fetchImpl(req);
  }

  async size(key: string): Promise<number | null> {
    const res = await this.send('HEAD', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 HEAD failed (HTTP ${res.status})`);
    return Number(res.headers.get('content-length') ?? 0);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.send('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET failed (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const res = await this.send('PUT', key, { body: body as BodyInit, headers: { 'content-type': contentType } });
    if (!res.ok) throw new Error(`R2 PUT failed (HTTP ${res.status})`);
  }

  async deletePrefix(prefix: string): Promise<number> {
    assertKey(prefix.replace(/\/$/, ''));
    let deleted = 0;
    for (;;) {
      const list = await this.fetchImpl(await this.client.sign(`${this.base}?list-type=2&prefix=${encodeURIComponent(prefix)}`, { method: 'GET' }));
      if (!list.ok) throw new Error(`R2 list failed (HTTP ${list.status})`);
      const keys = [...(await list.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => decodeXml(m[1]!));
      if (!keys.length) return deleted;
      for (const key of keys) {
        const res = await this.send('DELETE', key);
        if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE failed (HTTP ${res.status})`);
        deleted++;
      }
    }
  }
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
