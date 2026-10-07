import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BINDINGS, FINISHES, INTERIORS, TRIMS } from '@logbook/core';
import { sampleBackup } from '../../server/src/samples/backup.ts';
import type { SampleKind } from '../../server/src/samples/generate.ts';
import { SAMPLE_PRODUCTS, type SampleProductId } from '../../server/src/samples/products.ts';

/**
 * Preview parity (M2 §5): the builder's on-device preview of each sample book has the same page
 * count as the server's PDF when both run the same Chromium (D42), and is within two pages in
 * Firefox and WebKit. The server's counts are the goldens recorded by
 * apps/server/test/samples.golden.ts, which renders with Playwright's own Chromium (or
 * LOGBOOK_CHROMIUM_PATH, like the Chromium projects here).
 */
const goldens = JSON.parse(readFileSync(new URL('../../server/test/goldens.json', import.meta.url), 'utf8')) as Record<string, Record<string, number>>;
/** The Chromium Playwright downloads, which the server renders with in CI (playwright-core doesn't export the file). */
const browsersJson = join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'browsers.json');
const bundledChromium = (JSON.parse(readFileSync(browsersJson, 'utf8')) as { browsers: { name: string; browserVersion: string }[] }).browsers.find((b) => b.name === 'chromium')!.browserVersion;
/** Seconds the preview may take, about twice what it took on a 2026 laptop-class container (Chromium 141). */
const BUDGET_S: Record<SampleKind, number> = { '40-page': 15, '200-page': 60 };

const CASES: [SampleKind, SampleProductId][] = [
  ['40-page', '6x9-pb-matte'],
  ['40-page', '8.5x11-cw-gloss'],
  ['200-page', '6x9-pb-matte'],
  ['200-page', '8.5x11-cw-gloss'],
];

test.describe('preview parity with the print server', () => {
  test.skip(({ isMobile }) => isMobile, 'Layout is the same on every viewport; one project is enough.');
  test.describe.configure({ mode: 'serial' });

  for (const [kind, productId] of CASES) {
    test(`${kind} sample as ${productId}`, async ({ page, browser, browserName }) => {
      test.setTimeout(kind === '200-page' ? 420_000 : 150_000);
      const sameEngine = browserName === 'chromium';
      const server = `chromium-${(sameEngine ? browser.version() : bundledChromium).split('.')[0]}`;
      const golden = goldens[server]?.[`${kind}--${productId}`];
      test.skip(golden === undefined, `No server page count recorded for ${server}; run the print goldens with UPDATE_GOLDENS=1.`);
      await page.emulateMedia({ reducedMotion: 'reduce' });

      const { zip, options } = await sampleBackup(kind, productId);
      await page.goto('/#/settings');
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: /Restore from backup/ }).click();
      await (await chooser).setFiles({ name: `${kind}.zip`, mimeType: 'application/zip', buffer: zip });
      await page.getByRole('button', { name: 'Restore', exact: true }).click();
      await expect(page.getByText(/Imported \d+ new/)).toBeVisible({ timeout: 60_000 });

      // The same book options as the server's sample: product, and the words on the title page.
      const product = SAMPLE_PRODUCTS[productId];
      await page.goto('/#/book');
      await page.getByRole('button', { name: 'Size & paper', exact: true }).click();
      await page.getByRole('group', { name: 'Size' }).getByRole('button', { name: TRIMS[product.trim].label }).click();
      await page.getByRole('group', { name: 'Pages' }).getByRole('button', { name: INTERIORS[product.interior].label }).click();
      await page.getByRole('group', { name: 'Binding' }).getByRole('button', { name: BINDINGS[product.binding].label }).click();
      await page.getByRole('group', { name: 'Cover finish' }).getByRole('button', { name: FINISHES[product.finish].label }).click();
      await page.getByRole('button', { name: 'Cover', exact: true }).click();
      await page.getByLabel('Title', { exact: true }).fill(options.title);
      await page.getByLabel('Subtitle', { exact: true }).fill(options.subtitle);
      await page.getByLabel('Author', { exact: true }).fill(options.author);

      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      const started = Date.now();
      await page.getByRole('button', { name: 'Make preview' }).click();
      const ready = page.getByText(/^Preview ready: \d+ pages\.$/);
      await expect(ready).toBeVisible({ timeout: test.info().timeout - 30_000 });
      const seconds = (Date.now() - started) / 1000;
      const pages = Number((await ready.textContent())!.match(/\d+/)![0]);
      const report = `${kind} ${productId}: ${browserName} ${browser.version()} preview ${pages} pages in ${seconds.toFixed(1)} s; server (${server}) ${golden} pages`;
      test.info().annotations.push({ type: 'preview', description: report });
      console.log(report);
      if (sameEngine) expect(pages, 'preview vs server page count, same Chromium').toBe(golden);
      else expect(Math.abs(pages - golden!), `preview vs server page count, ${browserName}`).toBeLessThanOrEqual(2);
      expect(seconds, 'preview time budget (M2 §5)').toBeLessThanOrEqual(BUDGET_S[kind]);
    });
  }
});
