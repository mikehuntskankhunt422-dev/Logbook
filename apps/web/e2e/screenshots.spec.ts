import { expect, test } from '@playwright/test';
import { png, writeEntry } from './helpers.ts';

// Visual review aid, not an assertion suite. Run with: SCREENSHOTS=1 npx playwright test screenshots
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture review screenshots');

for (const scheme of ['light', 'dark'] as const) {
  test(`capture key views (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const shot = (name: string) => page.screenshot({ path: `test-results/screens/${info.project.name}-${scheme}-${name}.png`, fullPage: false });

    await writeEntry(page, 'Sunday at Glenelg', 'Swam out to the jetty and back. The water was freezing but the light was gold. ');
    await page.getByRole('button', { name: 'Mood 😄' }).click();
    await page.getByLabel('Add a tag').fill('beach');
    await page.getByLabel('Add a tag').press('Enter');
    await page.getByTestId('photo-input').setInputFiles([{ name: 'jetty.png', mimeType: 'image/png', buffer: png([255, 150, 90]) }]);
    await expect(page.getByRole('img', { name: 'jetty.png' })).toBeVisible();
    await page.getByLabel('Photo caption').fill('Jetty at dusk');
    await expect(page.getByText('Saved on this device')).toBeVisible();
    await shot('editor');

    await writeEntry(page, 'Market morning', 'Coffee, peaches and a long walk home.');
    await page.getByTestId('photo-input').setInputFiles([
      { name: 'a.png', mimeType: 'image/png', buffer: png([90, 160, 240]) },
      { name: 'b.png', mimeType: 'image/png', buffer: png([240, 200, 90]) },
      { name: 'c.png', mimeType: 'image/png', buffer: png([120, 200, 120]) },
    ]);
    await expect(page.getByRole('img', { name: 'Photo 3' })).toBeVisible();
    await page.getByRole('button', { name: 'Collage' }).click();
    await expect(page.getByText('Saved on this device')).toBeVisible();
    await shot('gallery');

    await page.goto('/');
    await expect(page.getByRole('link', { name: /Market morning/ })).toBeVisible();
    await shot('timeline');
    await page.goto('/#/calendar');
    await shot('calendar');
    await page.goto('/#/settings');
    await shot('settings');
  });
}
