import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { writeEntry } from './helpers.ts';

// Fonts of your own (D107), using the open-licence Caveat files Logbook already bundles.

const caveat = (file: string) => readFile(new URL(`../../../node_modules/@fontsource/caveat/files/${file}`, import.meta.url));

/** The page's own fonts of a family that have loaded, as "weight style". */
const loaded = (page: Page, family: string) =>
  page.evaluate((f) => [...document.fonts].filter((face) => face.family.replace(/"/g, '') === f && face.status === 'loaded').map((face) => `${face.weight} ${face.style}`).sort(), family);

test('fonts of your own: added in Settings, written in, kept, removed (D107)', async ({ page }) => {
  await writeEntry(page, 'By hand', 'Written by hand');
  await page.goto('/#/settings');
  const appearance = page.getByRole('region', { name: 'Appearance' });
  const input = appearance.getByTestId('font-input');

  // A file that isn't a font can't be used, so it isn't kept.
  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('notes.txt isn’t a font Logbook can use')).toBeVisible();

  // A family's regular and bold files; WOFF2 doesn't say its name, so the file names do.
  await input.setInputFiles([
    { name: 'Handy-Regular.woff2', mimeType: 'font/woff2', buffer: await caveat('caveat-latin-400-normal.woff2') },
    { name: 'Handy-Bold.woff2', mimeType: 'font/woff2', buffer: await caveat('caveat-latin-700-normal.woff2') },
  ]);
  const list = appearance.getByRole('list', { name: 'Your fonts' });
  await expect(list.getByRole('listitem').filter({ hasText: 'Handy' })).toContainText('Regular, Bold');
  await expect.poll(() => loaded(page, 'Handy')).toEqual(['400 normal', '700 normal']);
  // A WOFF file says what it's called; one of Logbook's own names stays Logbook's.
  await input.setInputFiles({ name: 'whatever.woff', mimeType: '', buffer: await caveat('caveat-latin-400-normal.woff') });
  await expect(list.getByText('My Caveat', { exact: true })).toBeVisible();

  // The writing font, for the whole app.
  await appearance.getByLabel('Writing font').selectOption('Handy');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.reading-sample')!).fontFamily)).toContain('Handy');

  // Some words in another, from the text toolbar.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal' }).click();
  await page.getByText('By hand', { exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Entry text' });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('toolbar', { name: 'Text formatting' }).getByLabel('Font').selectOption('My Caveat');
  const words = editor.locator('span[style*="My Caveat"]');
  await expect(words).toHaveText('Written by hand');
  expect(await words.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Twemoji Country Flags", "My Caveat", Newsreader/);
  await page.waitForTimeout(1500);
  await expect(page.getByText('Saved on this device')).toBeVisible();

  // All still there after a reload: the fonts come back from the journal.
  await page.reload();
  await expect(words).toHaveText('Written by hand');
  await expect.poll(() => loaded(page, 'My Caveat')).toEqual(['400 normal']);
  await expect.poll(() => loaded(page, 'Handy')).toEqual(['400 normal', '700 normal']);

  // Removed: gone from the page and the menus, and the writing font is the journal font again.
  await page.goto('/#/settings');
  await list.getByRole('button', { name: 'Remove Handy' }).click();
  await page.getByRole('dialog', { name: 'Remove Handy?' }).getByRole('button', { name: 'Remove it' }).click();
  await expect(list.getByText('Handy')).toHaveCount(0);
  await expect(appearance.getByLabel('Writing font')).toHaveValue('');
  await expect.poll(() => loaded(page, 'Handy')).toEqual([]);
});
