import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { ConfigError, loadConfig } from '../src/config.ts';
import { CONTENT_FIELDS, loggerOptions } from '../src/log.ts';

describe('config (D18)', () => {
  it('defaults to test mode on localhost without Lulu', () => {
    expect(loadConfig({})).toMatchObject({ mode: 'test', host: '127.0.0.1', port: 4242, lulu: undefined });
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
