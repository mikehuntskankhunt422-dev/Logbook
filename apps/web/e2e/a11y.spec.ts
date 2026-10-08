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
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeAttached();
    await expectNoSeriousViolations(page, 'empty home');

    await writeEntry(page, 'Accessible entry', 'Some words with a https://example.com link.');
    await page.getByTestId('photo-input').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: png() }]);
    await expect(page.getByRole('img', { name: 'a.png' })).toBeVisible();
    await expectNoSeriousViolations(page, 'entry editor');

    for (const path of ['/', '/#/calendar', '/#/memories', '/#/search', '/#/settings']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoSeriousViolations(page, path);
    }
  });
}

test('keyboard users can reach the main actions with visible focus', async ({ page }) => {
  await page.goto('/');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  // The app renders after IndexedDB opens, which can be after the load event; Tab too early lands on <body>.
  await expect(skip).toBeAttached();
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});
