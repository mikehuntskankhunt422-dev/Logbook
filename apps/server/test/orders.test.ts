import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { bookOptionsSchema, entrySchema, mediaMetaSchema, PRINT_BUNDLE_FORMAT, type PrintBundle } from '@logbook/core';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { LuluClient } from '../src/lulu/client.ts';
import { OrderDb } from '../src/orders/db.ts';
import type { BookRender, BookSource } from '../src/render/book.ts';
import { LocalStore } from '../src/storage/local.ts';
import type { ObjectStore } from '../src/storage/store.ts';

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const tmp = () => mkdtempSync(join(tmpdir(), 'logbook-orders-'));
const PB = '0600X0900.FC.PRE.PB.080CW444.MXX';

/** A one-entry book with one photo, as the web app would upload it. */
async function sampleUpload() {
  const jpeg = new Uint8Array(await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#c96f53' } }).jpeg().toBuffer());
  const meta = mediaMetaSchema.parse({ id: 'img1', name: 'beach.jpg', mime: 'image/jpeg', bytes: jpeg.length, width: 1200, height: 800, createdAt: '2026-01-01T00:00:00.000Z' });
  const entry = entrySchema.parse({
    id: 'e1',
    date: '2026-03-01',
    title: 'Beach day',
    mood: null,
    cover: { kind: 'gradient', gradient: 'dusk' },
    tags: [],
    blocks: [{ id: 'p1', type: 'photo', mediaId: 'img1', caption: '' }],
    createdAt: '2026-03-01T08:00:00.000Z',
    updatedAt: '2026-03-01T08:00:00.000Z',
    rev: 1,
  });
  const bundle: PrintBundle = {
    format: PRINT_BUNDLE_FORMAT,
    version: 1,
    createdAt: '2026-10-07T00:00:00.000Z',
    options: bookOptionsSchema.parse({ title: 'Our summer', selection: { kind: 'range', from: '2026-01-01', to: '2026-12-31' } }),
    entries: [entry],
    media: [{ meta, file: { path: 'media/img1.jpg', sha256: sha(jpeg), bytes: jpeg.length, width: 1200, height: 800 } }],
    audioPeaks: {},
  };
  const bundleBytes = new TextEncoder().encode(JSON.stringify(bundle));
  return {
    jpeg,
    bundleBytes,
    request: { product: bundle.options.product, bundle: { bytes: bundleBytes.length, sha256: sha(bundleBytes) }, files: [{ path: 'media/img1.jpg', bytes: jpeg.length, sha256: sha(jpeg) }] },
  };
}

/** Stands in for Chromium: a 32-page book, and remembers what it was asked to print. */
function fakeRender(seen: BookSource[] = []) {
  return async (src: BookSource): Promise<BookRender> => {
    seen.push(src);
    const dims = await src.coverDims?.(PB, 32);
    const pdf = new TextEncoder().encode('%PDF-1.7 fake');
    return {
      podPackageId: PB,
      interior: { pdf, plan: { pages: 32, laidOut: 30, notesPages: 2, gutterIn: 0, passes: 1, tooMany: false }, chromium: 'fake', blocked: [], ms: 1 },
      cover: { pdf, layout: {} as never, blocked: [] },
      coverApproximate: !dims,
      warnings: [],
    } as unknown as BookRender;
  };
}

function fakeLulu(opts: { interiorStatus?: string; pageCount?: number } = {}) {
  const config = loadConfig({ LULU_SANDBOX_CLIENT_KEY: 'k', LULU_SANDBOX_CLIENT_SECRET: 's' }).lulu!;
  const asked: string[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(config.apiUrl, '');
    if (path.endsWith('/token')) return Response.json({ access_token: 't', expires_in: 3600 });
    asked.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/cover-dimensions/') return Response.json({ width: '314.500', height: '234.950', unit: 'mm' }, { status: 201 });
    if (path === '/validate-interior/') return Response.json({ id: 1, status: null, page_count: null, errors: null }, { status: 201 });
    if (path === '/validate-interior/1/') return Response.json({ id: 1, status: opts.interiorStatus ?? 'NORMALIZED', page_count: opts.pageCount ?? 32, errors: opts.interiorStatus === 'ERROR' ? ['Fonts not embedded'] : null });
    if (path === '/validate-cover/') return Response.json({ id: 2, status: 'VALIDATING', errors: null }, { status: 201 });
    if (path === '/validate-cover/2/') return Response.json({ id: 2, status: 'NORMALIZED', errors: null });
    if (path === '/print-job-cost-calculations/')
      return Response.json(
        {
          line_item_costs: [{ cost_excl_discounts: '6.43', quantity: 1, total_cost_excl_tax: '6.43', total_cost_incl_tax: '6.43' }],
          shipping_cost: { total_cost_excl_tax: '5.69', total_cost_incl_tax: '5.69' },
          fulfillment_cost: { total_cost_excl_tax: '0.75', total_cost_incl_tax: '0.75' },
          total_tax: '0',
          total_cost_excl_tax: '12.87',
          total_cost_incl_tax: '12.87',
          currency: 'USD',
        },
        { status: 201 },
      );
    return new Response('nope', { status: 404 });
  }) as typeof globalThis.fetch;
  return { lulu: new LuluClient(config, { fetch, sleep: async () => {} }), asked };
}

