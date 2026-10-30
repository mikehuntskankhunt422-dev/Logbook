import { expect, test } from '@playwright/test';
import { writeEntry } from './helpers.ts';

// Holidays (D108): Halloween's colours, pumpkin, jack-o'-lanterns and prompt, on unless switched off.

test('Halloween: its colours, a pumpkin, jack-o’-lanterns in the garden and a prompt on the day, until switched off', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-31T10:00:00') });
  await writeEntry(page, 'Costume day', 'Went as a ghost.');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-holiday', 'halloween');
  await expect(page.getByRole('img', { name: 'Happy Halloween' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#6a2c91');

  // The day's own prompt first.
  await page.goto('/#/new');
  await expect(page.getByRole('group', { name: 'Writing prompt' })).toContainText('What scared you when you were small?');

  // Jack-o'-lanterns in the newest bed, out of the way of screen readers.
  await page.goto('/#/garden');
  const bed = page.locator('.garden-bed').first();
  await expect(bed.locator('.garden-holiday svg')).toHaveCount(3);
  await expect(bed.locator('.garden-holiday')).toHaveAttribute('aria-hidden', 'true');

  // Switched off on this device: gone, and it stays off.
  await page.goto('/#/settings');
  const halloween = page.getByRole('checkbox', { name: /Halloween/ });
  await expect(halloween).toBeChecked();
  await halloween.uncheck();
  await expect(root).not.toHaveAttribute('data-holiday');
  await expect(page.getByRole('img', { name: 'Happy Halloween' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Halloween/ })).not.toBeChecked();
  await expect(root).not.toHaveAttribute('data-holiday');
  await page.goto('/#/garden');
  await expect(page.locator('.garden-holiday')).toHaveCount(0);
});

test('no holiday in the days before or after (D108)', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-01T10:00:00') });
  await writeEntry(page, 'The day after', 'Leftover sweets.');
  await expect(page.locator('html')).not.toHaveAttribute('data-holiday');
  await expect(page.locator('.holiday-badge')).toHaveCount(0);
});
