import { expect, test, type Page } from '@playwright/test';

// The Library (D112): every entry a book, as thick as the entry is long, in its mood's colour, on
// its month's shelf in its year's gallery; empty shelves past the newest book, as far as anyone
// scrolls.

const text = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 40}`).join(' ');

async function write(page: Page, date: string, title: string, words: number, mood?: string) {
  await page.goto(`/#/new?date=${date}`);
  await page.getByLabel('Title').fill(title);
  if (mood) await page.getByRole('button', { name: `Mood ${mood}` }).click();
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText(text(words));
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect(page).toHaveURL(/#\/entry\//);
}

const book = (page: Page, title: string) => page.getByRole('link', { name: new RegExp(`^${title}, `) });
const box = async (page: Page, title: string) => (await book(page, title).boundingBox())!;

test('every entry is a book: as thick as it is long, in its mood’s colour, on its month’s shelf in its year’s gallery', async ({ page }) => {
  await write(page, '2025-12-31', 'Last of the year', 10);
  await write(page, '2026-01-02', 'A long one', 2000, '😄');
  await write(page, '2026-01-03', 'Short', 5);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '📚 Library' })).toBeVisible();
  // Titles count: 4 + 10, 3 + 2,000 and 1 + 5 words.
  await expect(page.locator('.library-count')).toHaveText('3 books · 2,023 words');
  await expect(page.getByRole('heading', { level: 2, name: 'Gallery 2025' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Gallery 2026' })).toBeVisible();
  const january = page.getByRole('list', { name: 'January 2026: 2 books' });
  await expect(january.getByRole('link')).toHaveCount(2);
  // Each book says what it is: its title, its day and its length.
  await expect(january.getByRole('link').first()).toHaveAccessibleName(/^A long one, .*2026, 2,003 words$/);
  await expect(book(page, 'Short')).toHaveAccessibleName(/^Short, .*2026, 6 words$/);
  await expect(book(page, 'A long one')).toHaveAttribute('data-mood', '0');
  await expect(book(page, 'Short')).not.toHaveAttribute('data-mood');
  const long = await box(page, 'A long one');
  const short = await box(page, 'Short');
  expect(long.width).toBeGreaterThan(short.width + 15);
  expect(long.height).toBeGreaterThan(short.height);
  expect(short.width).toBeGreaterThanOrEqual(24);
  // A book opens its entry; back again, it's where it was on the shelf.
  await book(page, 'Short').click();
  await expect(page).toHaveURL(/#\/entry\//);
  await expect(page.getByLabel('Title')).toHaveValue('Short');
  await page.goBack();
  await expect(book(page, 'Short')).toBeFocused();
  await expect(book(page, 'Short')).toBeInViewport();
});

test('go to a month, or to the newest book, with the focus there', async ({ page }) => {
  await write(page, '2024-02-10', 'Long ago', 20);
  await write(page, '2025-07-04', 'Summer', 20);
  await write(page, '2026-10-01', 'Lately', 20);
  await page.goto('/#/library');
  const month = page.getByLabel('Month');
  // The newest month to start with.
  await expect(month).toHaveValue('2026-10');
  await month.selectOption({ label: 'February 2024' });
  await page.getByRole('button', { name: 'Go to it' }).click();
  const february = page.getByRole('heading', { level: 3, name: 'February 2024: 1 book' });
  await expect(february).toBeFocused();
  await expect(february).toBeInViewport();
  await page.getByRole('button', { name: 'Newest book', exact: true }).click();
  await expect(book(page, 'Lately')).toBeFocused();
  await expect(book(page, 'Lately')).toBeInViewport();
});

test('the empty shelves go on as far as you scroll, and lead back to the newest book', async ({ page }) => {
  await write(page, '2026-10-01', 'Only one', 20);
  await page.goto('/#/library');
  await expect(page.getByText('Empty shelves, as far as you go, for everything you’ll write.')).toBeVisible();
  const height = () => page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i < 3; i++) {
    const before = await height();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(height).toBeGreaterThan(before);
  }
  const back = page.getByRole('button', { name: '↑ Back to your newest book' });
  await expect(back).toBeInViewport();
  await back.click();
  await expect(book(page, 'Only one')).toBeFocused();
  await expect(book(page, 'Only one')).toBeInViewport();
});

test('an empty library, then a book for an entry, gone with it to the trash', async ({ page }) => {
  await page.goto('/#/library');
  await expect(page.getByText('No books yet. Write an entry and its book takes the first place on these shelves.')).toBeVisible();
  await expect(page.getByRole('button', { name: /newest book/i })).toHaveCount(0);
  await write(page, '2026-10-01', 'Brief', 3);
  await page.goto('/#/library');
  await expect(page.locator('.library-count')).toHaveText('1 book · 4 words');
  await book(page, 'Brief').click();
  await page.getByRole('button', { name: '🗑 Delete' }).click();
  await expect(page.getByText('Moved to trash.')).toBeVisible();
  await page.goto('/#/library');
  await expect(page.getByText(/^No books yet/)).toBeVisible();
  await expect(page.getByRole('link', { name: /^Brief, / })).toHaveCount(0);
});

test('the menu, with the Library, fits the screen at every width', async ({ page }) => {
  await write(page, '2026-10-01', 'Menu check', 3);
  for (const width of [320, 360, 412, 700, 1000, 1120, 1121, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/#/library');
    await expect(page.getByRole('heading', { level: 1, name: '📚 Library' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `no sideways scrolling at ${width}px`).toBeLessThanOrEqual(width);
    for (const link of await page.getByRole('navigation', { name: 'Main' }).getByRole('link').all()) {
      const b = (await link.boundingBox())!;
      expect(b.x, `${await link.getAttribute('title')} at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${await link.getAttribute('title')} at ${width}px`).toBeLessThanOrEqual(width);
    }
  }
});
