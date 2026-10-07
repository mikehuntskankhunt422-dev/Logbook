import { expect, test } from '@playwright/test';
import { png, writeEntry } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('make a book: choose entries and a product, preview every page and the cover', async ({ page }) => {
  await writeEntry(page, 'Beach day', 'Swam at Glenelg and ate chips on the jetty. ');
  await page.getByTestId('photo-input').setInputFiles([{ name: 'sunset.png', mimeType: 'image/png', buffer: png([250, 120, 60]) }]);
  await expect(page.getByRole('img', { name: 'sunset.png' })).toBeVisible();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await writeEntry(page, 'Ferry day', 'Took the ferry to the island.');

  await page.goto('/#/book');
  await expect(page.getByRole('heading', { name: 'Make a book', level: 1 })).toBeVisible();
  await expect(page.getByText(/^2 entries · 1 picture · 6 × 9 in premium colour paperback, matte/)).toBeVisible();

  // Pick entries by hand: untick one.
  await page.getByRole('button', { name: 'Pick entries' }).click();
  await page.getByRole('checkbox', { name: /Ferry day/ }).uncheck();
  await expect(page.getByText(/^1 entry · 1 picture/)).toBeVisible();
  await page.getByRole('checkbox', { name: /Ferry day/ }).check();

  await page.getByRole('button', { name: 'Size & paper →' }).click();
  await expect(page.getByRole('heading', { name: 'Size & paper', level: 2 })).toBeFocused();
  await page.getByRole('button', { name: 'Hardcover' }).click();
  await expect(page.getByText('Hardcovers have 24–800 pages.')).toBeVisible();

  await page.getByRole('button', { name: 'Cover →' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Our summer');
  await page.getByRole('button', { name: 'Use sunset.png as the cover' }).click();

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Make preview' }).click();
  await expect(page.getByText('Preview ready: 24 pages.')).toBeVisible({ timeout: 60_000 });
  // Two short entries are padded with Notes pages to the hardcover minimum.
  await expect(page.getByText(/Includes \d+ blank Notes pages: Hardcovers need at least 24 pages/)).toBeVisible();

  const book = page.frameLocator('iframe[title="Book preview"]');
  await expect(page.getByText('Page 1 of 24')).toBeVisible();
  await expect(book.locator('.pagedjs_page.lb-show')).toHaveCount(1);
  await expect(book.locator('.pagedjs_page.lb-show').getByText('Our summer')).toBeVisible();
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(page.getByText(/^Pages? 2(–3)? of 24$/)).toBeVisible();
  // Every page shown is scaled to fit inside the viewer.
  const fits = await page.locator('iframe[title="Book preview"]').evaluate((f: HTMLIFrameElement) =>
    [...f.contentDocument!.querySelectorAll('.pagedjs_page.lb-show')].every((p) => {
      const r = p.getBoundingClientRect();
      return r.width > 50 && r.left >= 0 && r.top >= 0 && r.right <= f.clientWidth + 1 && r.bottom <= f.clientHeight + 1;
    }),
  );
  expect(fits).toBe(true);

  // The cover preview shows the title, and the 64 px photo is flagged by name.
  await expect(page.frameLocator('iframe[title="Cover preview"]').getByText('Our summer')).toBeVisible();
  await expect(page.getByRole('heading', { name: /pictures? may print blurry/ })).toBeVisible();
  await expect(page.getByText('sunset.png', { exact: true }).first()).toBeVisible();

  // Changing the book marks the preview out of date.
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.getByRole('button', { name: 'Run entries together' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText("You've changed the book since this preview.")).toBeVisible();

  // The draft survives a reload.
  await page.reload();
  await page.getByRole('button', { name: 'Cover', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Our summer');
});

test("the cover preview uses the printer's exact size when the API answers", async ({ page }) => {
  let asked = '';
  await page.route('**/api/cover-dimensions?*', (route) => {
    asked = new URL(route.request().url()).search;
    // Lulu's 6×9 paperback at 32 pages.
    return route.fulfill({ json: { width: 314.5, height: 234.95, unit: 'mm' } });
  });
  await writeEntry(page, 'Exact cover', 'Words for the cover test.');
  await page.goto('/#/book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Make preview' }).click();
  await expect(page.getByText('Preview ready: 32 pages.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Back, spine and front, at the printer's exact size for this page count.")).toBeVisible();
  expect(asked).toBe('?pod_package_id=0600X0900.FC.PRE.PB.080CW444.MXX&pages=32');
  const width = await page.frameLocator('iframe[title="Cover preview"]').locator('body').evaluate((b) => getComputedStyle(b).width);
  expect(Number.parseFloat(width)).toBeCloseTo((314.5 / 25.4) * 96, 0);
});

test('the preview works offline', async ({ page, context }) => {
  await writeEntry(page, 'Offline book', 'Written before the network went away.');
  await page.goto('/#/book');
  await expect(page.getByRole('heading', { name: 'Make a book', level: 1 })).toBeVisible();
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active !== null);
  await page.reload();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Make preview' }).click();
  await expect(page.getByText('Preview ready: 32 pages.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('The spine width is approximate until the print file is made.')).toBeAttached();
  await context.setOffline(false);
});

test.describe('when page layout fails', () => {
  // The service worker would serve the real script from its cache, bypassing page.route.
  test.use({ serviceWorkers: 'block' });

  test('the preview says so instead of hanging', async ({ page }) => {
    await page.route('**/paged.polyfill*', (route) => route.fulfill({ body: 'throw new Error("layout engine broke")', contentType: 'text/javascript' }));
    await writeEntry(page, 'Broken layout', 'Words.');
    await page.goto('/#/book');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByRole('button', { name: 'Make preview' }).click();
    await expect(page.getByText(/The preview failed: Page layout stopped: .*layout engine broke/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Make preview' })).toBeEnabled();
  });
});
