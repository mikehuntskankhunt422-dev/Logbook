import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { EstimatedCoverDimensions } from '../src/lulu.ts';
import type { Renderer } from '../src/render/renderer.ts';

/** These requests never reach Chromium, so a stand-in renderer that fails loudly is enough. */
const noRenderer = new Proxy({}, { get: () => () => Promise.reject(new Error('renderer should not be called')) }) as unknown as Renderer;
const app = () => buildApp({ renderer: noRenderer, covers: new EstimatedCoverDimensions(), webOrigins: ['http://localhost:5173'] });
const zip = (manifest: unknown) => Buffer.from(zipSync({ 'book.json': strToU8(JSON.stringify(manifest)) }));

describe('HTTP API', () => {
  it('reports health and the cover-dimension source', async () => {
    const res = await app().inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ ok: true, coverDimensions: 'estimate' });
  });

  it('answers CORS preflight for the web app only', async () => {
    const ok = await app().inject({ method: 'OPTIONS', url: '/render', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await app().inject({ method: 'OPTIONS', url: '/render', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('wants a zip', async () => {
    const res = await app().inject({ method: 'POST', url: '/render', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(res.statusCode).toBe(415);
  });

  it('rejects a malformed bundle with 400', async () => {
    const junk = await app().inject({ method: 'POST', url: '/render', headers: { 'content-type': 'application/zip' }, payload: Buffer.from('not a zip') });
    expect(junk.statusCode).toBe(400);
    const bad = await app().inject({ method: 'POST', url: '/render', headers: { 'content-type': 'application/zip' }, payload: zip({ format: 'nope' }) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/book\.json is invalid/);
  });

  it('refuses an empty book with 422', async () => {
    const res = await app().inject({ method: 'POST', url: '/render', headers: { 'content-type': 'application/zip' }, payload: zip({ format: 'logbook-book', version: 1, options: { title: 'Empty' }, entries: [], media: [] }) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('This book has no entries');
  });
});
