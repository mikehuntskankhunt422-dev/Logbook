import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { png, writeEntry } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.skip(({ isMobile }) => isMobile, 'The server render is the same for every viewport; one project is enough.');

test('prepare my book: consent first, then upload, then the print files', async ({ page }) => {
  test.slow();
  await writeEntry(page, 'Print me', 'Words for the print test.');
  await page.getByTestId('photo-input').setInputFiles([{ name: 'sunset.png', mimeType: 'image/png', buffer: png([250, 120, 60]) }]);
  await expect(page.getByRole('img', { name: 'sunset.png' })).toBeVisible();
  await expect(page.getByText('Saved on this device')).toBeVisible();

  await page.goto('/#/book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Make preview' }).click();
  await expect(page.getByText('Preview ready: 32 pages.')).toBeVisible({ timeout: 60_000 });

  // Nothing leaves the device until the dialog is confirmed, and it says exactly what will.
  const uploads: string[] = [];
  page.on('request', (r) => r.method() !== 'GET' && r.url().includes('/api/') && uploads.push(`${r.method()} ${new URL(r.url()).pathname}`));
  await page.getByRole('button', { name: 'Prepare my book…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send your book to be printed?' });
  await expect(dialog).toContainText('1 entry');
  await expect(dialog).toContainText('1 picture, reduced to print size first');
  await expect(dialog).toContainText('deleted within 7 days');
  const axe = await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
  expect(uploads).toEqual([]);

  await page.getByRole('button', { name: 'Prepare my book…' }).click();
  await dialog.getByRole('button', { name: 'Send and prepare' }).click();
  await expect(page.getByText('Your print files are ready: 32 pages.')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Not checked by the printer yet \(no Lulu credentials\)/)).toBeVisible();
  // The manifest went to the API; the files went to (local) storage; then the submit.
  expect(uploads[0]).toBe('POST /api/orders');
  expect(uploads.filter((u) => u.startsWith('PUT /api/local-storage/orders/'))).toHaveLength(2);
  expect(uploads.at(-1)).toMatch(/^POST \/api\/orders\/ord_[\w-]+\/submit$/);

  for (const name of ['Open the pages (PDF)', 'Open the cover (PDF)']) {
    const res = await page.request.get((await page.getByRole('link', { name }).getAttribute('href'))!);
    expect(res.headers()['content-type'], name).toBe('application/pdf');
    expect((await res.body()).subarray(0, 5).toString(), name).toBe('%PDF-');
  }
});
