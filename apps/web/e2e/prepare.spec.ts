import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { png, writeEntry } from './helpers.ts';

/** Set by hand to run against the real bucket and the Lulu sandbox (see playwright.config.ts). */
const online = Boolean(process.env.LOGBOOK_E2E_ONLINE);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.skip(({ isMobile }) => isMobile, 'The server render is the same for every viewport; one project is enough.');

/** One entry with a picture, a current 32-page preview, and every non-GET request recorded from here on. */
async function bookWithPreview(page: Page): Promise<string[]> {
  await writeEntry(page, 'Print me', 'Words for the print test.');
  await page.getByTestId('photo-input').setInputFiles([{ name: 'sunset.png', mimeType: 'image/png', buffer: png([250, 120, 60]) }]);
  await expect(page.getByRole('img', { name: 'sunset.png' })).toBeVisible();
  await expect(page.getByText('Saved on this device')).toBeVisible();

  await page.goto('/#/book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Make preview' }).click();
  await expect(page.getByText('Preview ready: 32 pages.')).toBeVisible({ timeout: 60_000 });

  const sent: string[] = [];
  page.on('request', (r) => r.method() !== 'GET' && r.method() !== 'OPTIONS' && sent.push(`${r.method()} ${new URL(r.url()).host}${new URL(r.url()).pathname}`));
  return sent;
}

async function expectPdfLinks(page: Page): Promise<void> {
  for (const name of ['Open the pages (PDF)', 'Open the cover (PDF)']) {
    const res = await page.request.get((await page.getByRole('link', { name }).getAttribute('href'))!);
    expect(res.headers()['content-type'], name).toBe('application/pdf');
    expect((await res.body()).subarray(0, 5).toString(), name).toBe('%PDF-');
  }
}

test('prepare my book: consent first, then upload, then the print files', async ({ page }) => {
  test.skip(online, 'Expects local storage; the online run is the next test.');
  test.slow();
  const sent = await bookWithPreview(page);

  // Nothing leaves the device until the dialog is confirmed, and it says exactly what will.
  await page.getByRole('button', { name: 'Prepare my book…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send your book to be printed?' });
  await expect(dialog).toContainText('1 entry');
  await expect(dialog).toContainText('1 picture, reduced to print size first');
  await expect(dialog).toContainText('deleted within 7 days');
  const axe = await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([]);

  await page.getByRole('button', { name: 'Prepare my book…' }).click();
  await dialog.getByRole('button', { name: 'Send and prepare' }).click();
  await expect(page.getByText('Your print files are ready: 32 pages.')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Not checked by the printer yet \(no Lulu credentials\)/)).toBeVisible();
  // The manifest went to the API; the files went to (local) storage; then the submit.
  const api = sent.map((s) => s.replace(/^(\w+) [^/]+/, '$1 '));
  expect(api[0]).toBe('POST /api/orders');
  expect(api.filter((u) => u.startsWith('PUT /api/local-storage/orders/'))).toHaveLength(2);
  expect(api.at(-1)).toMatch(/^POST \/api\/orders\/ord_[\w-]+\/submit$/);
  await expectPdfLinks(page);
});

test('prepare my book online: files go to the bucket and the Lulu sandbox accepts the print files', async ({ page }) => {
  test.skip(!online, 'Set LOGBOOK_E2E_ONLINE=1 with S3_* (or R2_*) and LULU_SANDBOX_* to run against real services.');
  // Lulu's validators usually answer within minutes; the API waits up to 20.
  test.setTimeout(25 * 60_000);
  const sent = await bookWithPreview(page);

  await page.getByRole('button', { name: 'Prepare my book…' }).click();
  await page.getByRole('dialog', { name: 'Send your book to be printed?' }).getByRole('button', { name: 'Send and prepare' }).click();
  await expect(page.getByText('Your print files are ready: 32 pages.')).toBeVisible({ timeout: 22 * 60_000 });
  await expect(page.getByText('The printer has checked both files and accepted them.')).toBeVisible();
  await expect(page.getByText(/The book costs \$\d+\.\d\d plus shipping and any tax\./)).toBeVisible();

  // The manifest and submit went to the API; both files went straight from the browser to the bucket.
  const bucket = new URL(`https://${(process.env.S3_ENDPOINT ?? `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/^https:\/\//, '')}`).host;
  expect(sent[0]).toMatch(/^POST localhost:4173\/api\/orders$/);
  expect(sent.filter((s) => s.startsWith(`PUT ${bucket}/`) && s.includes('/orders/'))).toHaveLength(2);
  expect(sent.filter((s) => s.includes('/api/local-storage/'))).toEqual([]);
  expect(sent.at(-1)).toMatch(/^POST localhost:4173\/api\/orders\/ord_[\w-]+\/submit$/);
  for (const name of ['Open the pages (PDF)', 'Open the cover (PDF)']) expect(new URL((await page.getByRole('link', { name }).getAttribute('href'))!).host).toBe(bucket);
  await expectPdfLinks(page);
});
