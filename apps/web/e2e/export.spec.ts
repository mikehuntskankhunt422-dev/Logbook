import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { png, writeEntry } from './helpers.ts';

// Settings → Export (D89): Markdown, plain text and a web page download; PDF lays the entries out
// for print and opens the print window.

async function seed(page: Page) {
  await writeEntry(page, 'Beach day', 'Swam at Glenelg. ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Best day');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' see https://example.com/tide ');
  await page.getByTestId('photo-input').setInputFiles([{ name: 'sunset.png', mimeType: 'image/png', buffer: png([250, 120, 60]) }]);
  await expect(page.getByRole('img', { name: 'sunset.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Mood 😄' }).click();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await writeEntry(page, 'Packing <list>', 'snake_case and [draft] and 2 < 3');
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Export' })).toBeVisible();
}

async function download(page: Page, button: RegExp) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const d = await pending;
  return { name: d.suggestedFilename(), bytes: await readFile((await d.path())!) };
}

const files = (bytes: Buffer) => unzipSync(new Uint8Array(bytes));

test('exports Markdown, plain text and a web page', async ({ page }) => {
  await seed(page);
  const panel = page.getByRole('region', { name: 'Export' });

  // Markdown in one file, with the photo: a zip.
  const md = await download(page, /Download 2 entries/);
  expect(md.name).toMatch(/^Logbook export \d{4}-\d{2}-\d{2} \(md\)\.zip$/);
  const mdFiles = files(md.bytes);
  const mdPath = Object.keys(mdFiles).find((f) => f.endsWith('.md'))!;
  const text = strFromU8(mdFiles[mdPath]!);
  expect(text).toContain('## Beach day');
  expect(text).toContain('Swam at Glenelg. **Best day** see <https://example.com/tide>');
  expect(text).toContain('Mood: 😄');
  expect(text).toContain('![sunset.png](media/sunset.png)');
  expect(text).toContain('## Packing \\<list\\>');
  expect(text).toContain('snake\\_case and \\[draft\\] and 2 \\< 3');
  expect(mdFiles[Object.keys(mdFiles).find((f) => f.endsWith('/media/sunset.png'))!]).toEqual(new Uint8Array(png([250, 120, 60])));

  // A file per entry.
  await panel.getByRole('button', { name: 'A file per entry' }).click();
  const perEntry = files((await download(page, /Download 2 entries/)).bytes);
  expect(Object.keys(perEntry).filter((f) => f.endsWith('.md'))).toHaveLength(2);

  // Plain text: one file, no media.
  await panel.getByRole('button', { name: 'Plain text', exact: true }).click();
  const txt = await download(page, /Download 2 entries/);
  expect(txt.name).toMatch(/^Logbook \d{4}-\d{2}-\d{2}\.txt$/);
  expect(txt.bytes.toString('utf8')).toContain('Swam at Glenelg. Best day see https://example.com/tide');
  expect(txt.bytes.toString('utf8')).toContain('[Photo: sunset.png]');

  // A web page with its picture.
  await panel.getByRole('button', { name: 'Web page' }).click();
  const html = files((await download(page, /Download 2 entries/)).bytes);
  const index = strFromU8(html[Object.keys(html).find((f) => f.endsWith('/index.html'))!]!);
  expect(index).toContain('<strong>Best day</strong>');
  expect(index).toContain('<a href="https://example.com/tide" rel="noopener noreferrer">');
  expect(index).toContain('<img src="media/sunset.png"');
  expect(index).toContain('Packing &lt;list&gt;');

  // Only the photo's year, by date.
  await panel.getByLabel('From', { exact: true }).fill('2000-01-01');
  await panel.getByLabel('To', { exact: true }).fill('2000-12-31');
  await expect(panel.getByText('No entries between those dates.')).toBeVisible();
  await expect(panel.getByRole('button', { name: /Download/ })).toBeDisabled();
});

test('PDF: lays the entries out for print and opens the print window', async ({ page }, info) => {
  await seed(page);
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void (window as unknown as { printed: number }).printed++;
  });
  const panel = page.getByRole('region', { name: 'Export' });
  await panel.getByRole('button', { name: 'PDF' }).click();
  await panel.getByRole('button', { name: /Print or save as PDF/ }).click();
  await expect(page.getByText('2 entries ready to print.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  // On screen nothing changes; on paper only the entries are there, with the photo loaded.
  const layout = page.locator('#lbx-print');
  await expect(layout).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  await expect(layout).toBeVisible();
  await expect(page.locator('.app')).toBeHidden();
  await expect(layout.getByRole('heading', { name: 'Beach day' })).toBeVisible();
  expect(await layout.locator('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
  if (info.project.name === 'desktop-chromium') await page.pdf({ path: info.outputPath('export.pdf'), format: 'A4' });

  // Leaving Settings takes the layout away.
  await page.emulateMedia({ media: 'screen' });
  await page.goto('/#/');
  await expect(layout).toHaveCount(0);
});
