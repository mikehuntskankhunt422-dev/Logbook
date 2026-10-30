import { expect, test, type Page } from '@playwright/test';
import { writeEntry } from './helpers.ts';

// Holidays (D108, D109): each one's colours, greeting, garden and prompt, on unless switched off,
// all at once or one at a time; your birthday; Easter's eggs; New Year's countdown.

const badge = (page: Page, greeting: string) => page.getByRole('img', { name: greeting });
const prompt = (page: Page) => page.getByRole('group', { name: 'Writing prompt' });

test('Halloween: its colours, a pumpkin, jack-o’-lanterns in the garden and a prompt on the day, until switched off', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-31T10:00:00') });
  await writeEntry(page, 'Costume day', 'Went as a ghost.');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-holiday', 'halloween');
  await expect(badge(page, 'Happy Halloween')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#6a2c91');

  // The day's own prompt first.
  await page.goto('/#/new');
  await expect(prompt(page)).toContainText('What scared you when you were small?');

  // Jack-o'-lanterns in the newest bed, out of the way of screen readers.
  await page.goto('/#/garden');
  const bed = page.locator('.garden-bed').first();
  await expect(bed.locator('.garden-holiday[data-holiday="halloween"] svg')).toHaveCount(3);
  await expect(bed.locator('.garden-holiday')).toHaveAttribute('aria-hidden', 'true');

  // Switched off on this device: gone, and it stays off.
  await page.goto('/#/settings');
  const halloween = page.getByRole('checkbox', { name: /Halloween/ });
  await expect(halloween).toBeChecked();
  await halloween.uncheck();
  await expect(root).not.toHaveAttribute('data-holiday');
  await expect(badge(page, 'Happy Halloween')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Halloween/ })).not.toBeChecked();
  await expect(root).not.toHaveAttribute('data-holiday');
  await page.goto('/#/garden');
  await expect(page.locator('.garden-holiday')).toHaveCount(0);
});

test('decorations sit at the front of the newest bed, on the right, never on a row of their own', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.clock.install({ time: new Date('2026-10-30T10:00:00') });
  for (let i = 1; i <= 6; i++) await writeEntry(page, `Day ${i}`, 'A few words.');
  await page.goto('/#/garden');
  const ground = page.locator('.garden-bed').first().locator('.garden-ground');
  const decor = ground.locator('.garden-holiday');
  await expect(decor.locator('svg')).toHaveCount(3);
  const g = (await ground.boundingBox())!;
  const d = (await decor.boundingBox())!;
  const bases = await ground.locator('.garden-plant').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
  // In front of every plant, not beside or under them at the left.
  expect(d.y).toBeGreaterThan(Math.max(...bases));
  expect(Math.abs(g.x + g.width - 14 - (d.x + d.width))).toBeLessThan(2);
});

test('every holiday off at once, and back, keeping the ones switched off one by one', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-31T10:00:00') });
  await writeEntry(page, 'Switches', 'On and off.');
  await page.goto('/#/settings');
  const all = page.getByRole('checkbox', { name: 'Show holidays' });
  const halloween = page.getByRole('checkbox', { name: /Halloween/ });
  await expect(all).toBeChecked();
  await all.uncheck();
  await expect(page.locator('html')).not.toHaveAttribute('data-holiday');
  // Each holiday's own switch waits, greyed out, keeping its choice.
  await expect(halloween).toBeDisabled();
  await expect(halloween).toBeChecked();
  await page.reload();
  await expect(all).not.toBeChecked();
  await expect(page.locator('html')).not.toHaveAttribute('data-holiday');
  await all.check();
  await expect(page.locator('html')).toHaveAttribute('data-holiday', 'halloween');
  await expect(halloween).toBeEnabled();
});

test('Christmas: its greeting and colours, a tree and presents with snow (in the north), and a prompt on the day', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-12-25T10:00:00') });
  await writeEntry(page, 'Christmas morning', 'Presents and porridge.');
  await expect(page.locator('html')).toHaveAttribute('data-holiday', 'christmas');
  await expect(badge(page, 'Merry Christmas')).toBeVisible();
  await page.goto('/#/new');
  await expect(prompt(page)).toContainText('What’s a Christmas memory that still makes you smile?');
  await page.goto('/#/garden');
  const bed = page.locator('.garden-bed').first();
  await expect(bed.locator('.garden-holiday[data-holiday="christmas"] svg')).toHaveCount(3);
  await expect(bed).toHaveAttribute('data-snow', 'true');
});

test.describe('in the southern hemisphere', () => {
  test.use({ timezoneId: 'Australia/Sydney' });
  test('Christmas comes without snow', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-12-24T23:00:00Z') });
    await writeEntry(page, 'Beach Christmas', 'Prawns on the barbecue.');
    await expect(badge(page, 'Merry Christmas')).toBeVisible();
    await page.goto('/#/garden');
    const bed = page.locator('.garden-bed').first();
    await expect(bed.locator('.garden-holiday[data-holiday="christmas"]')).toBeVisible();
    await expect(bed).not.toHaveAttribute('data-snow');
  });
});

