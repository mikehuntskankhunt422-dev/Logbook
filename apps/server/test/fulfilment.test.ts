import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Product } from '@logbook/core';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { isResendTestSender, ResendMailer, type EmailMessage, type Mailer } from '../src/email/mailer.ts';
import { renderEmail } from '../src/email/templates.ts';
import { AddressError, fitStreet, luluAddress } from '../src/fulfilment/address.ts';
import { backoffMs, JobRunner, MAX_ATTEMPTS, PermanentJobError } from '../src/jobs/runner.ts';
import { LuluClient } from '../src/lulu/client.ts';
import { OrderDb, type Payment } from '../src/orders/db.ts';
import { hashPrintFile } from '../src/orders/service.ts';
import { StripeGateway } from '../src/payments/stripe.ts';
import { LocalStore } from '../src/storage/local.ts';
import type { ObjectStore } from '../src/storage/store.ts';

const PB = '0600X0900.FC.PRE.PB.080CW444.MXX';
const PRODUCT: Product = { trim: '6x9', interior: 'color', binding: 'paperback', finish: 'matte' };
const config = loadConfig({ LULU_SANDBOX_CLIENT_KEY: 'k', LULU_SANDBOX_CLIENT_SECRET: 'lulu-secret', OWNER_EMAIL: 'owner@example.com' });
const UNPAID = JSON.parse(readFileSync(new URL('./fixtures/lulu-job-unpaid.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const INTERIOR = new TextEncoder().encode('%PDF-1.7 interior pages');
const COVER = new TextEncoder().encode('%PDF-1.7 cover');
const md5 = (b: Uint8Array) => createHash('md5').update(b).digest('hex');

type Job = { id: number; external_id: string; status: { name: string; message?: string; changed?: string }; line_items: Record<string, unknown>[]; estimated_shipping_dates?: unknown };

/** An in-memory Lulu behind the real client: validations, print jobs, search and cancel (shapes from M4 §1). */
function fakeLulu() {
  const jobs = new Map<number, Job>();
  const created: Record<string, unknown>[] = [];
  const cancelled: number[] = [];
  const s = { validation: 'NORMALIZED', validationError: 'Fonts not embedded', pageCount: 200, down: false, loseCreates: 0, refuseCreate: null as unknown, createStatus: 'UNPAID' };
  let next = 345200;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname.endsWith('/token')) return Response.json({ access_token: 't', expires_in: 3600 });
    if (s.down) return new Response('<html>503</html>', { status: 503 });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const path = url.pathname;
    if (method === 'POST' && path === '/validate-interior/') return Response.json({ id: 11, status: null }, { status: 201 });
    if (method === 'GET' && path === '/validate-interior/11/') return Response.json({ id: 11, status: s.validation, page_count: s.pageCount, errors: s.validation === 'ERROR' ? [s.validationError] : null });
    if (method === 'POST' && path === '/validate-cover/') return Response.json({ id: 12, status: null }, { status: 201 });
    if (method === 'GET' && path === '/validate-cover/12/') return Response.json({ id: 12, status: s.validation === 'ERROR' ? 'ERROR' : 'NORMALIZED', errors: null });
    if (method === 'POST' && path === '/print-jobs/') {
      if (s.refuseCreate) return Response.json(s.refuseCreate, { status: 400 });
      created.push(body);
      const li = (body['line_items'] as Record<string, Record<string, unknown>>[])[0]!;
      const job: Job = {
        ...(UNPAID as unknown as Job),
        id: ++next,
        external_id: String(body['external_id']),
        status: { name: s.createStatus, message: 'Print-job was accepted and needs to be paid', changed: '2026-10-08T10:00:07Z' },
        line_items: [{ ...(UNPAID['line_items'] as Record<string, unknown>[])[0], external_id: body['external_id'], printable_normalization: li['printable_normalization'] }],
      };
      jobs.set(job.id, job);
      if (s.loseCreates > 0) {
        s.loseCreates--;
        throw new TypeError('fetch failed');
      }
      return Response.json(job, { status: 201 });
    }
    if (method === 'GET' && path === '/print-jobs/') {
      const q = url.searchParams.get('search') ?? '';
      const results = [...jobs.values()].filter((j) => j.external_id.includes(q) || String(j.id) === q);
      return Response.json({ count: results.length, next: null, previous: null, results });
    }
    const m = /^\/print-jobs\/(\d+)\/(status\/)?$/.exec(path);
    const job = m && jobs.get(Number(m[1]));
    if (job && method === 'GET' && !m[2]) return Response.json(job);
    if (job && method === 'PUT' && m[2]) {
      cancelled.push(job.id);
      job.status = { name: 'CANCELED', message: 'Print-job was canceled' };
      return Response.json({ ...job.status, line_item_statuses: [], print_job_id: job.id });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;

  /** Lulu moves a job on (what the sandbox would do once paid). */
  function advance(id: number, name: string, extra: { tracking?: boolean; lineItem?: Record<string, unknown> } = {}) {
    const job = jobs.get(id)!;
    job.status = { name, message: name, changed: '2026-10-10T09:00:00Z' };
    job.line_items[0] = {
      ...job.line_items[0],
      status: { name: extra.lineItem ? 'REJECTED' : name === 'SHIPPED' ? 'SHIPPED' : 'ACCEPTED', messages: extra.lineItem ?? {} },
      ...(extra.tracking ? { tracking_id: 'TRK123', tracking_urls: ['https://track.example/TRK123'], carrier_name: 'Australia Post' } : {}),
    };
    job.estimated_shipping_dates = { arrival_min: '2026-10-20', arrival_max: '2026-10-24', dispatch_min: '2026-10-12', dispatch_max: '2026-10-13' };
  }
  return { client: new LuluClient(config.lulu!, { fetch, sleep: async () => {} }), jobs, created, cancelled, state: s, advance };
}

/** Stripe's refunds endpoint behind the real SDK. */
function fakeStripe() {
  const refunds: { paymentIntent: string | null; key: string | null; metadata: string | null }[] = [];
  const s = { alreadyRefunded: false, down: false };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    if (url.pathname !== '/v1/refunds') return Response.json({ error: { type: 'invalid_request_error', message: 'nope' } }, { status: 404 });
    if (s.down) return Response.json({ error: { type: 'api_error', message: 'down' } }, { status: 400 });
    if (s.alreadyRefunded) return Response.json({ error: { type: 'invalid_request_error', code: 'charge_already_refunded', message: 'Charge ch_1 has already been refunded.' } }, { status: 400 });
    refunds.push({ paymentIntent: form.get('payment_intent'), key: new Headers(init?.headers).get('idempotency-key'), metadata: form.get('metadata[order_id]') });
    return Response.json({ id: 're_1', object: 'refund', amount: 5999, currency: 'usd', status: 'succeeded', payment_intent: form.get('payment_intent') });
  }) as typeof globalThis.fetch;
  return { gateway: new StripeGateway('sk_test_fake', 'whsec_x', { fetch }), refunds, state: s };
}

function recordingMailer(reachesCustomers = true): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { enabled: true, reachesCustomers, sent, send: async (m) => (sent.push(m), { id: `em_${sent.length}` }) };
}

