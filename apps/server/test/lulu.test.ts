import { describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCT } from '@logbook/core';
import { CoverDimensionsUnavailable, EstimatedCoverDimensions, LuluClient, LuluCoverDimensions } from '../src/lulu.ts';

function fakeLulu(cover: unknown = { width: '920.000', height: '666.000', unit: 'pt' }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/token')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    return Response.json(cover);
  }) as unknown as typeof globalThis.fetch;
  return { calls, client: new LuluClient({ baseUrl: 'https://api.sandbox.lulu.com/', clientKey: 'key', clientSecret: 'secret', fetch }) };
}

describe('Lulu cover dimensions', () => {
  it('authenticates with client credentials, asks in points and converts to inches', async () => {
    const { calls, client } = fakeLulu();
    const d = await new LuluCoverDimensions(client).get(DEFAULT_PRODUCT, 210);
    expect(d).toEqual({ widthIn: 920 / 72, heightIn: 666 / 72, source: 'lulu' });

    const [token, cover] = calls;
    expect(token!.url).toBe('https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token');
    expect((token!.init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa('key:secret')}`);
    expect(token!.init.body).toBe('grant_type=client_credentials');
    expect(cover!.url).toBe('https://api.sandbox.lulu.com/cover-dimensions/');
    expect((cover!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(cover!.init.body as string)).toEqual({ pod_package_id: '0600X0900.FC.PRE.PB.080CW444.MXX', interior_page_count: 210, unit: 'pt' });
  });

  it('reuses the token and caches dimensions per package and page count', async () => {
    const { calls, client } = fakeLulu();
    const source = new LuluCoverDimensions(client);
    await source.get(DEFAULT_PRODUCT, 100);
    await source.get(DEFAULT_PRODUCT, 100);
    await source.get(DEFAULT_PRODUCT, 102);
    expect(calls.map((c) => c.url.split('/').at(-2))).toEqual(['openid-connect', 'cover-dimensions', 'cover-dimensions']);
  });

  it('rejects a response it does not understand', async () => {
    const { client } = fakeLulu({ width: 12, height: 9, unit: 'inch' });
    await expect(client.coverDimensions('x', 100)).rejects.toThrow(/Unexpected/);
  });

  it('estimates paperbacks offline and refuses hardcovers', async () => {
    const est = new EstimatedCoverDimensions();
    expect((await est.get(DEFAULT_PRODUCT, 210)).source).toBe('estimate');
    await expect(est.get({ ...DEFAULT_PRODUCT, binding: 'hardcover' }, 210)).rejects.toBeInstanceOf(CoverDimensionsUnavailable);
  });
});
