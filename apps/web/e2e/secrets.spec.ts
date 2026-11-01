import { expect, test, type Page } from '@playwright/test';

// Secrets (D115): eight easter eggs around Logbook, each a new perk or a reward of streak shields,
// listed with where to look on a page of their own; shields keep a streak over days missed.

const text = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 40}`).join(' ');

async function write(page: Page, date: string, title: string, words: number) {
  await page.goto(`/#/new?date=${date}`);
  await page.getByLabel('Title').fill(title);
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText(text(words));
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect(page).toHaveURL(/#\/entry\//);
}

const toast = (page: Page) => page.getByRole('status');
/** The streak's number, as shown. */
const streak = (page: Page) => page.locator('.streak > span[aria-hidden]').nth(1);
const secret = (page: Page, name: string | RegExp) => page.getByRole('list', { name: 'Secrets' }).getByRole('listitem').filter({ has: page.getByRole('heading', { name }) });
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('logbook.secrets') ?? '{}') as { found?: Record<string, string>; shields?: number; shielded?: string[] });
/** Nothing found, a moment after whatever might have found it. */
async function nothingFound(page: Page) {
  await page.waitForTimeout(300);
  expect((await stored(page)).found ?? {}).toEqual({});
  await expect(toast(page)).not.toContainText('Secret found');
}
/** A day `n` days from today, as the page counts days. */
const day = (page: Page, n: number) =>
  page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, n);

test('the Secrets page: eight to find, where to look, and what each gives', async ({ page }) => {
  await page.goto('/#/settings');
  const panel = page.getByRole('region', { name: '🥚 Secrets' });
  await expect(panel).toContainText('There are 8 secrets hidden around Logbook');
  await panel.getByRole('link', { name: 'See where to look' }).click();
  await expect(page).toHaveURL(/#\/secrets$/);
  await expect(page.getByRole('heading', { level: 1, name: '🥚 Secrets' })).toBeVisible();
  await expect(page).toHaveTitle('Secrets · Logbook');
  await expect(page.getByText('You’ve found 0 of 8')).toBeVisible();
  const items = page.getByRole('list', { name: 'Secrets' }).getByRole('listitem');
  await expect(items).toHaveCount(8);
  await expect(page.getByRole('heading', { name: 'A secret' })).toHaveCount(8);
  await expect(page.getByText('Find it for: a new perk.')).toHaveCount(4);
  await expect(page.getByText(/^Find it for: (a streak shield|\d streak shields)\.$/)).toHaveCount(4);
  await expect(page.getByText('Someone lives behind the 🌱 Garden’s gate. Knock three times.')).toBeVisible();
  // Settings stays the page you're on in the menu.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
});

test('seven taps on the ✦: star celebrations, on at once and off again on the Secrets page', async ({ page }) => {
  await page.goto('/');
  const brand = page.getByRole('link', { name: 'Logbook', exact: true });
  // Taps too far apart don't count.
  for (let i = 0; i < 7; i++) {
    await brand.click();
    await page.waitForTimeout(i === 3 ? 1700 : 50);
  }
  await nothingFound(page);
  await page.waitForTimeout(1700);
  // Six in a row aren't enough; the seventh is.
  for (let i = 0; i < 6; i++) await brand.click();
  await nothingFound(page);
  await brand.click();
  await expect(toast(page)).toContainText('🥚 Secret found: ✦ Starstruck (1 of 8). New perk: Star celebrations.');
  await toast(page).getByRole('button', { name: 'See secrets' }).click();
  await expect(page).toHaveURL(/#\/secrets$/);
  const found = secret(page, /^Starstruck/);
  await expect(found).toContainText('You tapped the star until it spun.');
  const perk = found.getByRole('checkbox', { name: 'Star celebrations' });
  await expect(perk).toBeChecked();
  await perk.uncheck();
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('logbook.secrets')!) as { stars: boolean })).stars).toBe(false);
});

