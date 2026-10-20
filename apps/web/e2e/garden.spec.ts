import { expect, test } from '@playwright/test';
import { writeEntry } from './helpers.ts';

// The garden (D97): a plant for every entry, the garden's rank, and its perks.

test('entries grow plants, the garden ranks up with a perk, and plants open their entries', async ({ page }) => {
  await writeEntry(page, 'First seed', 'A short note.');

  // About 500 words in one day takes the garden from Common to Uncommon (repeated filler wouldn't).
  await page.goto('/#/new');
  await page.getByLabel('Title').fill('Long day');
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText('So much happened today and I want to remember it. ' + Array.from({ length: 510 }, (_, i) => `thought${i}`).join(' '));
  const toast = page.getByText('Your garden reached Uncommon! New: Petal celebrations.');
  await expect(toast).toBeVisible();
  await page.getByRole('button', { name: 'See it' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Garden' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your garden' })).toContainText('Your garden is Uncommon');
  const plants = page.locator('a.garden-plant');
  await expect(plants).toHaveCount(2);
  await expect(page.getByRole('link', { name: /^Long day, .*: Common Wildflower, Clump$/ })).toBeVisible();

  // Uncommon's perk can be turned on; Rare's is still locked.
  const shed = page.getByRole('region', { name: 'Garden shed' });
  const petals = shed.getByRole('checkbox', { name: 'Petal celebrations' });
  await petals.check();
  await expect(petals).toBeChecked();
  await expect(shed.locator('li', { hasText: 'Visitors' })).toContainText('🔒 Reach Rare');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('logbook.garden') ?? '{}').petals)).toBe(true);

  // Garden history comes with Mythic, so the Almanac is still locked; the Herbarium is free.
  await page.getByRole('navigation', { name: 'Garden pages' }).getByRole('link', { name: 'Almanac' }).click();
  await expect(page.getByRole('heading', { name: 'Garden history' })).toBeVisible();
  await expect(page.getByText('🔒 Reach Mythic')).toBeVisible();
  await page.getByRole('link', { name: 'Herbarium' }).click();
  await expect(page.getByRole('row', { name: /Wildflower 2 .*Common/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Garden pages' }).getByRole('link', { name: 'Garden' }).click();

  await page.getByRole('link', { name: /^First seed, / }).click();
  await expect(page.getByLabel('Title')).toHaveValue('First seed');

  // The garden can be hidden in Settings.
  await page.goto('/#/settings');
  await page.getByRole('checkbox', { name: '🌱 Show the garden' }).uncheck();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Garden' })).toHaveCount(0);
  await page.goto('/#/garden');
  await page.getByRole('button', { name: '🌱 Show the garden' }).click();
  await expect(page.getByRole('region', { name: 'Your garden' })).toContainText('Your garden is Uncommon');
});

test('garden history and postcards (D98): the update card, the Almanac, the Time-lapse and a postcard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await writeEntry(page, 'Lake day', 'We swam out to the rocks and back before lunch.');
  await writeEntry(page, 'Quiet one', 'Read on the porch all afternoon.');
  // A device that had reached Radiant before this update (perks open at the highest tier seen).
  await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 6000, catalogue: 0 })));
  await page.goto('/#/garden');
  await page.reload();

  const card = page.getByRole('region', { name: '🎁 Garden update' });
  await expect(card).toContainText('Your Radiant garden now has Garden history and Postcards.');
  await card.getByRole('link', { name: 'Try it' }).click();
  await expect(page).toHaveURL(/#\/garden\/almanac$/);
  await expect(card).toHaveCount(0);

  const almanac = page.getByRole('region', { name: 'Almanac' });
  await expect(almanac.locator('dl')).toContainText('Plants2');
  await expect(almanac.getByRole('img', { name: /^Growth by month\. The most was in / })).toBeVisible();
  await almanac.getByText('Show as a table').click();
  const month = new Date().toLocaleDateString(undefined, { month: 'long' });
  await expect(almanac.getByRole('row', { name: new RegExp(`^${month} \\d+ 2 `) })).toBeVisible();

  // With reduced motion the Time-lapse doesn't play: the slider moves through the months.
  const lapse = page.getByRole('region', { name: 'Time-lapse' });
  await expect(lapse.getByRole('button', { name: '▶ Watch it grow' })).toHaveCount(0);
  const label = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  await expect(lapse.getByRole('slider', { name: 'Month' })).toHaveAttribute('aria-valuetext', `${label}: 2 plants`);
  await expect(lapse).toContainText(`${label}: 2 plants`);

  // A postcard of this month's bed: private by default, saved as a PNG.
  await page.getByRole('navigation', { name: 'Garden pages' }).getByRole('link', { name: 'Garden' }).click();
  await page.getByRole('button', { name: `Postcard of ${label}` }).click();
  const dialog = page.getByRole('dialog', { name: `Postcard of ${label}` });
  await expect(dialog.getByRole('checkbox', { name: /Show the flowers/ })).not.toBeChecked();
  const choose = dialog.getByRole('combobox', { name: 'Picture of' });
  await choose.selectOption({ index: 1 });
  await expect(choose.locator('option:checked')).toHaveText(/^Lake day · /);
  await dialog.getByRole('checkbox', { name: /Show the title and date/ }).check();
  const preview = dialog.getByRole('img', { name: 'Postcard preview' });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1200, 1500]);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save picture' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^garden-\d{4}-\d{2}-\d{2}\.png$/);
  await expect(page.getByText('📮 Postcard saved.')).toBeVisible();
});
