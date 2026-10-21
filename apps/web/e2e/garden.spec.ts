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
  const now = new Date();
  const before = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const monthLabel = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const [label, earlier] = [monthLabel(now), monthLabel(before)];

  // One entry about last month, one about today.
  await writeEntry(page, 'Lake day', 'We swam out to the rocks and back before lunch.');
  await page.getByLabel('Date', { exact: true }).fill(`${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, '0')}-15`);
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await writeEntry(page, 'Quiet one', 'Read on the porch all afternoon.');
  // A device that had reached Radiant before this update (perks open at the highest tier seen).
  await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 6000, catalogue: 0 })));
  await page.goto('/#/garden');
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^${earlier} · 1 plant$`) })).toBeVisible();

  const card = page.getByRole('region', { name: '🎁 Garden update' });
  await expect(card).toContainText('Your Radiant garden now has Garden sounds, Garden history and Postcards.');
  await card.getByRole('link', { name: 'Try it' }).click();
  await expect(page).toHaveURL(/#\/garden\/almanac$/);
  await expect(card).toHaveCount(0);
  // A page of its own: its title, and focus at the top of the page.
  await expect(page).toHaveTitle('Almanac · Garden · Logbook');
  await expect(page.locator('#main')).toBeFocused();

  const almanac = page.getByRole('region', { name: 'Almanac' });
  await expect(almanac.getByRole('img', { name: /^Growth by month\. The most was in / })).toBeVisible();
  await almanac.getByText('Show as a table').click();
  const month = now.toLocaleDateString(undefined, { month: 'long' });
  await expect(almanac.getByRole('row', { name: new RegExp(`^${month} \\d+ 1 `) })).toBeVisible();

  // With reduced motion the Time-lapse doesn't play: the slider steps through the months, both ways.
  const lapse = page.getByRole('region', { name: 'Time-lapse' });
  await expect(lapse.getByRole('button', { name: '▶ Watch it grow' })).toHaveCount(0);
  const slider = lapse.getByRole('slider', { name: 'Month' });
  await expect(slider).toHaveAttribute('aria-valuetext', `${label}: 1 plant`);
  await expect(lapse).toContainText('2 plants in the garden');
  await slider.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuetext', `${earlier}: 1 plant`);
  await expect(lapse).toContainText('1 plant in the garden');
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', `${label}: 1 plant`);
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', `${earlier}: 1 plant`);

  // A postcard of this month's bed: private by default, even in its file name.
  await page.getByRole('navigation', { name: 'Garden pages' }).getByRole('link', { name: 'Garden' }).click();
  const opener = page.getByRole('button', { name: `Postcard of ${label}` });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: `Postcard of ${label}` });
  await expect(dialog.getByRole('checkbox', { name: /Show the flowers/ })).not.toBeChecked();
  const preview = dialog.getByRole('img', { name: 'Postcard preview' });
  await expect(preview).toBeVisible();
  let download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save picture' }).click();
  expect((await download).suggestedFilename()).toBe('garden-postcard.png');
  await expect(page.getByText('📮 Postcard saved.')).toBeVisible();

  // One plant, with its title and date: a 1200 × 1500 picture named for its date.
  const choose = dialog.getByRole('combobox', { name: 'Picture of' });
  await choose.selectOption({ index: 1 });
  await expect(choose.locator('option:checked')).toHaveText(/^Quiet one · /);
  await dialog.getByRole('checkbox', { name: /Show the title and date/ }).check();
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1200, 1500]);
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save picture' }).click();
  expect((await download).suggestedFilename()).toMatch(/^garden-\d{4}-\d{2}-\d{2}\.png$/);

  // Close puts keyboard focus back on the button that opened it.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('a garden update tells in a card only of tiers reached before it; later tiers come with their rank-up', async ({ page }) => {
  await writeEntry(page, 'A note', 'Just a few words today.');
  // Updated at Mythic: Garden sounds and Garden history were already reached, Postcards (Radiant) not yet.
  await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 5000, catalogue: 0 })));
  await page.goto('/#/garden/almanac');
  await page.reload();
  const card = page.getByRole('region', { name: '🎁 Garden update' });
  await expect(card).toContainText('now has Garden sounds and Garden history.');
  await expect(card).not.toContainText('Postcards');
  // Already on the Almanac: no Try it, which would only take focus away.
  await expect(card.getByRole('link', { name: 'Try it' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('logbook.garden') ?? '{}').noted)).toEqual({ 2: 5 });
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Garden pages' }).getByRole('link', { name: 'Almanac' })).toBeFocused();

  // Updated at Epic: nothing to tell yet, so no card, now or once Legendary comes.
  await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 3000, catalogue: 0 })));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your garden' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('logbook.garden') ?? '{}').catalogue)).toBe(2);
  await expect(card).toHaveCount(0);
});

test('seasons, weather and garden sounds (D99): chosen in the shed, never on by themselves', async ({ page }) => {
  await writeEntry(page, 'Autumn walk', 'Leaves everywhere along the river path today.');
  // A device at Prismatic that closed the 0.6.1 card: it hears of 0.7.0's features once.
  await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 7000, catalogue: 1, noted: { 1: 7 } })));
  await page.goto('/#/garden');
  await page.reload();
  const card = page.getByRole('region', { name: '🎁 Garden update' });
  await expect(card).toContainText('now has Garden sounds and Seasons and weather.');
  await card.getByRole('button', { name: 'Close' }).click();

  // Nothing changes until chosen: no seasons, no weather, no sound.
  const scene = page.locator('.garden-scene');
  const bed = page.locator('.garden-bed').first();
  await expect(bed).not.toHaveAttribute('data-season');
  await expect(scene).not.toHaveAttribute('data-weather');
  const sounds = page.getByRole('group', { name: 'Garden sounds' }).getByRole('button', { name: 'Garden sounds' });
  await expect(sounds).toHaveAttribute('aria-pressed', 'false');

  const shed = page.getByRole('region', { name: 'Garden shed' });
  await shed.getByRole('checkbox', { name: 'Seasons' }).check();
  await shed.getByRole('group', { name: 'Hemisphere' }).getByRole('button', { name: 'North', exact: true }).click();
  // The bed is this month's, by the local date, as entries' dates are.
  const month = new Date().getMonth() + 1;
  const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  await expect(bed).toHaveAttribute('data-season', north[month - 1]!);
  await shed.getByRole('group', { name: 'Hemisphere' }).getByRole('button', { name: 'South', exact: true }).click();
  await expect(bed).toHaveAttribute('data-season', north[(month + 5) % 12]!);

  // Weather: drawn on a canvas over the garden, and lying on the ground.
  await shed.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Snow' }).click();
  await expect(scene).toHaveAttribute('data-weather', 'snow');
  // On the page's body, where the page's own animation can't move it.
  await expect(page.locator('body > canvas.garden-weather')).toHaveCount(1);
  // With reduced motion nothing moves: the snow only lies on the ground.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('canvas.garden-weather')).toHaveCount(0);
  await expect(scene).toHaveAttribute('data-weather', 'snow');
  await shed.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Off' }).click();
  await expect(scene).not.toHaveAttribute('data-weather');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('logbook.garden') ?? '{}'))).toMatchObject({ seasons: true, weather: '', hemisphere: 'south' });

  // Sounds play only when pressed, and stop when the garden page is left.
  await sounds.click();
  await expect(sounds).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Garden sounds' }).getByRole('slider', { name: 'Volume' }).fill('0.2');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('logbook.garden') ?? '{}').soundVolume)).toBe(0.2);
  await page.getByRole('navigation', { name: 'Garden pages' }).getByRole('link', { name: 'Herbarium' }).click();
  await expect(sounds).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Garden pages' }).getByRole('link', { name: 'Garden' }).click();
  await expect(sounds).toHaveAttribute('aria-pressed', 'false');
});

test.describe('in a southern time zone', () => {
  // Chromium reports this zone as America/Buenos_Aires: the guess must still be south.
  test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

  test('the shed names the hemisphere guessed from the time zone, and the seasons follow it', async ({ page }) => {
    await writeEntry(page, 'A note', 'Just a few words today.');
    await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 7000, catalogue: 2, noted: { 2: 7 }, seasons: true })));
    await page.goto('/#/garden');
    await page.reload();
    const hemisphere = page.getByRole('region', { name: 'Garden shed' }).getByRole('group', { name: 'Hemisphere' });
    await expect(hemisphere.getByRole('button', { name: 'From my time zone (South)' })).toHaveAttribute('aria-pressed', 'true');
    // This month where the page is, in its time zone.
    const month = await page.evaluate(() => new Date().getMonth() + 1);
    const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
    await expect(page.locator('.garden-bed').first()).toHaveAttribute('data-season', north[(month + 5) % 12]!);
  });
});
