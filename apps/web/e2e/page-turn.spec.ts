import { expect, test, type Page } from '@playwright/test';

// Pages that turn for real (D119): a book's leaf carries the words on both its sides, over the
// spine; a folder's sheet lifts over the top; a page can be dragged over, or let fall back.

const text = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 40}`).join(' ');

async function write(page: Page, date: string, title: string, words: number) {
  await page.goto(`/#/new?date=${date}`);
  await page.getByLabel('Title').fill(title);
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText(text(words));
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect(page).toHaveURL(/#\/entry\//);
}

async function openBook(page: Page) {
  await write(page, '2026-01-02', 'A long one', 2400);
  await page.goto('/#/library/shelves');
  await page.getByRole('button', { name: /^A long one, / }).click();
  const reader = page.getByRole('dialog', { name: '📖 A long one' });
  await expect(reader.locator('.reader-where')).toHaveText(/^Pages? 1(–2)? of \d+$/);
  return reader;
}

/** Clicks Next page and looks at the leaf the moment it starts to turn. */
const nextAndLook = (page: Page) =>
  page.evaluate(() => {
    const next = [...document.querySelectorAll<HTMLButtonElement>('dialog.reader .reader-nav button')].find((b) => b.textContent?.includes('Next page'))!;
    next.click();
    const leaf = document.querySelector<HTMLElement>('.reader-stage .reader-leaf');
    const words = (sel: string) => leaf?.querySelector(sel)?.textContent?.length ?? 0;
    return { leaf: Boolean(leaf), origin: leaf?.style.transformOrigin ?? '', front: words('.reader-face-front'), back: words('.reader-face-back'), turning: leaf?.getAnimations().length ?? 0 };
  });

test('a book’s page turns over with the words on it, and the next page under it', async ({ page }, info) => {
  const reader = await openBook(page);
  const spread = info.project.name === 'desktop-chromium';
  const look = await nextAndLook(page);
  expect(look.leaf).toBe(true);
  expect(look.turning).toBe(1);
  expect(look.front).toBeGreaterThan(100);
  // Two pages: the leaf's other side is the next left-hand page. One page: the back of the paper.
  if (spread) expect(look.back).toBeGreaterThan(100);
  else expect(look.back).toBe(0);
  expect(look.origin).toBe('left center');
  // Where it's going is said at once; the leaf lands and is gone.
  await expect(reader.locator('.reader-where')).toHaveText(spread ? /^Pages 3–4 of \d+$/ : /^Page 2 of \d+$/);
  await expect(page.locator('.reader-stage .reader-leaf')).toHaveCount(0);
  // Back: the leaf comes back over (from the left page's side, on two pages).
  await reader.getByRole('button', { name: '‹ Previous page' }).click();
  await expect(reader.locator('.reader-where')).toHaveText(/^Pages? 1(–2)? of \d+$/);
  await expect(page.locator('.reader-stage .reader-leaf')).toHaveCount(0);
  // Held down, the pages riffle: every press turns one, and they all land.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(reader.locator('.reader-where')).toHaveText(spread ? /^Pages 7–8 of \d+$/ : /^Page 4 of \d+$/);
  await expect(page.locator('.reader-stage .reader-leaf')).toHaveCount(0);
});

test('a page can be dragged over, or let fall back', async ({ page }) => {
  const reader = await openBook(page);
  const where = reader.locator('.reader-where');
  const before = await where.textContent();
  const paper = (await reader.locator('.reader-paper').boundingBox())!;
  const y = paper.y + paper.height / 2;
  // A little way, then let go: it falls back.
  await page.mouse.move(paper.x + paper.width * 0.9, y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(paper.x + paper.width * (0.9 - 0.04 * i), y);
  await expect(page.locator('.reader-stage .reader-leaf')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.reader-stage .reader-leaf')).toHaveCount(0);
  await expect(where).toHaveText(before!);
  // Most of the way: it turns over.
  await page.mouse.move(paper.x + paper.width * 0.9, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(paper.x + paper.width * (0.9 - 0.09 * i), y);
  const deg = await page.locator('.reader-stage .reader-leaf').evaluate((el) => Number(/-?[\d.]+/.exec(el.style.transform)?.[0]));
  expect(deg).toBeLessThan(-60);
  await page.mouse.up();
  await expect(where).not.toHaveText(before!);
  await expect(page.locator('.reader-stage .reader-leaf')).toHaveCount(0);
});

test('with reduced motion, pages change without turning', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reader = await openBook(page);
  const look = await nextAndLook(page);
  expect(look.leaf).toBe(false);
  await expect(reader.locator('.reader-where')).not.toHaveText(/^Pages? 1(–2)? of/);
});

test('a folder’s sheet lifts over the top', async ({ page }) => {
  await write(page, '2026-06-01', 'Filed long', 1600);
  await page.evaluate(() => localStorage.setItem('logbook.walk.help', 'seen'));
  await page.goto('/#/library/storage');
  await expect(page.locator('.walk-place strong')).toHaveText('Storage room · Aisle 1', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Newest folder' }).click();
  await page.getByRole('button', { name: 'Read it' }).click();
  const folder = page.getByRole('dialog', { name: '🗂️ Filed long' });
  await expect(folder.locator('.reader-where')).toHaveText(/^Page 1 of \d+$/);
  const look = await nextAndLook(page);
  expect(look.leaf).toBe(true);
  expect(look.origin).toBe('center top');
  expect(look.front).toBeGreaterThan(100);
  await expect(folder.locator('.reader-where')).toHaveText(/^Page 2 of \d+$/);
  await expect(page.locator('.reader-stage .reader-leaf')).toHaveCount(0);
  // Page sounds can be switched off in the Library's settings.
  await folder.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Library settings' }).click();
  await page.getByRole('checkbox', { name: /Page sounds/ }).uncheck();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('logbook.library')!).paper)).toBe(false);
});
