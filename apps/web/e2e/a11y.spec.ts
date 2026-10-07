import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { png, writeEntry } from './helpers.ts';

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `${label} has accessibility violations`).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test(`no serious accessibility violations across views (${theme})`, async ({ page }) => {
    // Eight axe scans plus a full book layout: more than the default 60 s on a CI runner.
    test.slow();
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expectNoSeriousViolations(page, 'empty home');

    await writeEntry(page, 'Accessible entry', 'Some words with a https://example.com link.');
    await page.getByTestId('photo-input').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: png() }]);
    await expect(page.getByRole('img', { name: 'a.png' })).toBeVisible();
    await expectNoSeriousViolations(page, 'entry editor');

    // Wait for each view's own heading, not 'networkidle': the book builder's preview iframes keep
    // Playwright from ever reporting the page idle, and idle can also come before a lazy view renders.
    const views: [string, string | RegExp][] = [
      ['/', /Nice work today|How was today/],
      ['/#/calendar', 'Calendar'],
      ['/#/memories', 'On this day'],
      ['/#/search', 'Search'],
      ['/#/book', 'Make a book'],
      ['/#/settings', 'Settings'],
    ];
    for (const [path, heading] of views) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expectNoSeriousViolations(page, path);
    }

    await page.goto('/#/book');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByRole('button', { name: 'Make preview' }).click();
    await expect(page.getByText(/Preview ready/)).toBeVisible({ timeout: 60_000 });
    await expectNoSeriousViolations(page, 'book preview');
  });
}

test('keyboard users can reach the main actions with visible focus', async ({ page }) => {
  await page.goto('/');
  // The skip link is rendered by the app, so wait until it has mounted.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});
