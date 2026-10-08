import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';
import { afterEach, describe, expect, it } from 'vitest';
import type { Product } from '@logbook/core';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { LuluClient, type ShippingOption } from '../src/lulu/client.ts';
import { returnBase } from '../src/orders/checkout.ts';
import { OrderDb } from '../src/orders/db.ts';
import { StripeGateway } from '../src/payments/stripe.ts';
import { LocalStore } from '../src/storage/local.ts';

const SECRET = 'whsec_test_secret';
const PB = '0600X0900.FC.PRE.PB.080CW444.MXX';
const PRODUCT: Product = { trim: '6x9', interior: 'color', binding: 'paperback', finish: 'matte' };
const SITE = 'http://localhost:4173/';
const config = loadConfig({ LULU_SANDBOX_CLIENT_KEY: 'k', LULU_SANDBOX_CLIENT_SECRET: 's' });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const opt = (level: string, cost: number, min: number, max: number, name: string): ShippingOption => ({
  level,
  carrier_service_name: name,
  cost_excl_tax: cost,
  currency: 'USD',
  total_days_min: min,
  total_days_max: max,
  is_active: true,
});
const SHIPPING: Record<string, ShippingOption[]> = {
  AU: [opt('MAIL', 8.34, 11, 12, 'Australia Post Mail'), opt('EXPRESS', 15.19, 6, 7, 'Australia Post Express Post Parcel')],
  BR: [opt('MAIL', 9.5, 15, 25, 'Correios DDU')],
  US: [opt('MAIL', 5.69, 10, 13, 'OSM BPM')],
};

/** Lulu: 200 pages of 6×9 premium colour cost $29.77 + $0.75 (sandbox, 2026-10-07). */
function fakeLulu() {
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(config.lulu!.apiUrl, '');
    if (path.endsWith('/token')) return Response.json({ access_token: 't', expires_in: 3600 });
    const body = JSON.parse(String(init?.body)) as { shipping_address: { country: string } };
    if (path === '/print-job-cost-calculations/')
      return Response.json(
        {
          line_item_costs: [{ cost_excl_discounts: '29.77', total_cost_excl_tax: '29.77', total_cost_incl_tax: '29.77', quantity: 1 }],
          fulfillment_cost: { total_cost_excl_tax: '0.75', total_cost_incl_tax: '0.75' },
          shipping_cost: { total_cost_excl_tax: '5.69', total_cost_incl_tax: '5.69' },
          total_cost_excl_tax: '36.21',
          total_cost_incl_tax: '36.21',
          total_tax: '0',
          currency: 'USD',
        },
        { status: 201 },
      );
    if (path === '/shipping-options/') {
      const answer = SHIPPING[body.shipping_address.country];
      return answer ? Response.json(answer) : Response.json([{ country_code: 'No shipping' }], { status: 400 });
    }
    return new Response('nope', { status: 404 });
  }) as typeof globalThis.fetch;
  return new LuluClient(config.lulu!, { fetch });
}

type FakeSession = Record<string, unknown> & { id: string; status: string; payment_status: string; shipping_options: { shipping_amount: number; shipping_rate: string }[] };

