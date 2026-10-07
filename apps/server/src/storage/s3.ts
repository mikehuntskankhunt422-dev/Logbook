import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { assertKey, type ObjectStore, type SignedUpload } from './store.ts';

export interface S3Config {
  /** Which service, for messages and docs: Cloudflare R2, Backblaze B2, or another S3-compatible store. */
  provider: 'r2' | 'b2' | 's3';
  /** e.g. `https://<account>.r2.cloudflarestorage.com` or `https://s3.us-west-004.backblazeb2.com` */
  endpoint: string;
  /** SigV4 region: `auto` for R2, `us-west-004` style for B2. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * An S3-compatible bucket (D16, D54): Cloudflare R2, Backblaze B2 or similar, signed with AWS SigV4
 * (aws4fetch). Signed URLs carry the signature in the query string, so a browser or Lulu can use
 * them without credentials. Path-style URLs (`endpoint/bucket/key`) work on every provider we use.
 */
export class S3Store implements ObjectStore {
  readonly kind = 's3' as const;
  readonly reachableFromInternet = true;
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(
    readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: config.region });
    this.base = `${config.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(config.bucket)}`;
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

  private async send(method: string, url: string, init: RequestInit = {}): Promise<Response> {
    return this.fetchImpl(await this.client.sign(url, { method, ...init }));
  }

  async size(key: string): Promise<number | null> {
    const res = await this.send('HEAD', this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage HEAD failed (HTTP ${res.status})`);
    return Number(res.headers.get('content-length') ?? 0);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.send('GET', this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage GET failed (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const res = await this.send('PUT', this.url(key), { body: body as BodyInit, headers: { 'content-type': contentType } });
    if (!res.ok) throw new Error(`Storage PUT failed (HTTP ${res.status})`);
  }

  /**
   * Deletes every object under `prefix`. On B2 a delete hides the file; the bucket's lifecycle rule
   * (`configureBucket`) removes hidden versions a day later.
   */
  async deletePrefix(prefix: string): Promise<number> {
    assertKey(prefix.replace(/\/$/, ''));
    let deleted = 0;
    for (;;) {
      const list = await this.send('GET', `${this.base}?list-type=2&prefix=${encodeURIComponent(prefix)}`);
      if (!list.ok) throw new Error(`Storage list failed (HTTP ${list.status})`);
      const keys = [...(await list.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => decodeXml(m[1]!));
      if (!keys.length) return deleted;
      for (const key of keys) {
        const res = await this.send('DELETE', this.url(key));
        if (!res.ok && res.status !== 404) throw new Error(`Storage DELETE failed (HTTP ${res.status})`);
        deleted++;
      }
    }
  }

  /**
   * One-off bucket setup (`npm run storage:setup`): lets the website's browsers PUT uploads (CORS),
   * deletes `orders/` files after `retentionDays`, removes hidden or replaced versions after a day,
   * and abandoned multipart uploads after a day. Needs a key allowed to change bucket settings.
   * B2 refuses an expiry rule unless a second rule with the same prefix removes delete markers.
   */
  async configureBucket(opts: { origins: string[]; retentionDays: number }): Promise<void> {
    const cors = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration><CORSRule>${opts.origins.map((o) => `<AllowedOrigin>${escapeXml(o)}</AllowedOrigin>`).join('')}<AllowedMethod>PUT</AllowedMethod><AllowedHeader>content-type</AllowedHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
    const markers = this.config.provider === 'b2' ? '<Rule><ID>logbook-orders-markers</ID><Filter><Prefix>orders/</Prefix></Filter><Status>Enabled</Status><Expiration><ExpiredObjectDeleteMarker>true</ExpiredObjectDeleteMarker></Expiration></Rule>' : '';
    const lifecycle = `<?xml version="1.0" encoding="UTF-8"?>
<LifecycleConfiguration><Rule><ID>logbook-orders</ID><Filter><Prefix>orders/</Prefix></Filter><Status>Enabled</Status><Expiration><Days>${opts.retentionDays}</Days></Expiration><NoncurrentVersionExpiration><NoncurrentDays>1</NoncurrentDays></NoncurrentVersionExpiration><AbortIncompleteMultipartUpload><DaysAfterInitiation>1</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule>${markers}</LifecycleConfiguration>`;
    for (const [sub, body] of [
      ['cors', cors],
      ['lifecycle', lifecycle],
    ] as const) {
      const res = await this.send('PUT', `${this.base}?${sub}`, { body, headers: { 'content-type': 'application/xml', 'content-md5': createHash('md5').update(body).digest('base64') } });
      if (!res.ok) throw new Error(`Setting the bucket's ${sub} rules failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** Region from a Backblaze endpoint such as `https://s3.us-west-004.backblazeb2.com`. */
export function regionFromEndpoint(endpoint: string): string | undefined {
  return /^https:\/\/s3\.([a-z0-9-]+)\.backblazeb2\.com\/?$/.exec(endpoint)?.[1];
}