/** The local store, pretending Lulu can reach it. */
function reachable(store: LocalStore): ObjectStore {
  return new Proxy(store, { get: (t, p) => (p === 'reachableFromInternet' ? true : Reflect.get(t, p, t)) as unknown }) as ObjectStore;
}

const PAYMENT: Payment = {
  sessionId: 'cs_test_1',
  paymentIntent: 'pi_test_1',
  amountTotal: 5999,
  amountShipping: 1000,
  amountTax: 0,
  currency: 'usd',
  shippingLevel: 'MAIL',
  email: 'reader@example.com',
  phone: '+61 400 000 000',
  name: 'Sam Reader',
  address: { line1: '1 King William St', line2: null, city: 'Adelaide', state: 'SA', postalCode: '5000', country: 'AU' },
  recipientTaxId: null,
  paidAt: '2026-10-08T10:00:00.000Z',
};

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

async function setup(opts: { faults?: string; reachable?: boolean; payment?: Partial<Payment>; reachesCustomers?: boolean } = {}) {
  const db = new OrderDb(':memory:');
  const local = new LocalStore(mkdtempSync(join(tmpdir(), 'logbook-fulfil-')));
  const store = opts.reachable === false ? local : reachable(local);
  const lulu = fakeLulu();
  const stripe = fakeStripe();
  const mailer = recordingMailer(opts.reachesCustomers);
  const clock = { now: new Date('2026-10-08T10:00:00Z') };
  const cfg = opts.faults ? loadConfig({ LULU_SANDBOX_CLIENT_KEY: 'k', LULU_SANDBOX_CLIENT_SECRET: 'lulu-secret', OWNER_EMAIL: 'owner@example.com', LOGBOOK_FAULTS: opts.faults }) : config;
  const app = buildApp(cfg, { logger: false, store, db, lulu: lulu.client, stripe: stripe.gateway, mailer, startJobs: false, now: () => clock.now });
  apps.push(app);
  await app.ready();

  // A paid order, as Checkout leaves it (M3): print files with their hashes, the payment, and the fulfilment job.
  const id = 'ord_paid';
  db.create({ id, tokenHash: 'x', podPackageId: PB, product: PRODUCT, uploads: [] }, clock.now);
  await local.put(`orders/${id}/print/interior.pdf`, INTERIOR);
  await local.put(`orders/${id}/print/cover.pdf`, COVER);
  db.update(id, { pages: 200, bookCents: 4999, stage: null, printFiles: { interior: hashPrintFile(INTERIOR), cover: hashPrintFile(COVER), at: clock.now.toISOString() } }, clock.now);
  db.move(id, 'quoted', 'job:prepare', { now: clock.now });
  db.move(id, 'awaiting_payment', 'customer:checkout', { now: clock.now });
  db.update(id, { payment: { ...PAYMENT, ...opts.payment } }, clock.now);
  db.move(id, 'paid', 'stripe:evt_1', { now: clock.now });
  db.enqueueJob(id, 'fulfil', { mode: 'once', now: clock.now });

  /** Runs every job due now, repeatedly, until none is left. */
  const run = async () => {
    for (let i = 0; i < 50 && (await app.jobs!.runDue()) > 0; i++);
  };
  const later = async (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
    await run();
  };
  const states = () => db.events(id).map((e) => e.to);
  return { app, db, local, lulu, stripe, mailer, clock, id, run, later, states, order: () => db.get(id)! };
}