/** The local store, but pretending Lulu can reach it, to exercise validation. */
function reachable(store: LocalStore): ObjectStore {
  return new Proxy(store, { get: (t, p) => (p === 'reachableFromInternet' ? true : Reflect.get(t, p, t)) as unknown }) as ObjectStore;
}

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

async function setup(opts: { store?: (s: LocalStore) => ObjectStore; lulu?: LuluClient; seen?: BookSource[] } = {}) {
  const local = new LocalStore(tmp());
  const store = opts.store ? opts.store(local) : local;
  const db = new OrderDb(':memory:');
  const app = buildApp(loadConfig({}), { logger: false, store, db, lulu: opts.lulu, render: fakeRender(opts.seen) });
  apps.push(app);
  await app.ready();
  return { app, local, db };
}

async function placeOrder(app: Awaited<ReturnType<typeof setup>>['app'], up: Awaited<ReturnType<typeof sampleUpload>>, opts: { skip?: string; corrupt?: string } = {}) {
  const created = await app.inject({ method: 'POST', url: '/api/orders', payload: up.request });
  expect(created.statusCode).toBe(201);
  const body = created.json() as { orderId: string; token: string; uploads: { path: string; url: string; headers: Record<string, string> }[] };
  for (const u of body.uploads) {
    if (u.path === opts.skip) continue;
    let bytes = u.path === 'bundle.json' ? up.bundleBytes : up.jpeg;
    if (u.path === opts.corrupt) bytes = bytes.map((b, i) => (i === 100 ? b ^ 1 : b));
    const put = await app.inject({ method: 'PUT', url: u.url, headers: u.headers, payload: Buffer.from(bytes) });
    expect(put.statusCode, u.path).toBe(200);
  }
  return body;
}

