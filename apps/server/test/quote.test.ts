import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { LuluClient, type ShippingOption } from '../src/lulu/client.ts';
import { pickShipping, Quoter } from '../src/pricing/quote.ts';

const config = loadConfig({ LULU_SANDBOX_CLIENT_KEY: 'k', LULU_SANDBOX_CLIENT_SECRET: 's' });
const PB = '0600X0900.FC.PRE.PB.080CW444.MXX';

/** Sandbox answers from 2026-10-07: 6×9 premium paperback, 200 pages. */
const COST_200 = {
  line_item_costs: [{ cost_excl_discounts: '29.77', quantity: 1, total_cost_excl_tax: '29.77', total_cost_incl_tax: '29.77', unit_tier_cost: '29.77' }],
  shipping_cost: { total_cost_excl_tax: '5.69', total_cost_incl_tax: '5.69' },
  fulfillment_cost: { total_cost_excl_tax: '0.75', total_cost_incl_tax: '0.75' },
  total_tax: '0.00',
  total_cost_excl_tax: '36.21',
  total_cost_incl_tax: '36.21',
  currency: 'USD',
};
const opt = (level: string, cost: number, min: number, max: number, name = level): ShippingOption => ({
  level,
  carrier_service_name: name,
  cost_excl_tax: cost,
  currency: 'USD',
  total_days_min: min,
  total_days_max: max,
  is_active: true,
});
const US = [opt('EXPEDITED', 20.74, 5, 8, 'FedEx 2 Day'), opt('EXPRESS', 35.74, 4, 7, 'FedEx Standard Overnight'), opt('GROUND_HD', 13.74, 8, 11), opt('PRIORITY_MAIL', 14.74, 8, 11), opt('MAIL', 5.69, 10, 13, 'OSM BPM')];
const AU = [opt('MAIL', 8.34, 11, 12, 'Australia Post Mail'), opt('EXPRESS', 15.19, 6, 7, 'Australia Post Express Post Parcel')];

function fakeLulu(shipping: Record<string, ShippingOption[] | 'reject'> = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(config.lulu!.apiUrl, '');
    if (path.endsWith('/token')) return Response.json({ access_token: 't', expires_in: 3600 });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path, body });
    if (path === '/print-job-cost-calculations/') return Response.json(COST_200, { status: 201 });
    if (path === '/shipping-options/') {
      const country = (body['shipping_address'] as { country: string }).country;
      const answer = shipping[country];
      if (!answer || answer === 'reject') return Response.json([{ country_code: 'Must be a valid ISO 3166-1 alpha-2 country code' }], { status: 400 });
      return Response.json(answer);
    }
    return new Response('nope', { status: 404 });
  }) as typeof globalThis.fetch;
  return { lulu: new LuluClient(config.lulu!, { fetch }), calls };
}

describe('shipping choices', () => {
  it('keeps the cheapest, the fastest, and the cheapest that beats the cheapest on time', () => {
    expect(pickShipping(US).map((o) => o.level)).toEqual(['MAIL', 'GROUND_HD', 'EXPRESS']);
  });

  it('keeps everything when there are three or fewer, cheapest first, one per level', () => {
    expect(pickShipping(AU).map((o) => o.level)).toEqual(['MAIL', 'EXPRESS']);
    expect(pickShipping([opt('MAIL', 9, 6, 8), opt('MAIL', 7, 6, 8, 'cheaper mail')]).map((o) => o.carrier_service_name)).toEqual(['cheaper mail']);
    expect(pickShipping([opt('MAIL', 7, 6, 8), { ...opt('EXPRESS', 9, 1, 2), is_active: false }]).map((o) => o.level)).toEqual(['MAIL']);
  });
});

describe('Quoter', () => {
  it('prices the book from Lulu’s live cost plus fulfilment, asked once a day', async () => {
    let now = 0;
    const { lulu, calls } = fakeLulu();
    const quoter = new Quoter(lulu, () => now);
    // $29.77 + $0.75 → $30.52 × 1.35 + $8 = $49.20 → $49.99 (PLAN §7 table)
    expect(await quoter.quote(PB, 200)).toEqual({ podPackageId: PB, pages: 200, currency: 'usd', bookCents: 4999 });
    await quoter.quote(PB, 200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ line_items: [{ pod_package_id: PB, page_count: 200, quantity: 1 }], shipping_option: 'MAIL' });
    now += 25 * 60 * 60 * 1000;
    await quoter.quote(PB, 200);
    expect(calls).toHaveLength(2);
  });

  it('adds up to three shipping choices for a destination, grossed up for Stripe', async () => {
    const { lulu, calls } = fakeLulu({ AU });
    const q = await new Quoter(lulu).quote(PB, 200, { country: 'AU', state: 'SA' });
    expect(q.shipping).toEqual([
      { level: 'MAIL', name: 'Australia Post Mail', daysMin: 11, daysMax: 12, priceCents: 1000 },
      { level: 'EXPRESS', name: 'Australia Post Express Post Parcel', daysMin: 6, daysMax: 7, priceCents: 1750 },
    ]);
    expect(calls.find((c) => c.path === '/shipping-options/')!.body).toEqual({
      line_items: [{ pod_package_id: PB, page_count: 200, quantity: 1 }],
      shipping_address: { country: 'AU', state: 'SA' },
      currency: 'USD',
    });
  });
});

describe('GET /api/quote', () => {
  const get = async (app: ReturnType<typeof buildApp>, query: string) => app.inject({ method: 'GET', url: `/api/quote?${query}` });

  it('answers with the book price and shipping, readable from any origin', async () => {
    const app = buildApp(config, { logger: false, lulu: fakeLulu({ US }).lulu });
    const res = await get(app, `pod_package_id=${PB}&pages=200&country=US`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.json()).toMatchObject({ bookCents: 4999, currency: 'usd', country: 'US', shipping: [{ level: 'MAIL', priceCents: 750 }, { level: 'GROUND_HD' }, { level: 'EXPRESS' }] });
    await app.close();
  });

  it('refuses anything that isn’t a book we sell or a plain country code, without asking Lulu', async () => {
    const { lulu, calls } = fakeLulu();
    const app = buildApp(config, { logger: false, lulu });
    for (const q of [`pod_package_id=${PB}&pages=31`, 'pod_package_id=nope&pages=100', `pod_package_id=${PB}&pages=100&country=usa`, `pod_package_id=${PB}&pages=100&country=US&state=Oregon`]) {
      expect((await get(app, q)).statusCode, q).toBe(400);
    }
    expect(calls).toEqual([]);
    await app.close();
  });

  it('says 422 for a destination Lulu won’t ship to, and 503 without Lulu', async () => {
    const app = buildApp(config, { logger: false, lulu: fakeLulu().lulu });
    expect((await get(app, `pod_package_id=${PB}&pages=100&country=ZZ`)).statusCode).toBe(422);
    await app.close();
    const off = buildApp(loadConfig({}), { logger: false });
    expect((await get(off, `pod_package_id=${PB}&pages=100`)).statusCode).toBe(503);
    await off.close();
  });
});