describe('fitting a Stripe address into Lulu’s (PLAN risk #7)', () => {
  it('keeps lines that fit, and re-wraps long ones at spaces', () => {
    expect(fitStreet('1 King William St', '')).toEqual(['1 King William St', '']);
    expect(fitStreet('Apartment 1204, 1500 North Lakeshore Drive', '')).toEqual(['Apartment 1204, 1500 North', 'Lakeshore Drive']);
    expect(fitStreet('Unit 5, The Old Mill Building, Long Lane', 'Little Snoring')).toEqual(['Unit 5, The Old Mill Building', 'Long Lane, Little Snoring']);
    expect(fitStreet('Supercalifragilisticexpialidocious Road', '')).toBeNull();
    expect(fitStreet('A very long street address that goes on', 'and on and on and on and on forever')).toBeNull();
  });

  it('maps Stripe’s payment to Lulu’s address, with a state code only when it is one', () => {
    expect(luluAddress(PAYMENT)).toEqual({ name: 'Sam Reader', street1: '1 King William St', city: 'Adelaide', stateCode: 'SA', countryCode: 'AU', postcode: '5000', phoneNumber: '+61 400 000 000', email: 'reader@example.com' });
    const ie = luluAddress({ ...PAYMENT, address: { ...PAYMENT.address!, state: 'County Dublin', country: 'IE', postalCode: null }, recipientTaxId: null });
    expect(ie.stateCode).toBeUndefined();
    expect(ie.postcode).toBe('');
    expect(luluAddress({ ...PAYMENT, address: { ...PAYMENT.address!, country: 'BR' }, recipientTaxId: ' 123.456.789-09 ' }).recipientTaxId).toBe('123.456.789-09');
  });

  it('refuses what Lulu would refuse', () => {
    expect(() => luluAddress({ ...PAYMENT, name: 'Bartholomew Montgomery-Fitzwilliam the Third' })).toThrow(AddressError);
    expect(() => luluAddress({ ...PAYMENT, phone: null })).toThrow(/phone/);
    expect(() => luluAddress({ ...PAYMENT, address: { ...PAYMENT.address!, city: 'Llanfairpwllgwyngyllgogerychwyrndrobwll' } })).toThrow(/city/);
    expect(() => luluAddress({ ...PAYMENT, address: null })).toThrow(/no shipping address/);
  });
});

