import { unzipSync, strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { EstimatedCoverDimensions } from '../src/lulu.ts';
import { Renderer } from '../src/render/renderer.ts';
import { bundleZip, sampleBundle } from './sample-journal.ts';

let renderer: Renderer;
beforeAll(async () => {
  renderer = await Renderer.launch({ executablePath: process.env.CHROMIUM_PATH });
});
afterAll(async () => {
  await renderer?.close();
});

describe('POST /render', () => {
  it('turns a book bundle into interior and cover PDFs with a report', async () => {
    const app = buildApp({ renderer, covers: new EstimatedCoverDimensions(), webOrigins: ['http://localhost:5173'] });
    const res = await app.inject({
      method: 'POST',
      url: '/render',
      headers: { 'content-type': 'application/zip', origin: 'http://localhost:5173' },
      payload: Buffer.from(bundleZip(await sampleBundle({ entries: 6 }))),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const files = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(files).sort()).toEqual(['cover.pdf', 'interior.pdf', 'report.json']);
    expect(strFromU8(files['interior.pdf']!.slice(0, 5))).toBe('%PDF-');
    const report = JSON.parse(strFromU8(files['report.json']!));
    expect(report.podPackageId).toBe('0600X0900.FC.PRE.PB.080CW444.MXX');
    expect(String(report.plan.totalPages)).toBe(res.headers['x-logbook-pages']);
    expect(report.cover).toMatchObject({ source: 'estimate', provisional: false });
  });

  it('explains that hardcovers need Lulu credentials when none are configured', async () => {
    const app = buildApp({ renderer, covers: new EstimatedCoverDimensions(), webOrigins: [] });
    const bundle = await sampleBundle({ entries: 2, book: { product: { trim: '6x9', interior: 'color', binding: 'hardcover', finish: 'matte' } } });
    const res = await app.inject({ method: 'POST', url: '/render', headers: { 'content-type': 'application/zip' }, payload: Buffer.from(bundleZip(bundle)) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/Lulu API credentials/);
  });
});