test('the code on a keyboard: arcade colours for the whole app; not while typing in a box', async ({ page }) => {
  await page.goto('/#/search');
  // In the search box it's only typing.
  await page.getByRole('searchbox').focus();
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k);
  await nothingFound(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k);
  await expect(toast(page)).toContainText('🕹️ Old school (1 of 8). New perk: Arcade colours.');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'arcade');
  // Over a garden colour; off, the garden's comes back.
  await page.evaluate(() => localStorage.setItem('logbook.garden', JSON.stringify({ seen: 3001, accent: 'moss' })));
  await page.goto('/#/secrets');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'arcade');
  await secret(page, /^Old school/).getByRole('checkbox', { name: 'Arcade colours' }).uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'moss');
});

test('knock three times on the garden gate: a gnome moves in, and the focus stays on the gate', async ({ page }) => {
  await write(page, '2026-10-01', 'Planted', 30);
  await page.goto('/#/garden');
  const gate = page.getByRole('button', { name: 'The garden gate' });
  await gate.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(gate).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('🚪 Knock knock (1 of 8). New perk: A garden gnome.');
  await expect(page.getByRole('img', { name: 'A garden gnome' })).toBeVisible();
  await expect(gate).toBeFocused();
});

test('search for 42: two streak shields', async ({ page }) => {
  await page.goto('/#/search');
  await page.getByRole('searchbox').fill('4');
  await page.waitForTimeout(800);
  await nothingFound(page);
  await page.getByRole('searchbox').fill('42');
  await expect(toast(page)).toContainText('🌌 Don’t panic (1 of 8). Reward: 2 streak shields.');
  await page.goto('/#/secrets');
  await expect(page.getByRole('region', { name: '🛡️ Streak shields' }).locator('.shield-count')).toHaveText('2');
  await expect(page.locator('.streak')).toHaveAttribute('title', /🛡️ 2$/);
});

test('stop the stopwatch at exactly 0:10.00: a streak shield', async ({ page }) => {
  // Time stands still but for what the test lets by.
  await page.clock.install({ time: new Date('2026-11-01T10:00:00') });
  await page.goto('/#/clock');
  await page.clock.pauseAt(new Date('2026-11-01T10:00:05'));
  await page.getByRole('tab', { name: /Stopwatch/ }).click();
  await page.getByRole('button', { name: /Start/ }).click();
  await page.clock.runFor(9_990);
  await page.getByRole('button', { name: /Stop/ }).click();
  await expect(page.getByRole('timer')).toHaveText('0:09.99');
  await nothingFound(page);
  await page.getByRole('button', { name: /Resume/ }).click();
  await page.clock.runFor(10);
  await page.getByRole('button', { name: /Stop/ }).click();
  await expect(page.getByRole('timer')).toHaveText('0:10.00');
  await expect(toast(page)).toContainText('⏱️ Spot on (1 of 8). Reward: a streak shield.');
});