describe('job runner (D68)', () => {
  it('backs off 1, 2, 4 … minutes up to an hour', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => backoffMs(n) / 60_000)).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
  });

  it('retries a failing job with backoff, then gives up once and says so', async () => {
    const db = new OrderDb(':memory:');
    db.create({ id: 'o', tokenHash: 'x', podPackageId: PB, product: PRODUCT, uploads: [] });
    let now = new Date('2026-10-08T00:00:00Z');
    const dead: string[] = [];
    let runs = 0;
    const runner = new JobRunner({
      db,
      handle: async () => {
        runs++;
        throw new Error('Lulu is down');
      },
      onDead: (job) => void dead.push(job.kind),
      log: { info: () => {}, warn: () => {}, error: () => {} },
      now: () => now,
    });
    db.enqueueJob('o', 'fulfil', { now });
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await runner.runDue();
      now = new Date(now.getTime() + 61 * 60_000);
    }
    expect(runs).toBe(MAX_ATTEMPTS);
    expect(dead).toEqual(['fulfil']);
    expect(db.jobs('o')[0]).toMatchObject({ state: 'dead', attempts: MAX_ATTEMPTS, lastError: 'Error: Lulu is down' });
  });

  it('gives up at once on a permanent error, and never lets a finished run undo a newer request', async () => {
    const db = new OrderDb(':memory:');
    db.create({ id: 'o', tokenHash: 'x', podPackageId: PB, product: PRODUCT, uploads: [] });
    const now = new Date('2026-10-08T00:00:00Z');
    const runner = new JobRunner({
      db,
      handle: async (job) => {
        if (job.kind === 'refund') throw new PermanentJobError('no payment');
        // While this track run is under way, a webhook asks for another look.
        db.enqueueJob('o', 'track', { mode: 'restart', now });
        return { again: new Date(now.getTime() + 6 * 3600_000) };
      },
      onDead: () => {},
      log: { info: () => {}, warn: () => {}, error: () => {} },
      now: () => now,
    });
    db.enqueueJob('o', 'refund', { now });
    db.enqueueJob('o', 'track', { now });
    await runner.runDue();
    const [refund, track] = db.jobs('o');
    expect(refund).toMatchObject({ state: 'dead', attempts: 1 });
    // The webhook's request stands: the track job is due now, not in six hours.
    expect(track).toMatchObject({ state: 'queued', runAt: now.toISOString(), version: 1 });
  });
});

