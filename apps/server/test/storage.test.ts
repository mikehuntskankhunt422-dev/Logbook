import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalStore } from '../src/storage/local.ts';
import { R2Store } from '../src/storage/r2.ts';
import { assertKey } from '../src/storage/store.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'logbook-store-'));

describe('storage keys', () => {
  it('accept plain paths and refuse traversal and odd characters', () => {
    for (const ok of ['orders/abc/upload/bundle.json', 'orders/abc/print/interior.pdf', 'a']) expect(() => assertKey(ok)).not.toThrow();
    for (const bad of ['../etc/passwd', 'orders/../x', '/abs', 'orders//x', 'orders/./x', 'a b', 'orders/x?y', '']) expect(() => assertKey(bad), bad).toThrow();
  });
});

describe('local store (development and tests only)', () => {
  it('signs URLs bound to method, key, expiry and content type', async () => {
    let now = 1_000_000_000_000;
    const store = new LocalStore(tmp(), { now: () => now });
    const up = await store.signPut('orders/o1/upload/bundle.json', { contentType: 'application/json', expiresInSeconds: 600 });
    expect(up.headers).toEqual({ 'content-type': 'application/json' });
    const url = new URL(up.url, 'http://x');
    expect(url.pathname).toBe('/api/local-storage/orders/o1/upload/bundle.json');
    const q = Object.fromEntries(url.searchParams) as { expires: string; sig: string };
    const key = 'orders/o1/upload/bundle.json';
    expect(store.verify('PUT', key, q, 'application/json')).toBe(key);
    // Wrong method, other key, other content type, tampered expiry: refused.
    expect(store.verify('GET', key, q, 'application/json')).toBeNull();
    expect(store.verify('PUT', 'orders/o2/upload/bundle.json', q, 'application/json')).toBeNull();
    expect(store.verify('PUT', key, q, 'image/jpeg')).toBeNull();
    expect(store.verify('PUT', key, { ...q, expires: String(Number(q.expires) + 60) }, 'application/json')).toBeNull();
    // Expired.
    now += 601_000;
    expect(store.verify('PUT', key, q, 'application/json')).toBeNull();
  });

  it('refuses URLs signed by another process’s secret', async () => {
    const a = new LocalStore(tmp());
    const b = new LocalStore(tmp());
    const q = Object.fromEntries(new URL(await a.signGet('orders/x/print/interior.pdf', 60), 'http://x').searchParams) as { expires: string; sig: string };
    expect(b.verify('GET', 'orders/x/print/interior.pdf', q)).toBeNull();
    expect(a.verify('GET', 'orders/x/print/interior.pdf', q)).toBe('orders/x/print/interior.pdf');
  });

  it('stores, sizes, reads and deletes by prefix', async () => {
    const store = new LocalStore(tmp());
    await store.put('orders/o1/upload/media/a.jpg', new Uint8Array([1, 2, 3]));
    await store.put('orders/o1/print/interior.pdf', new Uint8Array([4]));
    expect(await store.size('orders/o1/upload/media/a.jpg')).toBe(3);
    expect(await store.get('orders/o1/print/interior.pdf')).toEqual(new Uint8Array([4]));
    expect(await store.size('orders/o1/upload/nope.jpg')).toBeNull();
    await store.deletePrefix('orders/o1/upload/');
    expect(await store.size('orders/o1/upload/media/a.jpg')).toBeNull();
    expect(await store.size('orders/o1/print/interior.pdf')).toBe(1);
  });
});

describe('R2 store', () => {
  const store = new R2Store({ accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', bucket: 'logbook-orders-test' });

  it('presigns PUTs with the signature and the content type in the URL, no credentials needed', async () => {
    const up = await store.signPut('orders/o1/upload/media/a.jpg', { contentType: 'image/jpeg', expiresInSeconds: 900 });
    const url = new URL(up.url);
    expect(url.origin).toBe('https://acct.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/logbook-orders-test/orders/o1/upload/media/a.jpg');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(up.headers).toEqual({ 'content-type': 'image/jpeg' });
  });

  it('presigns GETs for Lulu, optionally naming the download', async () => {
    const url = new URL(await store.signGet('orders/o1/print/interior.pdf', 3600, { downloadName: 'interior.pdf' }));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('response-content-disposition')).toBe('inline; filename="interior.pdf"');
  });

  it('lists and deletes everything under a prefix', async () => {
    const calls: string[] = [];
    let listed = false;
    const fetchImpl = (async (req: Request) => {
      calls.push(`${req.method} ${new URL(req.url).pathname}${new URL(req.url).search.includes('list-type') ? ' (list)' : ''}`);
      if (req.url.includes('list-type=2')) {
        const body = listed ? '<ListBucketResult></ListBucketResult>' : '<ListBucketResult><Contents><Key>orders/o1/a.jpg</Key></Contents><Contents><Key>orders/o1/print/b.pdf</Key></Contents></ListBucketResult>';
        listed = true;
        return new Response(body);
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const s = new R2Store({ accountId: 'acct', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' }, fetchImpl);
    expect(await s.deletePrefix('orders/o1/')).toBe(2);
    expect(calls).toEqual(['GET /b (list)', 'DELETE /b/orders/o1/a.jpg', 'DELETE /b/orders/o1/print/b.pdf', 'GET /b (list)']);
  });
});