/** Stripe's API as far as Checkout goes, behind the real SDK, recording every request. */
function fakeStripe() {
  const sessions = new Map<string, FakeSession>();
  const calls: { method: string; path: string; form: URLSearchParams; key: string | null }[] = [];
  const faults = { lostCreates: 0 };
  let n = 0;
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    calls.push({ method, path: u.pathname, form, key: new Headers(init?.headers).get('idempotency-key') });
    if (method === 'POST' && u.pathname === '/v1/checkout/sessions' && faults.lostCreates > 0) {
      // Stripe made a session, but the answer never arrived.
      faults.lostCreates--;
      sessions.set(`cs_test_lost_${faults.lostCreates}`, { id: `cs_test_lost_${faults.lostCreates}`, status: 'open', payment_status: 'unpaid', shipping_options: [] });
      throw new TypeError('fetch failed');
    }
    if (method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      const id = `cs_test_${++n}`;
      const shipping = [...form.keys()].filter((k) => /^shipping_options\[\d+\]\[shipping_rate_data\]\[fixed_amount\]\[amount\]$/.test(k));
      const s: FakeSession = {
        id,
        object: 'checkout.session',
        url: `https://checkout.stripe.com/c/pay/${id}`,
        status: 'open',
        payment_status: 'unpaid',
        expires_at: Number(form.get('expires_at')),
        client_reference_id: form.get('client_reference_id'),
        metadata: { order_id: form.get('metadata[order_id]'), quote_version: form.get('metadata[quote_version]') },
        currency: 'usd',
        amount_total: null,
        custom_fields: [],
        customer_details: null,
        collected_information: null,
        shipping_cost: null,
        total_details: null,
        payment_intent: null,
        shipping_options: shipping.map((k, i) => ({ shipping_amount: Number(form.get(k)), shipping_rate: `shr_${id}_${i}` })),
      };
      sessions.set(id, s);
      return Response.json(s);
    }
    const m = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(u.pathname);
    const s = m && sessions.get(m[1]!);
    if (!s) return Response.json({ error: { type: 'invalid_request_error', message: 'No such session' } }, { status: 404 });
    if (m[2]) {
      if (s.status !== 'open') return Response.json({ error: { type: 'invalid_request_error', message: `Only open sessions can be expired (${s.status}).` } }, { status: 400 });
      s.status = 'expired';
    }
    return Response.json(s);
  }) as typeof globalThis.fetch;

  /** The customer paid on Stripe's page. */
  function pay(id: string, opts: { rate?: number; paymentStatus?: string; taxId?: string } = {}) {
    const s = sessions.get(id)!;
    const rate = s.shipping_options[opts.rate ?? 0]!;
    Object.assign(s, {
      status: 'complete',
      payment_status: opts.paymentStatus ?? 'paid',
      amount_total: 4999 + rate.shipping_amount,
      total_details: { amount_shipping: rate.shipping_amount, amount_tax: 0, amount_discount: 0 },
      shipping_cost: { amount_subtotal: rate.shipping_amount, amount_total: rate.shipping_amount, amount_tax: 0, shipping_rate: rate.shipping_rate },
      customer_details: { email: 'reader@example.com', phone: '+61 400 000 000', name: 'Sam Reader' },
      collected_information: { shipping_details: { name: 'Sam Reader', address: { line1: '1 King William St', line2: null, city: 'Adelaide', state: 'SA', postal_code: '5000', country: 'AU' } } },
      payment_intent: `pi_${id}`,
      custom_fields: opts.taxId ? [{ key: 'recipienttaxid', type: 'text', text: { value: opts.taxId } }] : [],
    });
    return s;
  }
  return { gateway: new StripeGateway('sk_test_fake', SECRET, { fetch }), sessions, calls, pay, faults };
}

let events = 0;
/** A Stripe event, signed the way Stripe signs it (the SDK's own test helper). */
function signed(type: string, object: unknown, opts: { secret?: string; timestamp?: number } = {}) {
  const payload = JSON.stringify({ id: `evt_${++events}`, object: 'event', api_version: '2026-08-26.dahlia', created: 1, type, data: { object } });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? SECRET, ...(opts.timestamp ? { timestamp: opts.timestamp } : {}) });
  return { payload, headers: { 'stripe-signature': header, 'content-type': 'application/json' } };
}

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

async function setup() {
  const db = new OrderDb(':memory:');
  const stripe = fakeStripe();
  const clock = { now: new Date('2026-10-08T10:00:00Z') };
  const store = new LocalStore(mkdtempSync(join(tmpdir(), 'logbook-checkout-')));
  // Fulfilment after payment has its own tests (fulfilment.test.ts); here the queued job just waits.
  const app = buildApp(loadConfig({}), { logger: false, store, db, lulu: fakeLulu(), stripe: stripe.gateway, now: () => clock.now, startJobs: false });
  apps.push(app);
  await app.ready();
  // An order whose print files are made and checked: 200 pages, $49.99 (PLAN §7).
  const token = 'secret-token';
  db.create({ id: 'ord_1', tokenHash: sha(token), podPackageId: PB, product: PRODUCT, uploads: [] });
  db.update('ord_1', { pages: 200, bookCents: 4999, stage: null });
  db.move('ord_1', 'quoted', 'job:prepare');
  for (const f of ['interior', 'cover']) await store.put(`orders/ord_1/print/${f}.pdf`, new TextEncoder().encode('%PDF-1.7 fake'));
  const auth = { authorization: `Bearer ${token}` };
  const view = async () => (await app.inject({ method: 'GET', url: '/api/orders/ord_1', headers: auth })).json();
  const quote = (country: string) => app.inject({ method: 'POST', url: '/api/orders/ord_1/quote', headers: auth, payload: { country } });
  const pay = (body: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/api/orders/ord_1/checkout', headers: auth, payload: { quoteVersion: 1, returnUrl: SITE, checked: true, ...body } });
  const hook = (e: ReturnType<typeof signed>) => app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: e.headers, payload: e.payload });
  return { app, db, store, stripe, clock, view, quote, pay, hook };
}

