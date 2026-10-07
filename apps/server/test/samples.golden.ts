import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { BLEED_IN, TRIMS, estimateCoverDimensions, pageLimits, SPINE_TEXT_MIN_PAGES } from '@logbook/core';
import { closeBrowser } from '../src/render/browser.ts';
import { buildSampleBook, SAMPLE_PRODUCTS, type SampleProductId } from '../src/samples/build.ts';
import type { SampleKind } from '../src/samples/generate.ts';

/**
 * Golden PDF checks (M2 §5). Renders the sample books and checks what Lulu's preflight checks:
 * page boxes, an even page count within limits, embedded non-Type 3 fonts, and no transparency or
 * annotations. Exact page counts are compared per Chromium major version, because layout can shift
 * between engine versions; run with UPDATE_GOLDENS=1 to record them for a new version.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const goldensPath = fileURLToPath(new URL('./goldens.json', import.meta.url));
const goldens = JSON.parse(readFileSync(goldensPath, 'utf8')) as Record<string, Record<string, number>>;

const CASES: [SampleKind, SampleProductId][] = [
  ['40-page', '6x9-pb-matte'],
  ['40-page', '8.5x11-cw-gloss'],
  ['40-page', '6x9-bw-pb-matte'],
  ['200-page', '6x9-pb-matte'],
];

const pt = (inches: number) => (inches * 72).toFixed(2);

afterAll(async () => {
  await closeBrowser();
  if (process.env['UPDATE_GOLDENS']) writeFileSync(goldensPath, `${JSON.stringify(goldens, null, 2)}\n`);
});

describe.each(CASES)('%s sample as %s', (kind, productId) => {
  it('renders print files Lulu can accept', async () => {
    const product = SAMPLE_PRODUCTS[productId];
    const b = await buildSampleBook(kind, productId, join(root, 'samples', 'out', `${kind}--${productId}`));
    const { plan } = b.interior;
    const trim = TRIMS[product.trim];
    const limits = pageLimits(product);

    // Page count: even, within limits, and what the planner promised.
    expect(plan.pages % 2).toBe(0);
    expect(plan.pages).toBeGreaterThanOrEqual(limits.min);
    expect(plan.pages).toBeLessThanOrEqual(limits.max);
    expect(b.interiorReport.pages).toBe(plan.pages);

    // Page boxes: trim + bleed everywhere; the trim box marks the cut.
    expect(b.interiorReport.mediaBoxes).toEqual([`${pt(trim.widthIn + 2 * BLEED_IN)}x${pt(trim.heightIn + 2 * BLEED_IN)}`]);
    expect(b.interiorReport.trimBoxes).toEqual([`${pt(trim.widthIn)}x${pt(trim.heightIn)}`]);

    // Fonts embedded, never Type 3 (D35, D36); no transparency (D37); no links (D38).
    for (const report of [b.interiorReport, b.coverReport]) {
      expect(report.fonts.length).toBeGreaterThan(0);
      expect(report.fonts.filter((f) => !f.embedded || f.subtype === 'Type3')).toEqual([]);
      expect(report.softMasks).toBe(0);
      expect(report.alphaStates).toBe(0);
      expect(report.annotations).toBe(0);
    }

    // The render browser asked for nothing but our own files (D41).
    expect(b.interior.blocked).toEqual([]);
    expect(b.cover.blocked).toEqual([]);

    // Cover: one page at exactly the requested size; spine text only above 80 pages (D23).
    const dims = estimateCoverDimensions(product, plan.pages);
    expect(b.coverReport.pages).toBe(1);
    expect(b.coverReport.mediaBoxes).toEqual([`${pt(dims.width)}x${pt(dims.height)}`]);
    expect(b.cover.layout.spineText).toBe(plan.pages >= SPINE_TEXT_MIN_PAGES);

    // The deliberately low-resolution photo is reported by file name.
    expect(b.warnings.map((w) => w.name)).toContain('old-phone-photo.jpg');

    const engine = `chromium-${b.interior.chromium.split('.')[0]}`;
    const key = `${kind}--${productId}`;
    if (process.env['UPDATE_GOLDENS']) (goldens[engine] ??= {})[key] = plan.pages;
    else if (goldens[engine]?.[key] !== undefined) expect(plan.pages, `golden page count for ${engine}`).toBe(goldens[engine][key]);
    else console.warn(`No golden page count for ${key} on ${engine}: got ${plan.pages}. Record it with UPDATE_GOLDENS=1.`);
  });
});