test('read a book of four pages or more to its last page: a streak shield', async ({ page }) => {
  await write(page, '2026-10-01', 'Short story', 20);
  await write(page, '2026-10-02', 'Long story', 2400);
  await page.goto('/#/library/shelves');
  await page.getByRole('button', { name: /^Short story, / }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Escape');
  await nothingFound(page);
  await page.getByRole('button', { name: /^Long story, / }).click();
  const reader = page.getByRole('dialog', { name: '📖 Long story' });
  await expect(reader.locator('.reader-where')).toContainText(/of ([4-9]|\d\d+)$/);
  await page.keyboard.press('End');
  await expect(toast(page)).toContainText('🐛 Bookworm (1 of 8). Reward: a streak shield.');
});

test('far into the Library and the storage room: the Book of Sand and the last folder', async ({ page }) => {
  // About 80 m each way, at a run: slower where frames come slowly.
  test.setTimeout(240_000);
  await write(page, '2026-06-01', 'The only book', 20);
  await page.evaluate(() => localStorage.setItem('logbook.walk.help', 'seen'));
  await page.goto('/#/library');
  const place = page.locator('.walk-place strong');
  await expect(place).toHaveText('Gallery 2026', { timeout: 20_000 });
  // Walking on into the empty galleries: a few short of ten, nothing yet.
  const run = async (on: boolean) => {
    for (const k of on ? ['ShiftLeft', 'KeyW'] : ['KeyW', 'ShiftLeft']) await (on ? page.keyboard.down(k) : page.keyboard.up(k));
  };
  await run(true);
  await expect(place).toHaveText(/^Gallery 203[0-3]$/, { timeout: 80_000 });
  await run(false);
  await nothingFound(page);
  // On to the tenth.
  await run(true);
  await expect(toast(page)).toContainText('📕 The Book of Sand (1 of 8). Reward: 2 streak shields.', { timeout: 60_000 });
  await run(false);
  await expect(place).toHaveText(/^Gallery 20(3[6-9]|[4-9]\d)$/);
  // Thirty empty aisles past the last folder (one rack, so aisle 1 has it).
  await page.locator('#walk-goto').selectOption('storage');
  await expect(place).toHaveText(/^Storage room · Aisle 1$/);
  await page.getByRole('application', { name: /The Library in 3D/ }).focus();
  await page.keyboard.down('KeyW');
  await expect(place).toHaveText(/^Storage room · Aisle (1[5-9]|2[0-6])$/, { timeout: 80_000 });
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  await expect(toast(page)).not.toContainText('The last folder');
  await page.keyboard.down('KeyW');
  await expect(toast(page)).toContainText('🗂️ The last folder (2 of 8). New perk: Curious prompts.', { timeout: 60_000 });
  await page.keyboard.up('KeyW');
  await expect(place).toHaveText(/^Storage room · Aisle (3[1-9]|[4-9]\d)$/);
});

test('the last secret: the ✦ turns gold and three more shields', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('logbook.secrets', JSON.stringify({ found: { starstruck: '2026-10-01', sand: '2026-10-01', oldschool: '2026-10-01', spoton: '2026-10-01', knock: '2026-10-01', lastfolder: '2026-10-01', bookworm: '2026-10-01' }, shields: 0 })),
  );
  await page.goto('/#/search');
  await page.reload();
  await expect(page.locator('.brand-mark')).not.toHaveAttribute('data-gold');
  await page.getByRole('searchbox').fill('the answer to life, the universe and everything');
  await expect(toast(page)).toContainText('(8 of 8). Reward: 2 streak shields. That’s every secret: the ✦ by Logbook’s name turns gold, and you get 3 more streak shields.');
  await expect(page.locator('.brand-mark')).toHaveAttribute('data-gold', 'true');
  expect((await stored(page)).shields).toBe(5);
  await page.goto('/#/secrets');
  await expect(page.getByText('✦ You found every secret.')).toBeVisible();
});

test('a streak shield keeps a streak over a missed day, by itself, and only once', async ({ page }) => {
  const [d4, d3, d2] = [await day(page, -4), await day(page, -3), await day(page, -2)];
  await write(page, d4, 'One', 30);
  await write(page, d3, 'Two', 30);
  await write(page, d2, 'Three', 30);
  // Nothing yesterday: the streak is broken, with no shields.
  await page.goto('/');
  await expect(streak(page)).toHaveText('0');
  await page.evaluate(() => localStorage.setItem('logbook.secrets', JSON.stringify({ shields: 1 })));
  await page.reload();
  await expect(toast(page)).toContainText('🛡️ A streak shield kept your 3-day streak going over the day you missed. No shields left.');
  await expect(streak(page)).toHaveText('3');
  const yesterday = await day(page, -1);
  expect(await stored(page)).toMatchObject({ shields: 0, shielded: [yesterday] });
  // Once only.
  await page.reload();
  await expect(streak(page)).toHaveText('3');
  await expect(toast(page)).not.toContainText('streak shield kept');
  // Writing today carries it on.
  await write(page, await day(page, 0), 'Four', 30);
  await page.goto('/');
  await expect(streak(page)).toHaveText('4');
});

test('not enough shields for every day missed: none are used', async ({ page }) => {
  await write(page, await day(page, -5), 'One', 30);
  await write(page, await day(page, -4), 'Two', 30);
  await page.evaluate(() => localStorage.setItem('logbook.secrets', JSON.stringify({ shields: 2 })));
  await page.goto('/');
  await page.reload();
  await expect(streak(page)).toHaveText('0');
  await page.waitForTimeout(500);
  await expect(toast(page)).not.toContainText('streak shield');
  expect((await stored(page)).shields).toBe(2);
});