describe('quote for a destination (M3 slice D)', () => {
  it('stores a versioned quote with Lulu’s costs, and shows only prices', async () => {
    const { db, quote } = await setup();
    const res = await quote('AU');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      state: 'quoted',
      bookCents: 4999,
      quote: {
        version: 1,
        country: 'AU',
        bookCents: 4999,
        shipping: [
          { level: 'MAIL', name: 'Australia Post Mail', priceCents: 1000 },
          { level: 'EXPRESS', name: 'Australia Post Express Post Parcel', priceCents: 1750 },
        ],
      },
      checkoutUrl: null,
      paid: null,
    });
    expect(res.body).not.toMatch(/luluCents|costCents/);
    // Every price can be reproduced from what Lulu charged (M3 §4).
    expect(db.get('ord_1')!.quote).toMatchObject({ costCents: 3052, shipping: [{ luluCents: 834 }, { luluCents: 1519 }] });
    expect((await quote('US')).json().quote).toMatchObject({ version: 2, country: 'US' });
    expect(db.events('ord_1').map((e) => `${e.to}:${e.cause}:${e.detail ?? ''}`)).toEqual(['quoted:job:prepare:', 'quoted:customer:quote:AU', 'quoted:customer:quote:US']);
  });

  it('refuses countries off the list, and says when Lulu has no shipping there', async () => {
    const { quote } = await setup();
    expect((await quote('ZZ')).statusCode).toBe(400);
    expect((await quote('usa')).statusCode).toBe(400);
    const none = await quote('NZ');
    expect(none.statusCode).toBe(422);
    expect(none.json().error).toBe('The printer has no shipping to that country.');
  });
});