describe('orders: upload, prepare, quote (M3 slice C)', () => {
  it('takes a manifest, signed uploads and a submit, then renders and quotes, keeping only the print files', async () => {
    const seen: BookSource[] = [];
    const { lulu, asked } = fakeLulu();
    const { app, local, db } = await setup({ store: reachable, lulu, seen });
    const up = await sampleUpload();
    const { orderId, token, uploads } = await placeOrder(app, up);
    expect(uploads.map((u) => [u.path, u.headers['content-type']])).toEqual([
      ['bundle.json', 'application/json'],
      ['media/img1.jpg', 'image/jpeg'],
    ]);

    const auth = { authorization: `Bearer ${token}` };
    const submitted = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/submit`, headers: auth });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json()).toMatchObject({ state: 'draft', stage: 'queued' });
    await app.orders!.idle();

    const view = (await app.inject({ method: 'GET', url: `/api/orders/${orderId}`, headers: auth })).json();
    expect(view).toMatchObject({
      state: 'quoted',
      stage: null,
      pages: 32,
      coverApproximate: false,
      bookCents: 2499,
      currency: 'usd',
      lulu: { checked: true, interior: { status: 'NORMALIZED', pageCount: 32 }, cover: { status: 'NORMALIZED' } },
      error: null,
    });
    // The renderer got the book from the bundle, with the picture as a local file.
    expect(seen[0]!.options.title).toBe('Our summer');
    expect(seen[0]!.entries.map((e) => e.id)).toEqual(['e1']);
    expect(await seen[0]!.source('img1')).toMatch(/upload\/media\/img1\.jpg$/);
    expect(asked).toEqual(expect.arrayContaining(['POST /cover-dimensions/', 'POST /validate-interior/', 'POST /validate-cover/', 'POST /print-job-cost-calculations/']));
    // Proof links work; the uploaded sources are gone.
    const pdf = await app.inject({ method: 'GET', url: view.proof.interior });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body).toContain('%PDF');
    expect(await local.size(`orders/${orderId}/upload/bundle.json`)).toBeNull();
    expect(await local.size(`orders/${orderId}/print/interior.pdf`)).toBeGreaterThan(0);
    expect(db.events(orderId).map((e) => `${e.from}→${e.to}`)).toEqual(['draft→quoted']);
  });

  it('works without Lulu or public storage, and says what it skipped', async () => {
    const { app } = await setup();
    const { orderId, token } = await placeOrder(app, await sampleUpload());
    await app.inject({ method: 'POST', url: `/api/orders/${orderId}/submit`, headers: { authorization: `Bearer ${token}` } });
    await app.orders!.idle();
    const view = (await app.inject({ method: 'GET', url: `/api/orders/${orderId}`, headers: { authorization: `Bearer ${token}` } })).json();
    expect(view).toMatchObject({ state: 'quoted', pages: 32, coverApproximate: true, bookCents: null, lulu: { checked: false, reason: 'no Lulu credentials' } });
  });

  it('refuses to start before every file has arrived, and fails a file that changed in transit', async () => {
    const { app } = await setup();
    const up = await sampleUpload();
    const partial = await placeOrder(app, up, { skip: 'media/img1.jpg' });
    const early = await app.inject({ method: 'POST', url: `/api/orders/${partial.orderId}/submit`, headers: { authorization: `Bearer ${partial.token}` } });
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toMatch(/1 of 2 files are missing or incomplete: media\/img1\.jpg/);

    const bad = await placeOrder(app, up, { corrupt: 'media/img1.jpg' });
    await app.inject({ method: 'POST', url: `/api/orders/${bad.orderId}/submit`, headers: { authorization: `Bearer ${bad.token}` } });
    await app.orders!.idle();
    const view = (await app.inject({ method: 'GET', url: `/api/orders/${bad.orderId}`, headers: { authorization: `Bearer ${bad.token}` } })).json();
    expect(view).toMatchObject({ state: 'failed', error: 'A picture did not arrive intact (media/img1.jpg).', proof: null });
  });

  it('fails the order, before any payment, when Lulu rejects the files', async () => {
    const { lulu } = fakeLulu({ interiorStatus: 'ERROR' });
    const { app, db } = await setup({ store: reachable, lulu });
    const { orderId, token } = await placeOrder(app, await sampleUpload());
    await app.inject({ method: 'POST', url: `/api/orders/${orderId}/submit`, headers: { authorization: `Bearer ${token}` } });
    await app.orders!.idle();
    const view = (await app.inject({ method: 'GET', url: `/api/orders/${orderId}`, headers: { authorization: `Bearer ${token}` } })).json();
    expect(view).toMatchObject({ state: 'failed', error: 'The printer could not use the print files: Fonts not embedded' });
    expect(db.events(orderId)).toMatchObject([{ from: 'draft', to: 'failed', cause: 'job:prepare', detail: 'OrderError' }]);
  });

  it('keeps orders private: wrong token, forged or expired upload links', async () => {
    const { app } = await setup();
    const up = await sampleUpload();
    const created = (await app.inject({ method: 'POST', url: '/api/orders', payload: up.request })).json();
    expect((await app.inject({ method: 'GET', url: `/api/orders/${created.orderId}`, headers: { authorization: 'Bearer nope' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/orders/${created.orderId}` })).statusCode).toBe(404);
    const u = created.uploads[1];
    // The link is for this key and content type only.
    expect((await app.inject({ method: 'PUT', url: u.url.replace('img1.jpg', 'img2.jpg'), headers: u.headers, payload: Buffer.from(up.jpeg) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: u.url, headers: { 'content-type': 'image/png' }, payload: Buffer.from(up.jpeg) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: u.url })).statusCode).toBe(403);
  });

  it('validates the manifest', async () => {
    const { app } = await setup();
    const up = await sampleUpload();
    for (const payload of [
      { ...up.request, files: [{ ...up.request.files[0]!, path: '../../etc/passwd' }] },
      { ...up.request, files: [up.request.files[0]!, up.request.files[0]!] },
      { ...up.request, bundle: { bytes: 10, sha256: 'xyz' } },
      { ...up.request, product: { trim: 'A4' } },
    ]) {
      expect((await app.inject({ method: 'POST', url: '/api/orders', payload })).statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
    }
  });

  it('answers CORS preflights only for the configured website origins', async () => {
    const app = buildApp(loadConfig({ WEB_ORIGIN: 'https://logbook.example' }), { logger: false, store: new LocalStore(tmp()), db: new OrderDb(':memory:'), render: fakeRender() });
    apps.push(app);
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/orders', headers: { origin: 'https://logbook.example', 'access-control-request-method': 'POST' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('https://logbook.example');
    expect(pre.headers['access-control-allow-headers']).toBe('authorization, content-type');
    const other = await app.inject({ method: 'OPTIONS', url: '/api/orders', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    // The desktop app's window, on each platform (D79).
    for (const origin of ['tauri://localhost', 'http://tauri.localhost']) {
      const app2 = await app.inject({ method: 'OPTIONS', url: '/api/orders', headers: { origin, 'access-control-request-method': 'POST' } });
      expect(app2.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('serves the page Stripe sends desktop customers back to (D79)', async () => {
    const app = buildApp(loadConfig({}), { logger: false, store: new LocalStore(tmp()), db: new OrderDb(':memory:'), render: fakeRender() });
    apps.push(app);
    const res = await app.inject({ method: 'GET', url: '/api/checkout/done' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('go back to Logbook');
  });

  it('limits how many orders one address can start per hour', async () => {
    const { HourlyLimit } = await import('../src/orders/routes.ts');
    let now = 0;
    const limit = new HourlyLimit(2, () => now);
    expect([limit.take('a'), limit.take('a'), limit.take('a'), limit.take('b')]).toEqual([true, true, false, true]);
    now += 60 * 60 * 1000 + 1;
    expect(limit.take('a')).toBe(true);
    const { app } = await setup();
    const up = await sampleUpload();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await app.inject({ method: 'POST', url: '/api/orders', payload: up.request })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('says 503 when no storage is configured', async () => {
    const app = buildApp(loadConfig({}), { logger: false });
    apps.push(app);
    expect((await app.inject({ method: 'POST', url: '/api/orders', payload: {} })).statusCode).toBe(503);
  });
});

describe('order database', () => {
  const product = { trim: '6x9', interior: 'color', binding: 'paperback', finish: 'matte' } as const;

  it('records every state change, and an illegal one changes nothing', () => {
    const db = new OrderDb(':memory:');
    db.create({ id: 'o1', tokenHash: 'h', podPackageId: PB, product, uploads: [] });
    db.move('o1', 'quoted', 'job:prepare');
    expect(() => db.move('o1', 'paid', 'stripe:evt_1')).toThrow(/can't go from quoted to paid/);
    expect(db.get('o1')!.state).toBe('quoted');
    expect(db.events('o1').map((e) => e.to)).toEqual(['quoted']);
    db.close();
  });

  it('finds drafts to resume after a restart, and sweeps files of idle orders', async () => {
    const db = new OrderDb(':memory:');
    db.create({ id: 'waiting', tokenHash: 'h', podPackageId: PB, product, uploads: [] }, new Date('2026-09-01T00:00:00Z'));
    db.create({ id: 'busy', tokenHash: 'h', podPackageId: PB, product, uploads: [] });
    db.update('busy', { stage: 'rendering' });
    expect(db.unfinished().map((o) => o.id)).toEqual(['busy']);

    const local = new LocalStore(tmp());
    await local.put('orders/waiting/upload/bundle.json', new Uint8Array([1]));
    await local.put('orders/busy/upload/bundle.json', new Uint8Array([1]));
    const app = buildApp(loadConfig({}), { logger: false, store: local, db, render: fakeRender() });
    apps.push(app);
    expect(await app.orders!.sweep()).toBe(1);
    expect(await local.size('orders/waiting/upload/bundle.json')).toBeNull();
    expect(await local.size('orders/busy/upload/bundle.json')).toBe(1);
  });
});

describe('OrderDb migrations', () => {
  it('upgrades a database made before migrations were numbered, keeping its orders', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const path = join(tmp(), 'old.sqlite');
    const old = new DatabaseSync(path);
    old.exec(`
      create table orders (id text primary key, token_hash text not null, state text not null, stage text, pod_package_id text not null, product text not null, uploads text not null, pages integer, cover_approximate integer, book_cents integer, lulu text, error text, created_at text not null, updated_at text not null);
      create table order_events (id integer primary key autoincrement, order_id text not null references orders(id), from_state text not null, to_state text not null, cause text not null, detail text, at text not null);
      insert into orders values ('ord_old', 'h', 'quoted', null, '${PB}', '{}', '[]', 32, 0, 2499, null, null, '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z');
    `);
    old.close();

    const db = new OrderDb(path);
    expect(db.get('ord_old')).toMatchObject({ state: 'quoted', bookCents: 2499, quote: null, checkout: null, payment: null });
    expect(db.onceForStripeEvent({ id: 'evt_1', type: 't', orderId: 'ord_old' }, () => 'done')).toBe('done');
    // A replayed event runs nothing.
    expect(db.onceForStripeEvent({ id: 'evt_1', type: 't', orderId: 'ord_old' }, () => 'again')).toBeUndefined();
    db.close();
    // Opening again runs no migration twice.
    const again = new OrderDb(path);
    expect(again.stripeEvents('ord_old')).toMatchObject([{ id: 'evt_1', outcome: 'done' }]);
    again.close();
  });

  it('keeps working after a commit fails', () => {
    const db = new OrderDb(':memory:');
    db.create({ id: 'ord_1', tokenHash: 'h', podPackageId: PB, product: {} as never, uploads: [] });
    const raw = (db as unknown as { db: { exec(sql: string): void } }).db;
    const exec = raw.exec.bind(raw);
    let failNext = true;
    raw.exec = (sql: string) => {
      if (sql === 'commit' && failNext) {
        failNext = false;
        throw new Error('disk I/O error');
      }
      exec(sql);
    };
    expect(() => db.move('ord_1', 'quoted', 'test')).toThrow('disk I/O error');
    expect(db.get('ord_1')!.state).toBe('draft');
    // The next transaction starts cleanly instead of failing on a broken savepoint name.
    db.move('ord_1', 'quoted', 'test');
    expect(db.get('ord_1')!.state).toBe('quoted');
    expect(db.nextCheckoutAttempt('ord_1')).toBe(1);
    expect(db.nextCheckoutAttempt('ord_1')).toBe(2);
    db.close();
  });

  it('rolls back everything a Stripe event changed when applying it fails', () => {
    const db = new OrderDb(':memory:');
    db.create({ id: 'ord_1', tokenHash: 'h', podPackageId: PB, product: {} as never, uploads: [] });
    expect(() =>
      db.onceForStripeEvent({ id: 'evt_2', type: 't', orderId: 'ord_1' }, () => {
        db.move('ord_1', 'quoted', 'test');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.get('ord_1')!.state).toBe('draft');
    expect(db.events('ord_1')).toEqual([]);
    expect(db.stripeEvents()).toEqual([]);
    db.close();
  });
});
