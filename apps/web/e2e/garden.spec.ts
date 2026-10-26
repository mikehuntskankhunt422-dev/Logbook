import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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
  await expect(card).toContainText('Your Radiant garden now has Landmarks, Garden sounds, Garden history and Postcards.');
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
  await expect(card).toContainText('now has Landmarks, Garden sounds and Garden history.');
  await expect(card).not.toContainText('Postcards');
  // Already on the Almanac: no Try it, which would only take focus away.
  await expect(card.getByRole('link', { name: 'Try it' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('logbook.garden') ?? '{}').noted)).toEqual({ 4: 5 });
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Garden pages' }).getByRole('link', { name: 'Almanac' })).toBeFocused();

  // Updated at Epic: only the free Landmarks to tell; Garden sounds waits for Legendary's rank-up.
  await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 3000, catalogue: 0 })));
  await page.reload();
  await expect(card).toContainText('Your Epic garden now has Landmarks.');
  await expect(card).not.toContainText('Garden sounds');
  await card.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('logbook.garden') ?? '{}').catalogue)).toBe(4);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your garden' })).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('seasons, weather and garden sounds (D99): chosen in the shed, never on by themselves', async ({ page }) => {
  await writeEntry(page, 'Autumn walk', 'Leaves everywhere along the river path today.');
  // A device at Prismatic that closed the 0.6.1 card: it hears of 0.7.0's features once.
  await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 7000, catalogue: 1, noted: { 1: 7 } })));
  await page.goto('/#/garden');
  await page.reload();
  const card = page.getByRole('region', { name: '🎁 Garden update' });
  await expect(card).toContainText('now has Landmarks, Garden sounds and Seasons and weather.');
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

test('companions (D100): pets beside the newest plant, a second pet, and each year’s star map', async ({ page }) => {
  await writeEntry(page, 'River walk', 'We followed the river path all the way to the old mill and back.');
  await page.getByLabel('Add a tag').fill('lisbon');
  await page.getByLabel('Add a tag').press('Enter');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await writeEntry(page, 'Quiet one', 'Read on the porch.');
  // A device at Eternal: one pet and the star map, a second pet, but not yet the ancient ones.
  await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 12000, catalogue: 3, noted: { 3: 12 } })));
  await page.goto('/#/garden');
  await page.reload();
  const shed = page.getByRole('region', { name: 'Garden shed' });
  const pets = shed.getByRole('group', { name: 'Pet', exact: true });
  await expect(pets.getByRole('button', { name: 'Baby dragon' })).toHaveCount(0);
  await expect(page.locator('.garden-pet')).toHaveCount(0);

  await pets.getByRole('button', { name: 'Cat' }).click();
  // A full name stays as it was when more is typed in its middle.
  const petName = shed.getByRole('textbox', { name: 'Pet’s name', exact: true });
  await petName.fill('abcdefghijklmnopqrst');
  await petName.press('Home');
  for (let i = 0; i < 5; i++) await petName.press('ArrowRight');
  await petName.press('X');
  await expect(petName).toHaveValue('abcdefghijklmnopqrst');
  await petName.fill('Biscuit');
  const cat = page.getByRole('button', { name: 'Your cat, Biscuit, napping' });
  // In the newest bed, beside its newest plant.
  await expect(page.locator('.garden-bed').first().getByRole('button', { name: 'Your cat, Biscuit, napping' })).toBeVisible();
  await cat.click();
  await expect(page.getByRole('button', { name: 'Your cat, Biscuit, stretching' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Your cat, Biscuit, napping' })).toBeVisible();
  await shed.getByRole('group', { name: 'Second pet' }).getByRole('button', { name: 'Hedgehog' }).click();
  await expect(page.getByRole('button', { name: 'Your hedgehog, napping' })).toBeVisible();

  // The star map: this year's constellation, named after its most-used tag; each star opens its entry.
  await expect(page.locator('.garden-starmap')).toHaveCount(0);
  await shed.getByRole('checkbox', { name: 'Star map' }).check();
  const year = String(new Date().getFullYear());
  const map = page.getByRole('region', { name: `The Lisbon Cluster · ${year}` });
  await expect(map.getByRole('link')).toHaveCount(2);
  await map.getByRole('link', { name: /^River walk, / }).click();
  await expect(page.getByLabel('Title')).toHaveValue('River walk');

  // Ancient companions come with Primordial.
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('logbook.garden') ?? '{}');
    localStorage.setItem('logbook.garden', JSON.stringify({ ...prefs, seen: 13000 }));
  });
  await page.goto('/#/garden');
  await page.reload();
  await page.getByRole('region', { name: 'Garden shed' }).getByRole('group', { name: 'Pet', exact: true }).getByRole('button', { name: 'Baby dragon' }).click();
  await expect(page.getByRole('button', { name: 'Your baby dragon, Biscuit, napping' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('logbook.garden') ?? '{}'))).toMatchObject({ pet: 'dragon', petName: 'Biscuit', pet2: 'hedgehog', starMap: true });
});