describe('Stripe Checkout (M3 slice E)', () => {
  it('opens Checkout from the stored quote only, for one country, and hands the same page out again', async () => {
    const { stripe, quote, pay, view, db } = await setup();
    await quote('AU');
    const res = await pay({ bookCents: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });

    const created = stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/checkout/sessions');
    expect(created).toHaveLength(1);
    const { form, key } = created[0]!;
    expect(key).toBe('checkout:ord_1:1:1');
    expect(Object.fromEntries(form)).toMatchObject({
      mode: 'payment',
      client_reference_id: 'ord_1',
      'metadata[order_id]': 'ord_1',
      'payment_intent_data[metadata][order_id]': 'ord_1',
      // The stored price, not anything the client sent.
      'line_items[0][price_data][unit_amount]': '4999',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][tax_behavior]': 'exclusive',
      'line_items[0][price_data][product_data][name]': 'Printed book',
      'line_items[0][price_data][product_data][description]': '6 × 9 in premium colour paperback, matte, 200 pages',
      'line_items[0][price_data][product_data][tax_code]': 'txcd_35010000',
      'shipping_address_collection[allowed_countries][0]': 'AU',
      'shipping_options[0][shipping_rate_data][display_name]': 'Australia Post Mail',
      'shipping_options[0][shipping_rate_data][fixed_amount][amount]': '1000',
      'shipping_options[0][shipping_rate_data][metadata][level]': 'MAIL',
      'shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]': '11',
      'shipping_options[0][shipping_rate_data][tax_code]': 'txcd_92010001',
      'shipping_options[1][shipping_rate_data][fixed_amount][amount]': '1750',
      'phone_number_collection[enabled]': 'true',
      'automatic_tax[enabled]': 'false',
      success_url: 'http://localhost:4173/#/order/ord_1',
      cancel_url: 'http://localhost:4173/#/order/ord_1?cancelled=1',
      expires_at: String(Date.parse('2026-10-08T11:00:00Z') / 1000),
    });
    expect(form.get('shipping_address_collection[allowed_countries][1]')).toBeNull();
    expect(form.get('custom_fields[0][key]')).toBeNull();
    // Nothing from the journal goes to Stripe.
    expect(form.toString()).not.toMatch(/summer|title/i);

    expect(await view()).toMatchObject({ state: 'awaiting_payment', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect((await pay()).json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/checkout/sessions')).toHaveLength(1);
    expect(db.events('ord_1').at(-1)).toMatchObject({ from: 'quoted', to: 'awaiting_payment', cause: 'customer:checkout', detail: 'cs_test_1' });
  });

  it('refuses without the check, a destination, the current quote, or one of our websites', async () => {
    const { quote, pay, stripe } = await setup();
    const noQuote = await pay();
    expect([noQuote.statusCode, noQuote.json().error]).toEqual([409, 'Choose where to send the book first.']);
    await quote('AU');
    expect((await pay({ checked: false })).statusCode).toBe(400);
    expect((await pay({ returnUrl: 'https://evil.example/' })).statusCode).toBe(400);
    expect((await pay({ returnUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    const stale = await pay({ quoteVersion: 7 });
    expect([stale.statusCode, stale.json().error]).toEqual([409, 'The price has changed since this page was loaded. Please check it again.']);
    expect(stripe.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('stops offering the proof, and payment, once the print files are deleted', async () => {
    const { quote, pay, view, store, stripe } = await setup();
    await quote('AU');
    expect((await view()).proof).not.toBeNull();
    await store.deletePrefix('orders/ord_1/print/');
    expect((await view()).proof).toBeNull();
    const res = await pay();
    expect([res.statusCode, res.json().error]).toEqual([410, "The print files have been deleted (they're kept for 7 days). Prepare the book again to order it."]);
    expect(stripe.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('won’t take payment for print files more than 6 days old, so a paid book has a day before they go (D71)', async () => {
    const { quote, pay, db, clock, stripe } = await setup();
    db.update('ord_1', { printFiles: { interior: { bytes: 1, sha256: 'a', md5: 'b' }, cover: { bytes: 1, sha256: 'c', md5: 'd' }, at: '2026-10-02T09:00:00.000Z' } });
    await quote('AU');
    const res = await pay();
    expect([res.statusCode, res.json().error]).toEqual([410, "The print files are about to be deleted (they're kept for 7 days). Prepare the book again to order it."]);
    clock.now = new Date('2026-10-08T08:59:00Z');
    db.update('ord_1', { printFiles: { ...db.get('ord_1')!.printFiles!, at: '2026-10-02T09:00:00.000Z' } });
    expect((await pay()).statusCode).toBe(200);
    expect(stripe.calls.filter((c) => c.path === '/v1/checkout/sessions' && c.method === 'POST')).toHaveLength(1);
  });

  it('re-prices a quote older than a day before taking payment', async () => {
    const { quote, pay, view, clock } = await setup();
    await quote('AU');
    clock.now = new Date('2026-10-09T10:30:00Z');
    const res = await pay();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/more than a day old/);
    expect((await view()).quote).toMatchObject({ version: 2, country: 'AU', at: '2026-10-09T10:30:00.000Z' });
    expect((await pay({ quoteVersion: 2 })).statusCode).toBe(200);
  });

  it('asks for the recipient’s tax ID for Brazil, Chile and Mexico (D26)', async () => {
    const { stripe, quote, pay } = await setup();
    await quote('BR');
    await pay();
    const form = stripe.calls.find((c) => c.path === '/v1/checkout/sessions')!.form;
    expect(Object.fromEntries(form)).toMatchObject({
      'custom_fields[0][key]': 'recipienttaxid',
      'custom_fields[0][type]': 'text',
      'custom_fields[0][label][custom]': 'Recipient tax ID (CPF or CNPJ)',
      'shipping_address_collection[allowed_countries][0]': 'BR',
    });
  });

  it('closes the open page before re-quoting, and the next page gets a new idempotency key', async () => {
    const { stripe, quote, pay, view } = await setup();
    await quote('AU');
    await pay();
    const requoted = await quote('US');
    expect(requoted.json()).toMatchObject({ state: 'quoted', quote: { version: 2, country: 'US' }, checkoutUrl: null });
    expect(stripe.sessions.get('cs_test_1')!.status).toBe('expired');
    expect((await pay({ quoteVersion: 2 })).json().url).toMatch(/cs_test_2$/);
    expect(stripe.calls.filter((c) => c.path === '/v1/checkout/sessions').map((c) => c.key)).toEqual(['checkout:ord_1:1:1', 'checkout:ord_1:2:2']);
    expect((await view()).state).toBe('awaiting_payment');
  });

  it('never reuses an idempotency key after a lost answer, since each attempt’s parameters differ', async () => {
    const { stripe, quote, pay, clock } = await setup();
    await quote('AU');
    stripe.faults.lostCreates = 3; // the SDK's two retries are lost too
    const lost = await pay();
    expect([lost.statusCode, lost.json().error]).toEqual([502, "The payment page couldn't be opened. Please try again in a moment."]);
    clock.now = new Date(clock.now.getTime() + 60_000); // a new expires_at: different parameters
    expect((await pay()).statusCode).toBe(200);
    const keys = stripe.calls.filter((c) => c.path === '/v1/checkout/sessions').map((c) => c.key);
    expect(new Set(keys.slice(0, 3))).toEqual(new Set(['checkout:ord_1:1:1']));
    expect(keys.at(-1)).toBe('checkout:ord_1:1:2');
  }, 20_000);

  it('refuses a page showing an older quote without touching the open payment page', async () => {
    const { stripe, quote, pay, view } = await setup();
    await quote('AU');
    await pay();
    const stale = await pay({ quoteVersion: 7 });
    expect(stale.statusCode).toBe(409);
    expect(stripe.sessions.get('cs_test_1')!.status).toBe('open');
    expect(await view()).toMatchObject({ state: 'awaiting_payment', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  });

  it('won’t re-quote once the customer has paid, even if the webhook hasn’t arrived', async () => {
    const { stripe, quote, pay, view } = await setup();
    await quote('AU');
    await pay();
    stripe.pay('cs_test_1');
    const res = await quote('US');
    expect([res.statusCode, res.json().error]).toEqual([409, 'This book has already been paid for.']);
    expect((await view()).state).toBe('paid');
  });
});

describe('Stripe webhooks (M3 slice E)', () => {
  it('marks the order paid from a signed checkout.session.completed, once', async () => {
    const { stripe, quote, pay, hook, view, db } = await setup();
    await quote('AU');
    await pay();
    const session = stripe.pay('cs_test_1', { rate: 1 });
    const event = signed('checkout.session.completed', session);
    const res = await hook(event);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true, outcome: 'paid' });
    expect(await view()).toMatchObject({ state: 'paid', checkoutUrl: null, paid: { amountTotalCents: 6749, amountShippingCents: 1750, shippingLevel: 'EXPRESS', currency: 'usd' } });
    // Fulfilment was queued with the payment (PLAN §1.5 step 7).
    expect(db.jobs('ord_1')).toMatchObject([{ kind: 'fulfil', state: 'queued', attempts: 0 }]);
    expect(db.get('ord_1')!.payment).toMatchObject({
      sessionId: 'cs_test_1',
      paymentIntent: 'pi_cs_test_1',
      email: 'reader@example.com',
      phone: '+61 400 000 000',
      name: 'Sam Reader',
      address: { line1: '1 King William St', city: 'Adelaide', state: 'SA', postalCode: '5000', country: 'AU' },
      recipientTaxId: null,
    });

    // Stripe retries and replays: the same event changes nothing.
    expect((await hook(event)).json()).toEqual({ received: true, outcome: 'duplicate' });
    expect(db.events('ord_1').filter((e) => e.to === 'paid')).toHaveLength(1);
    expect(db.stripeEvents('ord_1')).toMatchObject([{ type: 'checkout.session.completed', outcome: 'paid' }]);
    // A second event for the same payment (e.g. async_payment_succeeded after completed) is harmless too.
    expect((await hook(signed('checkout.session.async_payment_succeeded', session))).json().outcome).toBe('already paid');
  });

  it('refuses anything not signed with our secret, or too old', async () => {
    const { stripe, quote, pay, hook, view, app } = await setup();
    await quote('AU');
    await pay();
    const session = stripe.pay('cs_test_1');
    expect((await hook(signed('checkout.session.completed', session, { secret: 'whsec_someone_else' }))).statusCode).toBe(400);
    expect((await hook(signed('checkout.session.completed', session, { timestamp: Math.floor(Date.now() / 1000) - 600 }))).statusCode).toBe(400);
    const unsigned = await app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ type: 'checkout.session.completed', data: { object: session } }) });
    expect(unsigned.statusCode).toBe(400);
    // Re-serialised JSON no longer matches the signature: the check is on the raw bytes.
    const e = signed('checkout.session.completed', session);
    expect((await app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: e.headers, payload: JSON.stringify(JSON.parse(e.payload), null, 2) })).statusCode).toBe(400);
    expect((await view()).state).toBe('paid'); // …from the return-page sync, not from any of those
  });

  it('returns the order to its quote when the page expires or a delayed payment fails', async () => {
    const { stripe, quote, pay, hook, db } = await setup();
    await quote('AU');
    await pay();
    stripe.sessions.get('cs_test_1')!.status = 'expired';
    expect((await hook(signed('checkout.session.expired', stripe.sessions.get('cs_test_1')))).json().outcome).toBe('expired');
    expect(db.get('ord_1')!.state).toBe('quoted');

    // A bank debit: completed but unpaid, then failed.
    await pay();
    const pending = stripe.pay('cs_test_2', { paymentStatus: 'unpaid' });
    expect((await hook(signed('checkout.session.completed', pending))).json().outcome).toBe('payment pending');
    expect(db.get('ord_1')!.state).toBe('awaiting_payment');
    expect((await hook(signed('checkout.session.async_payment_failed', pending))).json().outcome).toBe('payment failed');
    expect(db.get('ord_1')!.state).toBe('quoted');

    // …or succeeds.
    await pay();
    const later = stripe.pay('cs_test_3', { paymentStatus: 'unpaid' });
    await hook(signed('checkout.session.completed', later));
    later.payment_status = 'paid';
    expect((await hook(signed('checkout.session.async_payment_succeeded', later))).json().outcome).toBe('paid');
    expect(db.events('ord_1').map((e) => e.to)).toEqual(['quoted', 'quoted', 'awaiting_payment', 'quoted', 'awaiting_payment', 'quoted', 'awaiting_payment', 'paid']);
  });

  it('ignores events for an older page, and flags money taken for one', async () => {
    const { stripe, quote, pay, hook, db } = await setup();
    await quote('AU');
    await pay();
    await quote('US');
    await pay({ quoteVersion: 2 });
    // The first page was expired by the re-quote; its expiry event arrives late.
    expect((await hook(signed('checkout.session.expired', stripe.sessions.get('cs_test_1')))).json().outcome).toBe('stale session');
    expect(db.get('ord_1')!.state).toBe('awaiting_payment');
    // Should a payment ever complete on a page the order no longer expects, it's recorded for a refund, not applied.
    const old = stripe.sessions.get('cs_test_1')!;
    Object.assign(old, { status: 'complete', payment_status: 'paid' });
    expect((await hook(signed('checkout.session.completed', old))).json().outcome).toBe('unexpected payment');
    expect(db.get('ord_1')!.state).toBe('awaiting_payment');
    expect((await hook(signed('checkout.session.completed', { id: 'cs_x', metadata: { order_id: 'ord_nope' }, status: 'complete', payment_status: 'paid' }))).json().outcome).toBe('unknown order');
    expect((await hook(signed('invoice.paid', { id: 'in_1' }))).json().outcome).toBe('ignored');
  });

  it('marks the order paid when the customer returns before the webhook (sync, at most every 10 s)', async () => {
    const { stripe, quote, pay, view, db, clock } = await setup();
    await quote('AU');
    await pay();
    expect((await view()).state).toBe('awaiting_payment');
    stripe.pay('cs_test_1');
    expect((await view()).state).toBe('awaiting_payment'); // asked Stripe less than 10 s ago
    clock.now = new Date(clock.now.getTime() + 11_000);
    expect((await view()).state).toBe('paid');
    expect(db.events('ord_1').at(-1)).toMatchObject({ to: 'paid', cause: 'stripe:sync', detail: 'cs_test_1' });
    // The webhook that follows is a no-op.
  });
});

describe('return URLs', () => {
  it('accepts only our websites, and loopback in test mode', () => {
    const deps = { webOrigins: ['https://logbook.example'], allowLoopbackReturn: false };
    expect(returnBase('https://logbook.example/app/?x=1#/book', deps)).toBe('https://logbook.example/app/');
    expect(returnBase('https://logbook.example.evil.com/', deps)).toBeNull();
    expect(returnBase('http://localhost:4173/', deps)).toBeNull();
    expect(returnBase('http://localhost:4173/', { ...deps, allowLoopbackReturn: true })).toBe('http://localhost:4173/');
    expect(returnBase('not a url', deps)).toBeNull();
  });
});

describe('limits', () => {
  it('limits re-quotes and checkouts per order per hour', async () => {
    const { quote } = await setup();
    for (let i = 0; i < 60; i++) expect((await quote('AU')).statusCode).toBe(200);
    expect((await quote('AU')).statusCode).toBe(429);
  });

  it('says so when Stripe can’t be reached while closing an open page', async () => {
    const { stripe, quote, pay } = await setup();
    await quote('AU');
    await pay();
    stripe.sessions.delete('cs_test_1');
    const res = await quote('US');
    expect([res.statusCode, res.json().error]).toEqual([502, 'The payment service did not answer. Please try again in a moment.']);
  });
});
