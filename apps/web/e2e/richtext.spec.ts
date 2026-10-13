import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { writeEntry } from './helpers.ts';

// The editor's formatting (D91): headings H1–H6, checklists, tables, colours, highlight, fonts and
// alignment survive a reload and reach the exports.

test('rich text: headings, a checklist, a table, colour, highlight and fonts', async ({ page }) => {
  await writeEntry(page, 'Trip plan', 'Packing');
  const editor = page.getByRole('textbox', { name: 'Entry text' });
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });

  // The first line becomes a top-level heading, centred.
  await toolbar.getByLabel('Text style').selectOption('1');
  await toolbar.getByLabel('Alignment').selectOption('center');
  await expect(editor.locator('h1')).toHaveText('Packing');
  await expect(editor.locator('h1')).toHaveCSS('text-align', 'center');

  // A checklist with one item ticked.
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await toolbar.getByRole('button', { name: 'Checklist' }).click();
  await page.keyboard.type('Passport');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Sunscreen');
  await editor.getByRole('checkbox', { name: 'Task item checkbox for Passport' }).check();
  await expect(editor.locator('li[data-checked="true"] > div')).toHaveText('Passport');

  // Out of the list, then coloured, highlighted words in another font.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Remember the tickets');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 'tickets'.length; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await toolbar.getByRole('button', { name: 'Text colour' }).click();
  await page.getByRole('button', { name: 'Text colour Blue' }).click();
  await toolbar.getByRole('button', { name: 'Highlight' }).click();
  await page.getByRole('button', { name: 'Highlight Yellow' }).click();
  await toolbar.getByLabel('Font').selectOption('Caveat');
  await expect(editor.locator('mark')).toHaveText('tickets');
  await expect(editor.locator('span[style*="color"]')).toHaveText('tickets');

  // A table, typed into, after the words (not over them). The editor takes the focus back from the
  // font menu a frame later, with the words still selected: wait for that, then for the editor
  // itself (not just the page) to have let go of them, before pressing Enter.
  await expect(editor).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => editor.evaluate((el) => (el as HTMLElement & { editor: { state: { selection: { empty: boolean } } } }).editor.state.selection.empty)).toBe(true);
  await page.keyboard.press('Enter');
  await toolbar.getByRole('button', { name: 'Table' }).click();
  await page.keyboard.type('Day');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Place');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Mon');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Rome');
  await expect(page.getByRole('toolbar', { name: 'Table' })).toBeVisible();
  await expect(editor.locator('th').first()).toHaveText('Day');
  // The editor saves 0.7 s after the last key.
  await page.waitForTimeout(1500);
  await expect(page.getByText('Saved on this device')).toBeVisible();

  // All of it after a reload.
  await page.reload();
  await expect(editor.locator('h1')).toHaveText('Packing');
  await expect(editor.locator('li[data-checked="true"] > div')).toHaveText('Passport');
  await expect(editor.locator('mark')).toHaveText('tickets');
  await expect(editor.locator('td').filter({ hasText: 'Rome' })).toBeVisible();

  // And in a Markdown export.
  await page.goto('/#/settings');
  const pending = page.waitForEvent('download');
  await page.getByRole('region', { name: 'Export' }).getByRole('button', { name: /Download 1 entry/ }).click();
  const file = await pending;
  const bytes = await readFile((await file.path())!);
  const text = file.suggestedFilename().endsWith('.zip')
    ? strFromU8(Object.entries(unzipSync(new Uint8Array(bytes))).find(([n]) => n.endsWith('.md'))![1])
    : bytes.toString('utf8');
  expect(text).toContain('## Packing');
  expect(text).toContain('- [x] Passport');
  expect(text).toContain('- [ ] Sunscreen');
  expect(text).toContain('<mark>tickets</mark>');
  expect(text).toMatch(/\| Day \| Place \| {2}\|/);
  expect(text).toContain('| Mon | Rome |');
});

test('flags from the picker, and easier reading', async ({ page }) => {
  await writeEntry(page, 'Holiday', 'Off to ');
  await page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Insert a flag' }).click();
  await page.getByLabel('Find a country').fill('japan');
  await page.getByRole('button', { name: 'Flag of Japan' }).click();
  await expect(page.getByRole('textbox', { name: 'Entry text' })).toContainText('Off to 🇯🇵');
  // The flag font is the first in the stack, for Windows, whose emoji font has no flags.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.rt')!).fontFamily)).toMatch(/^"?Twemoji Country Flags/);

  await page.goto('/#/settings');
  const appearance = page.getByRole('region', { name: 'Appearance' });
  await appearance.getByRole('group', { name: 'Text size' }).getByRole('button', { name: 'Larger' }).click();
  await appearance.getByRole('group', { name: 'Line spacing' }).getByRole('button', { name: 'Loose' }).click();
  await appearance.getByLabel('Writing font').selectOption('Atkinson Hyperlegible');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'larger');
  await expect(page.locator('html')).toHaveAttribute('data-line-spacing', 'loose');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.reading-sample')!).fontFamily)).toContain('Atkinson Hyperlegible');
  // Kept after a reload.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'larger');
});