test('New Year: a countdown to midnight on the clock, then the new year’s greeting and prompt', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-12-31T23:59:40') });
  await writeEntry(page, 'Last of the year', 'Fireworks soon.');
  await expect(badge(page, 'Happy New Year’s Eve')).toBeVisible();
  await page.goto('/#/clock');
  const countdown = page.getByRole('timer');
  await expect(countdown).toContainText(/The new year in 00:00:\d\d/);
  await page.clock.runFor(30_000);
  await expect(page.getByRole('status').filter({ hasText: 'Happy New Year!' })).toBeVisible();
  await expect(badge(page, 'Happy New Year')).toBeVisible();
  await page.goto('/#/new');
  await expect(prompt(page)).toContainText('What do you hope the year ahead brings?');
  await page.goto('/#/garden');
  await expect(page.locator('.garden-holiday[data-holiday="newyear"] svg')).toHaveCount(3);
});

test('Easter: eggs hidden among the plants to find, kept found', async ({ page }) => {
  await page.clock.install({ time: new Date('2027-03-28T10:00:00') });
  await writeEntry(page, 'Easter Sunday', 'Hot cross buns.');
  await expect(badge(page, 'Happy Easter')).toBeVisible();
  await page.goto('/#/garden');
  const eggs = page.getByRole('button', { name: 'A painted egg: find it' });
  await expect(eggs).toHaveCount(4);
  await eggs.first().click();
  await expect(page.getByText('You found an egg: 1 of 4.')).toBeVisible();
  for (let left = 3; left > 0; left--) await eggs.first().click();
  await expect(page.getByText('You found every egg. Happy Easter!')).toBeVisible();
  await expect(page.locator('.garden-eggs-count')).toHaveText('🥚 4 of 4 eggs found');
  await page.reload();
  await expect(page.getByRole('button', { name: 'An egg you found' })).toHaveCount(4);
});

test('your birthday: set in Settings (month and day only), then a greeting, a cake and a prompt on the day', async ({ page }) => {
  await page.clock.install({ time: new Date('2027-03-07T10:00:00') });
  await writeEntry(page, 'An ordinary day', 'Or is it?');
  await expect(page.locator('.holiday-badge')).toHaveCount(0);
  await page.goto('/#/settings');
  await page.getByLabel('Birthday month').selectOption('3');
  await page.getByLabel('Birthday day').selectOption('7');
  await expect(badge(page, 'Happy birthday')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-holiday', 'birthday');
  expect(await page.evaluate(() => localStorage.getItem('logbook.holidays'))).toBe('{"birthday":"03-07"}');
  await page.goto('/#/new');
  await expect(prompt(page)).toContainText('What do you hope this year of your life brings?');
  await page.goto('/#/garden');
  await expect(page.locator('.garden-holiday[data-holiday="birthday"] svg')).toHaveCount(3);
  // Forgotten: an ordinary day again.
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Forget it' }).click();
  await expect(page.locator('.holiday-badge')).toHaveCount(0);
});

test('a preview of any holiday, whatever the date and even when switched off, until stopped (D110)', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-01T10:00:00') });
  await writeEntry(page, 'An ordinary day', 'Nothing on.');
  // In-app moves keep the preview, as a person moving around would (a reload ends it).
  const go = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
  await go('#/settings');
  await page.getByRole('checkbox', { name: 'Show holidays' }).uncheck();
  await page.getByRole('button', { name: 'Preview Christmas' }).click();
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-holiday', 'christmas');
  const bar = page.getByRole('region', { name: 'Holiday preview' });
  await expect(bar).toContainText('Previewing 🎄 Christmas');
  await expect(badge(page, 'Merry Christmas')).toBeVisible();
  await go('#/garden');
  await expect(page.locator('.garden-holiday[data-holiday="christmas"]')).toBeVisible();
  await go('#/new');
  await expect(prompt(page)).toContainText('What’s a Christmas memory that still makes you smile?');

  // Easter's eggs can be found in a preview, but aren't kept.
  await go('#/settings');
  await page.getByRole('button', { name: 'Preview Easter' }).click();
  await expect(root).toHaveAttribute('data-holiday', 'easter');
  await go('#/garden');
  await page.getByRole('button', { name: 'A painted egg: find it' }).first().click();
  await expect(page.getByText('You found an egg: 1 of 4.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('logbook.holidays.eggs'))).toBeNull();

  await bar.getByRole('button', { name: 'Stop preview' }).click();
  await expect(root).not.toHaveAttribute('data-holiday');
  await expect(bar).toHaveCount(0);
  await expect(page.locator('.garden-holiday, .garden-egg')).toHaveCount(0);
});

test('no holiday on an ordinary day (D108)', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-01T10:00:00') });
  await writeEntry(page, 'The day after', 'Leftover sweets.');
  await expect(page.locator('html')).not.toHaveAttribute('data-holiday');
  await expect(page.locator('.holiday-badge')).toHaveCount(0);
});