describe('fulfilment (PLAN §1.5 steps 7–8)', () => {
  it('confirms the files, has Lulu check them, and creates one print job with their MD5s', async () => {
    const t = await setup();
    await t.run();
    expect(t.states()).toEqual(['quoted', 'awaiting_payment', 'paid', 'files_generated', 'files_validated', 'submitted_to_lulu']);
    expect(t.lulu.created).toHaveLength(1);
    const body = t.lulu.created[0]!;
    expect(body).toMatchObject({
      external_id: 'ord_paid',
      contact_email: 'owner@example.com',
      shipping_level: 'MAIL',
      line_items: [{ external_id: 'ord_paid', title: 'Logbook journal', quantity: 1, printable_normalization: { pod_package_id: PB, interior: { source_md5sum: md5(INTERIOR) }, cover: { source_md5sum: md5(COVER) } } }],
      shipping_address: { name: 'Sam Reader', street1: '1 King William St', city: 'Adelaide', state_code: 'SA', country_code: 'AU', postcode: '5000', phone_number: '+61 400 000 000', email: 'reader@example.com' },
    });
    expect(t.order().luluJob).toMatchObject({ id: 345201, status: 'UNPAID', lineItemStatus: 'ACCEPTED', submittedAt: '2026-10-08T10:00:00.000Z' });
    expect(t.order().lulu).toMatchObject({ checked: true, interior: { status: 'NORMALIZED' } });
    // Tracking takes over; nothing was emailed yet.
    expect(t.db.jobs(t.id).map((j) => `${j.kind}:${j.state}`)).toEqual(['fulfil:done', 'track:queued']);
    expect(t.mailer.sent).toEqual([]);
  });

  it('follows the job to delivery, emailing the tracking link once', async () => {
    const t = await setup();
    await t.run();
    const job = t.order().luluJob!.id;
    t.lulu.advance(job, 'PRODUCTION_DELAYED');
    await t.later(2 * 60_000);
    expect(t.order().state).toBe('submitted_to_lulu');
    t.lulu.advance(job, 'IN_PRODUCTION');
    await t.later(15 * 60_000);
    expect(t.order().state).toBe('in_production');
    t.lulu.advance(job, 'SHIPPED', { tracking: true });
    await t.later(6 * 3600_000);
    expect(t.order()).toMatchObject({ state: 'shipped', luluJob: { tracking: { id: 'TRK123', urls: ['https://track.example/TRK123'], carrier: 'Australia Post' }, arrival: { max: '2026-10-24' } } });
    expect(t.mailer.sent.map((m) => [m.to, m.tag])).toEqual([['reader@example.com', 'shipped']]);
    expect(t.mailer.sent[0]!.text).toContain('https://track.example/TRK123');
    await t.later(6 * 3600_000);
    expect(t.mailer.sent).toHaveLength(1);
    t.lulu.advance(job, 'DELIVERED');
    await t.later(6 * 3600_000);
    expect(t.order().state).toBe('delivered');
    expect(t.db.jobs(t.id).find((j) => j.kind === 'track')!.state).toBe('done');
    const view = await t.app.orders!.view(t.order());
    expect(view.delivery).toEqual({ carrier: 'Australia Post', trackingUrls: ['https://track.example/TRK123'], arrivalMin: '2026-10-20', arrivalMax: '2026-10-24' });
  });

  it('adopts the job a lost answer created instead of making a second one (D67)', async () => {
    const t = await setup();
    t.lulu.state.loseCreates = 1;
    await t.run();
    expect(t.order().state).toBe('files_validated');
    expect(t.db.jobs(t.id)[0]).toMatchObject({ kind: 'fulfil', state: 'queued', attempts: 1 });
    await t.later(60_000);
    expect(t.order().state).toBe('submitted_to_lulu');
    expect(t.lulu.jobs.size).toBe(1);
    expect(t.order().luluJob!.id).toBe([...t.lulu.jobs.keys()][0]);
  });

  it('lets a verified Lulu webhook (hex or base64) prompt a fresh look, and refuses a forged one', async () => {
    const t = await setup();
    await t.run();
    const job = t.order().luluJob!.id;
    t.lulu.advance(job, 'IN_PRODUCTION');
    // The body says SHIPPED, but the server believes only what Lulu's API says (D69).
    const payload = JSON.stringify({ topic: 'PRINT_JOB_STATUS_CHANGED', data: { id: job, external_id: 'ord_paid', status: { name: 'SHIPPED' } } });
    const mac = createHmac('sha256', 'lulu-secret').update(payload).digest();
    const send = (sig: string | undefined, body = payload) => t.app.inject({ method: 'POST', url: '/api/lulu/webhook', headers: { 'content-type': 'application/json', ...(sig ? { 'lulu-hmac-sha256': sig } : {}) }, payload: body });

    expect((await send(undefined)).statusCode).toBe(401);
    expect((await send(createHmac('sha256', 'wrong').update(payload).digest('hex'))).statusCode).toBe(401);
    const res = await send(mac.toString('hex'));
    expect([res.statusCode, res.json()]).toEqual([200, { received: true, outcome: 'queued' }]);
    await t.run();
    expect(t.order().state).toBe('in_production');
    expect((await send(mac.toString('base64'))).json().outcome).toBe('queued');
    // Lulu's test submission carries a dummy job.
    const dummy = JSON.stringify({ topic: 'PRINT_JOB_STATUS_CHANGED', data: { id: 1, external_id: 'demo' } });
    expect((await send(createHmac('sha256', 'lulu-secret').update(dummy).digest('hex'), dummy)).json().outcome).toBe('unknown job');
  });
});