test('on a narrow phone, stars stay a tap apart and pets stay beside the newest plant (D100)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  // Twelve entries today: twelve stars on one day, and a bed that wraps; the newest a Flowering tree.
  for (let i = 0; i < 11; i++) await writeEntry(page, `Note ${i}`, `A few words for note number ${i}.`);
  await page.goto('/#/new');
  await page.getByLabel('Title').fill('Big day');
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText('So much happened. ' + Array.from({ length: 2600 }, (_, k) => `w${k}x`).join(' '));
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 13000, catalogue: 3, noted: { 3: 13 }, pet: 'cat', pet2: 'tortoise', starMap: true })));
  await page.goto('/#/garden');
  await page.reload();
  const stars = page.locator('.garden-star');
  await expect(stars).toHaveCount(12);
  const centres = await stars.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  for (let i = 1; i < centres.length; i++) expect(Math.hypot(centres[i]![0]! - centres[i - 1]![0]!, centres[i]![1]! - centres[i - 1]![1]!)).toBeGreaterThanOrEqual(24);
  // Both pets with the newest plant, a tree too wide to share its row: below it, whole, in the bed.
  const bed = await page.locator('.garden-bed').first().boundingBox();
  const newest = page.locator('.garden-bed').first().locator('li.garden-newest');
  for (const name of ['Your cat, napping', 'Your tortoise, napping']) {
    const pet = newest.getByRole('button', { name });
    const box = await pet.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(bed!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bed!.x + bed!.width);
  }
  // No sideways scroll for the page itself.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('wonders (D103): landmarks from the start, biomes at Cosmic, golden landmarks at Eternal and the World Tree at Worldbloom', async ({ page }) => {
  await writeEntry(page, 'First seed', 'A short note to begin.');
  await writeEntry(page, 'Long walk', 'We walked along the river to the old mill, then up the hill past the orchard, and home again before dark.');
  await page.goto('/#/garden');
  const landmarks = page.getByRole('list', { name: 'Landmarks' });
  await expect(landmarks.getByRole('link', { name: /^A stone for your first entry: First seed, / })).toBeVisible();
  await expect(landmarks.getByRole('link', { name: /^A statue for your longest entry, \d+ plant words: Long walk, / })).toBeVisible();
  // A landmark opens its entry.
  await landmarks.getByRole('link', { name: /^A stone for your first entry/ }).click();
  await expect(page.getByLabel('Title')).toHaveValue('First seed');
  await page.goto('/#/garden');
  const shed = page.getByRole('region', { name: 'Garden shed' });
  await shed.getByRole('checkbox', { name: 'Landmarks' }).uncheck();
  await expect(landmarks).toHaveCount(0);
  await shed.getByRole('checkbox', { name: 'Landmarks' }).check();
  await expect(shed.getByRole('group', { name: 'Biome' })).toHaveCount(0);

  // Cosmic: the biomes, each with its scenery by the gate.
  const reach = async (tier: number) => {
    await page.evaluate((t) => {
      const prefs = JSON.parse(localStorage.getItem('logbook.garden') ?? '{}');
      localStorage.setItem('logbook.garden', JSON.stringify({ ...prefs, seen: t * 1000, catalogue: 4, noted: { 4: t } }));
    }, tier);
    await page.goto('/#/garden');
    await page.reload();
  };
  await reach(11);
  const biomes = shed.getByRole('group', { name: 'Biome' });
  await expect(biomes.getByRole('button', { name: 'Meadow' })).toHaveAttribute('aria-pressed', 'true');
  await biomes.getByRole('button', { name: 'Lily pond' }).click();
  await expect(page.locator('.garden-scene')).toHaveAttribute('data-biome', 'pond');
  await expect(page.locator('.garden-gate')).toContainText('🪷');
  await expect(shed.getByRole('checkbox', { name: 'Golden landmarks' })).toHaveCount(0);
  await expect(shed.getByRole('checkbox', { name: 'World Tree' })).toHaveCount(0);

  // Eternal: golden landmarks, their dates engraved.
  await reach(12);
  await shed.getByRole('checkbox', { name: 'Golden landmarks' }).check();
  await expect(landmarks).toHaveAttribute('data-gold', 'true');
  await expect(landmarks.locator('.garden-landmark-date').first()).toHaveText(/^\d{4}-\d{2}-\d{2}$/);

  // Worldbloom: the World Tree, a blossom for this month.
  await reach(14);
  await expect(page.locator('.garden-tree')).toHaveCount(0);
  await shed.getByRole('checkbox', { name: 'World Tree' }).check();
  await expect(page.getByRole('img', { name: 'The World Tree: 1 blossom, for the month you’ve written in' })).toBeVisible();
  for (const biome of ['Zen sand', 'Desert oasis', 'Alpine', 'Floating isles']) {
    await biomes.getByRole('button', { name: biome }).click();
    await expectNoSeriousViolations(page, `the ${biome} garden`);
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('logbook.garden') ?? '{}'))).toMatchObject({ biome: 'isles', landmarks: true, goldLandmarks: true, worldTree: true });
});

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).include('.garden-page').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`), `${label} has accessibility violations`).toEqual([]);
}
