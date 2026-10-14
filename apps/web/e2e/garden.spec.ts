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
