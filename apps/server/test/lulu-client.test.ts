import { describe, expect, it } from 'vitest';
import { LuluClient, LuluError } from '../src/lulu/client.ts';

const creds = { apiUrl: 'https://lulu.test', tokenUrl: 'https://lulu.test/auth/token', clientKey: 'key', clientSecret: 'secret' };

interface Call {
  url: string;
  method: string;
  auth: string;
  body: unknown;
}

/** A scripted Lulu: `routes` answers by "METHOD path"; tokens are numbered so tests can see renewals. */
function fakeLulu(routes: Record<string, (call: Call) => [number, unknown] | [number, unknown, string]>, opts: { expiresIn?: number } = {}) {
  const calls: Call[] = [];
  let tokens = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const raw = init?.body ? String(init.body) : undefined;
    const call: Call = { url, method: init?.method ?? 'GET', auth: headers.get('authorization') ?? '', body: raw?.startsWith('{') ? JSON.parse(raw) : raw };
    calls.push(call);
    if (url === creds.tokenUrl) return Response.json({ access_token: `tok-${++tokens}`, expires_in: opts.expiresIn ?? 3600, token_type: 'Bearer' });
    const route = routes[`${call.method} ${url.replace(creds.apiUrl, '')}`];
    if (!route) return new Response('not found', { status: 404 });
    const [status, body, type] = route(call);
    return typeof body === 'string' ? new Response(body, { status, headers: { 'content-type': type ?? 'text/plain' } }) : Response.json(body, { status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('Lulu client', () => {
  it('gets a client-credentials token with Basic auth and reuses it until shortly before expiry', async () => {
    let now = 0;
    const lulu = fakeLulu({ 'POST /cover-dimensions/': () => [201, { width: '324.690', height: '234.950', unit: 'mm' }] });
    const client = new LuluClient(creds, { fetch: lulu.fetch, now: () => now });

    await client.coverDimensions('A', 210);
    await client.coverDimensions('B', 210);
    const tokenCalls = lulu.calls.filter((c) => c.url === creds.tokenUrl);
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.auth).toBe(`Basic ${Buffer.from('key:secret').toString('base64')}`);
    expect(tokenCalls[0]!.body).toBe('grant_type=client_credentials');
    expect(lulu.calls.at(-1)!.auth).toBe('Bearer tok-1');

    now = 3600_000 - 59_000; // inside the renewal margin
    await client.coverDimensions('C', 210);
    expect(lulu.calls.at(-1)!.auth).toBe('Bearer tok-2');
  });

  it('asks for cover sizes in millimetres, parses Lulu’s string numbers and caches per package and page count', async () => {
    const lulu = fakeLulu({ 'POST /cover-dimensions/': () => [201, { width: '324.690', height: '234.950', unit: 'mm' }] });
    const client = new LuluClient(creds, { fetch: lulu.fetch });
    const [a, b] = await Promise.all([client.coverDimensions('0600X0900.FC.PRE.PB.080CW444.MXX', 210), client.coverDimensions('0600X0900.FC.PRE.PB.080CW444.MXX', 210)]);
    expect(a).toEqual({ width: 324.69, height: 234.95, unit: 'mm' });
    expect(b).toBe(a);
    const dimCalls = lulu.calls.filter((c) => c.url.endsWith('/cover-dimensions/'));
    expect(dimCalls).toHaveLength(1);
    expect(dimCalls[0]!.body).toEqual({ pod_package_id: '0600X0900.FC.PRE.PB.080CW444.MXX', interior_page_count: 210, unit: 'mm' });
  });

  it('retries once with a fresh token after a 401', async () => {
    let first = true;
    const lulu = fakeLulu({
      'GET /validate-cover/7/': () => {
        if (first) {
          first = false;
          return [401, { detail: 'expired' }];
        }
        return [200, { id: 7, status: 'NORMALIZED', errors: null }];
      },
    });
    const client = new LuluClient(creds, { fetch: lulu.fetch });
    expect(await client.getCoverValidation(7)).toEqual({ id: 7, status: 'NORMALIZED', errors: null });
    expect(lulu.calls.filter((c) => c.url === creds.tokenUrl)).toHaveLength(2);
  });

  it('turns Lulu errors into LuluError with the API’s message, and HTML error pages into a short note', async () => {
    const lulu = fakeLulu({
      'POST /print-job-cost-calculations/': () => [400, { line_items: { 0: { pod_package_id: ['Pod Package does not exist'] } } }],
      'POST /cover-dimensions/': () => [500, '<!doctype html><html><h1>Server Error (500)</h1></html>', 'text/html'],
    });
    const client = new LuluClient(creds, { fetch: lulu.fetch });
    const cost = client.costCalculation({
      lineItems: [{ podPackageId: 'X', pageCount: 100, quantity: 1 }],
      shippingAddress: { street1: '1 Main St', city: 'Portland', countryCode: 'US', stateCode: 'OR', postcode: '97201', phoneNumber: '+1 503 555 0100' },
      shippingOption: 'MAIL',
    });
    await expect(cost).rejects.toThrow(/HTTP 400.*Pod Package does not exist/);
    await expect(cost).rejects.toBeInstanceOf(LuluError);
    await expect(client.coverDimensions('X', 10)).rejects.toThrow(/HTTP 500.*HTML error page/);
    // A failed size lookup is not cached.
    await expect(client.coverDimensions('X', 10)).rejects.toThrow(/HTTP 500/);
    expect(lulu.calls.filter((c) => c.url.endsWith('/cover-dimensions/'))).toHaveLength(2);
  });

  it('never puts the token response into an error', async () => {
    const fetch = (async () => new Response(JSON.stringify({ error: 'invalid_client', access_token: 'leak' }), { status: 401 })) as typeof globalThis.fetch;
    const client = new LuluClient(creds, { fetch });
    const err = await client.getCoverValidation(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LuluError);
    expect(JSON.stringify(err) + String(err)).not.toMatch(/leak|secret/);
  });

  it('polls a validation until it leaves the queued and in-progress states', async () => {
    const states = [null, 'NORMALIZING', 'NORMALIZED'] as const;
    let i = 0;
    const lulu = fakeLulu({
      'POST /validate-interior/': (c) => [201, { id: 42, source_url: (c.body as { source_url: string }).source_url, status: states[i++], page_count: null, errors: null, valid_pod_package_ids: null }],
      'GET /validate-interior/42/': () => [200, { id: 42, status: states[i++], page_count: 48, errors: null, valid_pod_package_ids: null }],
    });
    const sleeps: number[] = [];
    const client = new LuluClient(creds, { fetch: lulu.fetch, sleep: async (ms) => void sleeps.push(ms) });
    const first = await client.validateInterior('https://files.test/interior.pdf', '0600X0900.FC.PRE.PB.080CW444.MXX');
    expect(lulu.calls.find((c) => c.url.endsWith('/validate-interior/'))!.body).toEqual({ source_url: 'https://files.test/interior.pdf', pod_package_id: '0600X0900.FC.PRE.PB.080CW444.MXX' });
    const done = await client.waitForValidation(first, (id) => client.getInteriorValidation(id), { intervalMs: 1000 });
    expect(done).toMatchObject({ id: 42, status: 'NORMALIZED', page_count: 48 });
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('waits through the VALIDATING state the sandbox sends covers through', async () => {
    const states = ['VALIDATING', 'NORMALIZED'];
    const lulu = fakeLulu({ 'GET /validate-cover/9/': () => [200, { id: 9, source_url: 'x', status: states.shift(), errors: null }] });
    const client = new LuluClient(creds, { fetch: lulu.fetch, sleep: async () => {} });
    const done = await client.waitForValidation({ id: 9, status: null, errors: null }, (id) => client.getCoverValidation(id));
    expect(done.status).toBe('NORMALIZED');
  });

  it('gives up polling after the timeout', async () => {
    let now = 0;
    const lulu = fakeLulu({ 'GET /validate-cover/5/': () => [200, { id: 5, status: 'NORMALIZING', errors: null }] });
    const client = new LuluClient(creds, {
      fetch: lulu.fetch,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    await expect(client.waitForValidation({ id: 5, status: 'NORMALIZING', errors: null }, (id) => client.getCoverValidation(id), { intervalMs: 1000, timeoutMs: 3000 })).rejects.toThrow(
      /still NORMALIZING/,
    );
  });

  it('parses a cost calculation', async () => {
    const lulu = fakeLulu({
      'POST /print-job-cost-calculations/': () => [
        201,
        {
          line_item_costs: [{ cost_excl_discounts: '15.88', total_tax: '0.00', tax_rate: '0.000000', quantity: 1, total_cost_excl_tax: '15.88', total_cost_excl_discounts: '15.88', total_cost_incl_tax: '15.88', discounts: [], unit_tier_cost: '15.88' }],
          shipping_cost: { total_cost_excl_tax: '5.69', total_cost_incl_tax: '5.69', total_tax: '0.00', tax_rate: '0.00' },
          fulfillment_cost: { total_cost_excl_tax: '0.75', total_cost_incl_tax: '0.75', total_tax: '0.00', tax_rate: '0.00' },
          total_tax: '0.00',
          total_cost_excl_tax: '22.32',
          total_cost_incl_tax: '22.32',
          total_discount_amount: '0.00',
          currency: 'USD',
        },
      ],
    });
    const client = new LuluClient(creds, { fetch: lulu.fetch });
    const cost = await client.costCalculation({
      lineItems: [{ podPackageId: '0600X0900.FC.PRE.PB.080CW444.MXX', pageCount: 100, quantity: 1 }],
      shippingAddress: { street1: '1 Main St', city: 'Portland', countryCode: 'US', stateCode: 'OR', postcode: '97201', phoneNumber: '+1 503 555 0100' },
      shippingOption: 'MAIL',
    });
    expect(cost).toMatchObject({ total_cost_incl_tax: 22.32, shipping_cost: { total_cost_excl_tax: 5.69 }, fulfillment_cost: { total_cost_excl_tax: 0.75 }, currency: 'USD' });
    expect(cost.line_item_costs[0]!.total_cost_excl_tax).toBe(15.88);
    expect(lulu.calls.at(-1)!.body).toMatchObject({
      line_items: [{ pod_package_id: '0600X0900.FC.PRE.PB.080CW444.MXX', page_count: 100, quantity: 1 }],
      shipping_address: { country_code: 'US', state_code: 'OR', phone_number: '+1 503 555 0100' },
      shipping_option: 'MAIL',
    });
  });
});

describe('recorded Lulu cover sizes', () => {
  it("agree with the builder's offline estimate to within 0.01 mm, both bindings", async () => {
    const { readFileSync } = await import('node:fs');
    const { allProducts, estimateCoverDimensions, podPackageId } = await import('@logbook/core');
    const { RECORDED_COVER_DIMENSIONS_PATH } = await import('../src/samples/cover-dims.ts');
    const recorded = JSON.parse(readFileSync(RECORDED_COVER_DIMENSIONS_PATH, 'utf8')) as { sizes: Record<string, [number, number]> };
    const byId = new Map(allProducts().map((p) => [podPackageId(p), p]));
    const keys = Object.keys(recorded.sizes);
    expect(keys.length).toBeGreaterThan(100);
    for (const key of keys) {
      const [id, pages] = key.split('@') as [string, string];
      const est = estimateCoverDimensions(byId.get(id)!, Number(pages));
      const [w, h] = recorded.sizes[key]!;
      // Lulu reports mm to two decimals.
      expect(Math.abs(est.width * 25.4 - w), key).toBeLessThanOrEqual(0.0051);
      expect(Math.abs(est.height * 25.4 - h), key).toBeLessThanOrEqual(0.0051);
    }
  });
});
