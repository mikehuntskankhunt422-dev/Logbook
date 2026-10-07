import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { ConfigError, loadConfig } from '../src/config.ts';
import { LuluClient } from '../src/lulu/client.ts';
import { CONTENT_FIELDS, loggerOptions } from '../src/log.ts';

describe('config (D18)', () => {
  it('defaults to test mode on localhost without Lulu', () => {
    expect(loadConfig({})).toMatchObject({ mode: 'test', host: '127.0.0.1', port: 4242, lulu: undefined, stripe: undefined });
  });

  it('uses the sandbox with sandbox credentials in test mode', () => {
    const c = loadConfig({ LULU_SANDBOX_CLIENT_KEY: 'k', LULU_SANDBOX_CLIENT_SECRET: 's' });
    expect(c.lulu).toEqual({
      apiUrl: 'https://api.sandbox.lulu.com',
      tokenUrl: 'https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token',
      clientKey: 'k',
      clientSecret: 's',
    });
  });

  it('refuses live mode without ALLOW_LIVE, and mixed test/live credentials', () => {
    expect(() => loadConfig({ APP_MODE: 'live' })).toThrow(ConfigError);
    expect(() => loadConfig({ LULU_CLIENT_KEY: 'live' })).toThrow(/never mix/);
    expect(() => loadConfig({ APP_MODE: 'live', ALLOW_LIVE: 'true', LULU_SANDBOX_CLIENT_KEY: 'k' })).toThrow(/never mix/);
    expect(loadConfig({ APP_MODE: 'live', ALLOW_LIVE: 'true', LULU_CLIENT_KEY: 'k', LULU_CLIENT_SECRET: 's' }).lulu?.apiUrl).toBe('https://api.lulu.com');
  });

  it('takes Stripe keys only for the current mode, and only keys of that mode (D18)', () => {
    expect(loadConfig({ STRIPE_TEST_SECRET_KEY: 'sk_test_abc', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_x' }).stripe).toEqual({ secretKey: 'sk_test_abc', webhookSecret: 'whsec_x', taxEnabled: false });
    expect(loadConfig({ STRIPE_TEST_SECRET_KEY: 'rk_test_abc', STRIPE_TAX_ENABLED: 'true' }).stripe).toEqual({ secretKey: 'rk_test_abc', webhookSecret: undefined, taxEnabled: true });
    expect(loadConfig({}).stripe).toBeUndefined();
    // A live key in a test variable, live variables in test mode, and the reverse.
    expect(() => loadConfig({ STRIPE_TEST_SECRET_KEY: 'sk_live_abc' })).toThrow(/must be a test key/);
    expect(() => loadConfig({ STRIPE_LIVE_SECRET_KEY: 'sk_live_abc' })).toThrow(/never mix/);
    const live = { APP_MODE: 'live', ALLOW_LIVE: 'true' };
    expect(() => loadConfig({ ...live, STRIPE_TEST_SECRET_KEY: 'sk_test_abc' })).toThrow(/never mix/);
    expect(() => loadConfig({ ...live, STRIPE_LIVE_SECRET_KEY: 'sk_test_abc' })).toThrow(/must be a live key/);
    expect(loadConfig({ ...live, STRIPE_LIVE_SECRET_KEY: 'sk_live_abc' }).stripe?.secretKey).toBe('sk_live_abc');
    // A webhook secret must look like one, and needs its key.
    expect(() => loadConfig({ STRIPE_TEST_SECRET_KEY: 'sk_test_abc', STRIPE_TEST_WEBHOOK_SECRET: 'sk_test_oops' })).toThrow(/whsec_/);
    expect(() => loadConfig({ STRIPE_TEST_WEBHOOK_SECRET: 'whsec_x' })).toThrow(/without STRIPE_TEST_SECRET_KEY/);
  });

  it('refuses half a credential pair and nonsense values', () => {
    expect(() => loadConfig({ LULU_SANDBOX_CLIENT_KEY: 'k' })).toThrow(/both/);
    expect(() => loadConfig({ APP_MODE: 'prod' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigError);
  });
});

describe('logging never carries journal content (PLAN §6)', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : []));

  it('redacts every content field at any depth', () => {
    const paths = (loggerOptions as { redact: { paths: string[] } }).redact.paths;
    for (const f of CONTENT_FIELDS) expect(paths).toEqual(expect.arrayContaining([f, `*.${f}`, `*.*.${f}`]));
  });

  it('has no log call in src/ that mentions a content field', () => {
    const field = new RegExp(`(\\.|\\b)(${CONTENT_FIELDS.join('|')})\\b\\s*[,:})\\]]?`);
    const offenders: string[] = [];
    for (const file of files(src)) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(/\b(?:log|logger)\s*\.\s*(?:trace|debug|info|warn|error|fatal)\s*\(([^;]*?)\)\s*;/gs)) {
        const args = m[1]!.replace(/(['"`])(?:\\.|(?!\1).)*\1/gs, ''); // string literals are fixed text, not data
        if (field.test(args)) offenders.push(`${file}: ${m[0].slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('API', () => {
  it('answers the health check', async () => {
    const app = buildApp(loadConfig({}), { logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ ok: true, mode: 'test', lulu: false });
    await app.close();
  });
});

describe('GET /api/cover-dimensions (D39)', () => {
  const config = loadConfig({ LULU_SANDBOX_CLIENT_KEY: 'k', LULU_SANDBOX_CLIENT_SECRET: 's' });
  function fakeLulu(answer: () => Response) {
    const asked: unknown[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/token')) return Response.json({ access_token: 't', expires_in: 3600 });
      asked.push(JSON.parse(String(init?.body)));
      return answer();
    }) as typeof globalThis.fetch;
    return { lulu: new LuluClient(config.lulu!, { fetch }), asked };
  }
  const url = (id: string, pages: number | string) => `/api/cover-dimensions?pod_package_id=${id}&pages=${pages}`;
  const PB = '0600X0900.FC.PRE.PB.080CW444.MXX';

  it("answers with Lulu's size, cached, and lets any origin read it", async () => {
    const { lulu, asked } = fakeLulu(() => Response.json({ width: '324.690', height: '234.950', unit: 'mm' }, { status: 201 }));
    const app = buildApp(config, { logger: false, lulu });
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: 'GET', url: url(PB, 210) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ width: 324.69, height: 234.95, unit: 'mm' });
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
    }
    expect(asked).toEqual([{ pod_package_id: PB, interior_page_count: 210, unit: 'mm' }]);
    await app.close();
  });

  it('passes nothing to Lulu but the packages we sell and page counts they can print', async () => {
    const { lulu, asked } = fakeLulu(() => Response.json({ width: '1', height: '1', unit: 'mm' }, { status: 201 }));
    const app = buildApp(config, { logger: false, lulu });
    for (const [id, pages] of [
      ['0600X0900.FC.STD.PB.080CW444.MXX', 100],
      [PB, 30],
      [PB, 101],
      [PB, 802],
      [PB, 'lots'],
      ['0600X0900.FC.PRE.CW.080CW444.MXX', 22],
    ] as const) {
      expect((await app.inject({ method: 'GET', url: url(id, pages) })).statusCode).toBe(400);
    }
    expect(asked).toEqual([]);
    await app.close();
  });

  it('says 503 without Lulu credentials and 502 when Lulu fails', async () => {
    const off = buildApp(loadConfig({}), { logger: false });
    expect((await off.inject({ method: 'GET', url: url(PB, 48) })).statusCode).toBe(503);
    await off.close();
    const { lulu } = fakeLulu(() => new Response('<html>Server Error</html>', { status: 500 }));
    const app = buildApp(config, { logger: false, lulu });
    const res = await app.inject({ method: 'GET', url: url(PB, 48) });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Lulu did not answer.' });
    await app.close();
  });
});
