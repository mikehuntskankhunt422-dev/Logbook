import { strFromU8, unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { png, writeEntry } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function twoEntries(page: Page) {
  await writeEntry(page, 'Beach day', 'Swam at Glenelg and ate chips on the jetty. ');
  // 64 × 48 pixels: far too small for print, so the builder should name it.
  await page.getByTestId('photo-input').setInputFiles([{ name: 'sunset.png', mimeType: 'image/png', buffer: png([250, 120, 60]) }]);
  await expect(page.getByRole('img', { name: 'sunset.png' })).toBeVisible();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await writeEntry(page, 'Rainy Sunday', 'Read all afternoon while the gutters overflowed.');
}

test('builds a book: paginated preview, cover, print check and format changes', async ({ page }) => {
  test.slow();
  await twoEntries(page);
  await page.goto('/#/book');
  await expect(page.getByRole('heading', { name: 'Make a book' })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Our summer');
  await page.getByLabel('Author (optional)').fill('Sam');
  await expect(page.getByTestId('entry-count')).toContainText('2 of 2 entries in this book');

  // A short paperback is padded to Lulu's 32-page minimum with Notes pages.
  const status = page.getByTestId('preview-status');
  await expect(status).toContainText(/^32 pages, including \d+ blank Notes pages$/, { timeout: 60_000 });
  const book = page.frameLocator('[data-testid="book-frame"]');
  await expect(book.locator('.pagedjs_page')).toHaveCount(32);
  await expect(book.locator('.pagedjs_page').first()).toContainText('Our summer');
  await expect(book.locator('.entry-title', { hasText: 'Beach day' })).toBeVisible();
  // Contents page numbers come from Paged.js target-counter.
  await expect(book.locator('.toc li').first()).toContainText('Beach day');
  await expect(page.frameLocator('[data-testid="cover-frame"]').locator('.front h1')).toHaveText('Our summer');

  await expect(page.getByTestId('print-check')).toContainText('1 thing to look at');
  await expect(page.getByText(/“sunset\.png” in “Beach day” \(.+\) prints at \d+ PPI/)).toBeVisible();

  // Spine text is off below 81 pages (D23).
  await expect(page.getByLabel('Title on the spine')).toBeDisabled();

  // Wide screens show spreads (page 1 alone on the right, then pairs); phones show single pages.
  if (test.info().project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Page 2 of 32')).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Next spread' }).click();
    await expect(page.getByText('Pages 2–3 of 32')).toBeVisible();
  }

  // Hardcover has a 24-page minimum.
  await page.getByRole('group', { name: 'Binding' }).getByRole('button', { name: 'Hardcover' }).click();
  await expect(status).toContainText(/^24 pages/, { timeout: 60_000 });
  await expect(page.getByText('Hardcover wraps are sized by Lulu, so this preview is approximate.')).toBeVisible();

  // Excluding an entry updates the book.
  await page.getByText('Choose individual entries').click();
  await page.getByRole('checkbox', { name: /Rainy Sunday/ }).uncheck();
  await expect(page.getByTestId('entry-count')).toContainText('1 of 2 entries');
  await expect(book.locator('.entry-title', { hasText: 'Rainy Sunday' })).toHaveCount(0, { timeout: 60_000 });
});

test('makes print PDFs through the render server after asking first', async ({ page }) => {
  test.slow();
  await twoEntries(page);
  await page.goto('/#/book');
  await page.getByLabel('Title', { exact: true }).fill('Our summer');
  await expect(page.getByTestId('preview-status')).toContainText(/^32 pages/, { timeout: 60_000 });
  const previewNotes = Number(/including (\d+) blank/.exec((await page.getByTestId('preview-status').textContent()) ?? '')?.[1]);

  await page.getByRole('button', { name: 'Make print PDFs' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send this book to the print server?' });
  await expect(dialog).toContainText('the text, titles, tags and captions of 2 entries');
  await expect(dialog).toContainText('1 photo');
  const downloading = page.waitForEvent('download', { timeout: 120_000 });
  await dialog.getByRole('button', { name: 'Send and make PDFs' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('our-summer-print-files.zip');

  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  expect(Object.keys(files).sort()).toEqual(['cover.pdf', 'interior.pdf', 'report.json']);
  expect(strFromU8(files['interior.pdf']!.slice(0, 5))).toBe('%PDF-');
  const report = JSON.parse(strFromU8(files['report.json']!));
  // The server lays out the same document with the same fonts and Paged.js build: the content
  // fills the same number of pages as in the browser preview.
  expect(report.plan.totalPages).toBe(32);
  expect(report.plan.notesPages).toBe(previewNotes);
  expect(report.warnings).toContainEqual(expect.objectContaining({ kind: 'low-resolution', fileName: 'sunset.png' }));
  await expect(page.getByText('Print files ready: 32 pages.', { exact: false })).toBeVisible();
});