describe('failures after payment (PLAN §1.5 step 9)', () => {
  it('refunds in full when the print files are gone, emailing the customer and you', async () => {
    const t = await setup({ faults: 'files-missing' });
    await t.run();
    expect(t.states().slice(2)).toEqual(['paid', 'needs_attention', 'refunded']);
    expect(t.stripe.refunds).toEqual([{ paymentIntent: 'pi_test_1', key: 'refund:ord_paid', metadata: 'ord_paid' }]);
    expect(t.order()).toMatchObject({ error: 'The print files were deleted before the book could be printed.', refund: { id: 're_1', amount: 5999, status: 'succeeded' } });
    expect(t.mailer.sent.map((m) => [m.to, m.tag]).sort()).toEqual([
      ['owner@example.com', 'alert'],
      ['reader@example.com', 'refunded'],
    ]);
    expect(t.lulu.created).toEqual([]);
    const view = await t.app.orders!.view(t.order());
    // The customer sees the refund, not our internal reason.
    expect(view).toMatchObject({ state: 'refunded', error: null, refunded: { amountCents: 5999, currency: 'usd' } });
  });

  it('refunds when the files changed after approval, or Lulu now refuses them', async () => {
    const changed = await setup();
    await changed.local.put('orders/ord_paid/print/interior.pdf', new TextEncoder().encode('%PDF-1.7 something else'));
    await changed.run();
    expect(changed.order()).toMatchObject({ state: 'refunded', error: 'The print files are not the ones the customer approved.' });

    const refused = await setup();
    refused.lulu.state.validation = 'ERROR';
    await refused.run();
    expect(refused.order()).toMatchObject({ state: 'refunded', error: 'The printer could not use the print files: Fonts not embedded' });
  });

  it('tries again, rather than refunding, when Lulu only failed to download a file', async () => {
    const t = await setup();
    t.lulu.state.validation = 'ERROR';
    t.lulu.state.validationError = "Failed to fetch from the source URL 'https://bucket.example/i.pdf?X-Amz-Signature=s', received a 503 status code.";
    await t.run();
    expect(t.order().state).toBe('files_generated');
    expect(t.db.jobs(t.id)[0]).toMatchObject({ kind: 'fulfil', state: 'queued', attempts: 1 });
    expect(t.db.jobs(t.id)[0]!.lastError).not.toContain('X-Amz-Signature');
    t.lulu.state.validation = 'NORMALIZED';
    await t.later(60_000);
    expect(t.order().state).toBe('submitted_to_lulu');
    expect(t.stripe.refunds).toEqual([]);
  });

  it('retries while Lulu is down, then hands over to a person without refunding', async () => {
    const t = await setup({ faults: 'lulu-down' });
    await t.run();
    expect(t.order().state).toBe('files_generated');
    for (let i = 0; i < MAX_ATTEMPTS; i++) await t.later(60 * 60_000);
    expect(t.order()).toMatchObject({ state: 'needs_attention', refund: null });
    expect(t.order().error).toMatch(/^Sending the book to the printer failed: Lulu is unreachable/);
    expect(t.db.jobs(t.id)[0]).toMatchObject({ kind: 'fulfil', state: 'dead', attempts: MAX_ATTEMPTS });
    expect(t.mailer.sent.map((m) => m.tag).sort()).toEqual(['alert', 'problem']);
    expect(t.stripe.refunds).toEqual([]);
  });

  it('hands an address Lulu can’t take to a person', async () => {
    const long = await setup({ payment: { name: 'Bartholomew Montgomery-Fitzwilliam the Third' } });
    await long.run();
    expect(long.order()).toMatchObject({ state: 'needs_attention', error: "The recipient's name is longer than Lulu's 35 characters." });
    expect(long.lulu.created).toEqual([]);

    const refused = await setup();
    refused.lulu.state.refuseCreate = { shipping_address: { postcode: ['Invalid postcode'] } };
    await refused.run();
    expect(refused.order().state).toBe('needs_attention');
    expect(refused.order().error).toMatch(/^Lulu refused the print job: .*Invalid postcode/);
    expect(refused.stripe.refunds).toEqual([]);
  });

  it('refunds a job Lulu rejects (the lulu-reject fault sends a wrong MD5), without logging signed links', async () => {
    const t = await setup({ faults: 'lulu-reject' });
    await t.run();
    expect((t.lulu.created[0]!['line_items'] as { printable_normalization: { interior: { source_md5sum: string } } }[])[0]!.printable_normalization.interior.source_md5sum).toBe('0'.repeat(32));
    const job = t.order().luluJob!.id;
    t.lulu.advance(job, 'REJECTED', { lineItem: { printable_normalization: { interior: ["Given md5sum doesn't match actual md5sum (abc) of file from 'https://bucket.example/i.pdf?X-Amz-Signature=secret'"] } } });
    await t.later(2 * 60_000);
    expect(t.order().state).toBe('refunded');
    expect(t.order().error).toMatch(/^Lulu rejected the print job: .*md5sum doesn't match.*https:\/\/bucket\.example\/i\.pdf\?…/);
    expect(JSON.stringify(t.order())).not.toContain('secret');
    // A rejected job prints nothing, so there's nothing to cancel.
    expect(t.lulu.cancelled).toEqual([]);
  });

  it('cancels Lulu’s job before refunding, and leaves a book already in production to a person', async () => {
    const t = await setup();
    await t.run();
    t.lulu.advance(t.order().luluJob!.id, 'CANCELED');
    await t.later(2 * 60_000);
    // Lulu cancelled: a person decides (no automatic refund).
    expect(t.order()).toMatchObject({ state: 'needs_attention', error: 'Lulu cancelled the print job.' });
    expect(t.stripe.refunds).toEqual([]);

    // A refund while the job can still be cancelled cancels it first.
    const u = await setup();
    await u.run();
    u.db.move(u.id, 'needs_attention', 'admin:hold');
    u.db.enqueueJob(u.id, 'refund', { now: u.clock.now });
    await u.run();
    expect(u.lulu.cancelled).toEqual([u.order().luluJob!.id]);
    expect(u.order().state).toBe('refunded');

    const p = await setup();
    await p.run();
    p.lulu.advance(p.order().luluJob!.id, 'IN_PRODUCTION');
    p.db.move(p.id, 'needs_attention', 'admin:hold');
    p.db.enqueueJob(p.id, 'refund', { now: p.clock.now });
    await p.run();
    expect(p.order()).toMatchObject({ state: 'needs_attention', refund: null });
    expect(p.order().error).toMatch(/^The automatic refund failed: Lulu's job \d+ is IN_PRODUCTION/);
    expect(p.mailer.sent.map((m) => m.tag)).toContain('alert');
  });

  it('stops for a person when Stripe says the payment was already refunded', async () => {
    const t = await setup({ faults: 'files-missing' });
    t.stripe.state.alreadyRefunded = true;
    await t.run();
    expect(t.order().state).toBe('needs_attention');
    expect(t.order().error).toMatch(/already refunded/);
  });
});

describe('emails', () => {
  it('carry no journal content and are skipped without a provider', async () => {
    const t = await setup();
    const o = { ...t.order(), luluJob: { id: 1, status: 'SHIPPED', message: null, changedAt: null, lineItemStatus: 'SHIPPED', tracking: { id: 'T', urls: ['https://t.example/1'], carrier: 'DHL' }, arrival: { min: null, max: '2026-10-24' }, submittedAt: '', checkedAt: '' } };
    for (const tpl of ['problem', 'shipped', 'refunded', 'alert'] as const) {
      const { subject, text } = renderEmail(tpl, o);
      expect(subject.length).toBeGreaterThan(5);
      expect(text).toContain('ord_paid');
    }
    expect(renderEmail('shipped', o).text).toContain('handed to DHL');
    expect(renderEmail('shipped', o).text).toContain('arrive by 2026-10-24');
    expect(renderEmail('alert', { ...o, state: 'needs_attention' }).text).toContain('Order ord_paid needs attention. Its state is now: needs attention.');
  });

  it("go only to you while EMAIL_FROM is Resend's test sender (D76)", async () => {
    expect(['Logbook <onboarding@resend.dev>', 'onboarding@resend.dev', 'Logbook <ONBOARDING@Resend.dev> '].map(isResendTestSender)).toEqual([true, true, true]);
    expect(['Logbook <orders@example.com>', 'a@resend.dev.example.com', 'resend.dev <a@example.com>'].map(isResendTestSender)).toEqual([false, false, false]);
    expect(new ResendMailer('re_x', 'Logbook <onboarding@resend.dev>').reachesCustomers).toBe(false);
    expect(new ResendMailer('re_x', 'Logbook <orders@example.com>').reachesCustomers).toBe(true);

    const t = await setup({ faults: 'files-missing', reachesCustomers: false });
    await t.run();
    expect(t.order().state).toBe('refunded');
    expect(t.mailer.sent.map((m) => [m.to, m.tag])).toEqual([['owner@example.com', 'alert']]);
    // The skipped customer email is settled, not retried.
    expect(t.db.jobs(t.id).filter((j) => j.kind === 'email').map((j) => [j.key, j.state, j.attempts]).sort()).toEqual([
      ['alert:1', 'done', 0],
      ['refunded', 'done', 0],
    ]);
  });
});
