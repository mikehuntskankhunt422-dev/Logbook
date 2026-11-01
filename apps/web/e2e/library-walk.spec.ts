import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { png } from './helpers.ts';

// The Library you walk through (D113): galleries a year each, for good; the storage room behind
// the first gallery; books and folders to read like books.

const text = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 40}`).join(' ');

async function write(page: Page, date: string, title: string, words: number) {
  await page.goto(`/#/new?date=${date}`);
  await page.getByLabel('Title').fill(title);
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText(text(words));
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect(page).toHaveURL(/#\/entry\//);
}

const place = (page: Page) => page.locator('.walk-place strong');
const world = (page: Page) => page.getByRole('application', { name: /The Library in 3D/ });
/** Holds keys down for a while, as someone walking would. */
async function hold(page: Page, keys: string[], ms: number) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}

async function open(page: Page, path = '/#/library') {
  await page.evaluate(() => localStorage.setItem('logbook.walk.help', 'seen'));
  await page.goto(path);
  await expect(place(page)).not.toBeEmpty({ timeout: 20_000 });
  await expect(world(page)).toBeFocused();
}

test('walk from gallery to gallery, a year in each, then on into empty ones for the years to come, and back to the storage room', async ({ page }) => {
  await write(page, '2025-06-01', 'Last year', 30);
  await write(page, '2026-06-01', 'This year', 30);
  await page.evaluate(() => localStorage.removeItem('logbook.walk.help'));
  await page.goto('/#/library');
  // How to walk, the first time; then out of the way.
  const help = page.getByRole('note');
  await expect(help).toContainText('W A S D');
  await help.getByRole('button', { name: 'Got it' }).click();
  await expect(help).toHaveCount(0);
  await expect(world(page)).toBeFocused();
  await expect(place(page)).toHaveText('Gallery 2025');
  await expect(page.locator('.walk-place')).toContainText('1 book · Jun 2025');
  // Forward, through the doorway.
  await hold(page, ['KeyW'], 3500);
  await expect(place(page)).toHaveText('Gallery 2026');
  // Hurrying on: past the books, empty galleries for the years to come.
  await hold(page, ['ShiftLeft', 'KeyW'], 5000);
  await expect(place(page)).toHaveText(/^Gallery 20(2[89]|[3-9]\d)$/);
  await expect(page.locator('.walk-place')).toContainText('Empty shelves, for what’s to come');
  // Back to the start, then backwards through its back door, down the corridor, into the storage room.
  await page.locator('#walk-goto').selectOption('library');
  await expect(place(page)).toHaveText('Gallery 2025');
  await hold(page, ['KeyS'], 4500);
  await expect(place(page)).toHaveText(/^Storage room · Aisle \d+$/);
});

test('walls and bookcases stop you: walking into one, you stay in the room', async ({ page }) => {
  await write(page, '2026-06-01', 'Here', 10);
  await open(page);
  await expect(place(page)).toHaveText('Gallery 2026');
  // Sideways into the bookcases for a long time: still in the same gallery, and still free to walk on.
  await hold(page, ['KeyA'], 3000);
  await expect(place(page)).toHaveText('Gallery 2026');
  await hold(page, ['KeyD'], 6000);
  await expect(place(page)).toHaveText('Gallery 2026');
  // Back in the middle, the way on is open.
  await page.locator('#walk-goto').selectOption('library');
  await world(page).focus();
  await hold(page, ['KeyW'], 3500);
  await expect(place(page)).toHaveText('Gallery 2027');
});

test('face a book, read it like a book: its title page, pages turning, back to where you stood', async ({ page }) => {
  await write(page, '2026-06-01', 'A long walk', 1800);
  await open(page);
  await page.getByRole('button', { name: 'Newest book' }).click();
  const target = page.locator('.walk-target');
  await expect(target).toContainText('📖 A long walk');
  await expect(target).toContainText('1,803 words');
  await expect(world(page)).toBeFocused();
  await page.keyboard.press('Enter');
  const reader = page.getByRole('dialog', { name: '📖 A long walk' });
  await expect(reader).toBeVisible();
  await expect(reader.locator('.reader-flow .lbx-title')).toHaveText('A long walk');
  const where = reader.locator('.reader-where');
  await expect(where).toHaveText(/^Pages? 1(–2)? of \d+$/);
  const pages = Number((await where.textContent())!.match(/of (\d+)/)![1]);
  expect(pages).toBeGreaterThan(3);
  await page.keyboard.press('ArrowRight');
  await expect(where).toHaveText(/^Pages? (2|3–4) of \d+$/);
  await reader.getByRole('button', { name: '‹ Previous page' }).click();
  await expect(where).toHaveText(/^Pages? 1(–2)? of \d+$/);
  await expect(reader.getByRole('button', { name: '‹ Previous page' })).toBeDisabled();
  await page.keyboard.press('End');
  await expect(where).toHaveText(new RegExp(`${pages} of ${pages}$`));
  await expect(reader.getByRole('button', { name: 'Next page ›' })).toBeDisabled();
  // Closed, you're where you stood, still facing it.
  await page.keyboard.press('Escape');
  await expect(reader).toHaveCount(0);
  await expect(world(page)).toBeFocused();
  await expect(target).toContainText('📖 A long walk');
});

test('click a book to read it; in the storage room, a folder', async ({ page }) => {
  await write(page, '2026-06-01', 'Clicked', 40);
  await open(page);
  await page.getByRole('button', { name: 'Newest book' }).click();
  await expect(page.locator('.walk-target')).toContainText('Clicked');
  // What's in the middle of the view is what the button showed.
  await world(page).click();
  await expect(page.getByRole('dialog', { name: '📖 Clicked' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#walk-goto').selectOption('storage');
  await expect(place(page)).toHaveText('Storage room · Aisle 1');
  await page.getByRole('button', { name: 'Newest folder' }).click();
  await expect(page.locator('.walk-target')).toContainText('🗂️ Clicked');
  await page.getByRole('button', { name: 'Read it' }).click();
  const folder = page.getByRole('dialog', { name: '🗂️ Clicked' });
  await expect(folder).toBeVisible();
  await expect(folder.locator('.reader-flow')).toContainText('word0 word1');
  await folder.getByRole('button', { name: 'Close' }).click();
  await expect(folder).toHaveCount(0);
});

test('the storage room has its own address, and the Library remembers where you were', async ({ page }) => {
  await write(page, '2026-06-01', 'Remembered', 10);
  await open(page, '/#/library/storage');
  await expect(place(page)).toHaveText('Storage room · Aisle 1');
  await page.locator('#walk-goto').selectOption('library');
  await page.getByRole('button', { name: 'Newest book' }).click();
  await expect(page.locator('.walk-target')).toContainText('Remembered');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library' }).click();
  await expect(place(page)).toHaveText('Gallery 2026');
  await expect(page.locator('.walk-target')).toContainText('Remembered');
});

test('on a touch screen: the stick in the lower left walks, a tap reads', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch');
  await write(page, '2026-06-01', 'Tapped', 10);
  await open(page);
  const box = (await world(page).boundingBox())!;
  // A finger down in the lower left, pushed up: walking forward.
  const at = { x: box.x + box.width * 0.15, y: box.y + box.height * 0.8 };
  await world(page).dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: at.x, clientY: at.y });
  await expect(page.locator('.walk-stick')).toBeVisible();
  await world(page).dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: at.x, clientY: at.y - 60 });
  await page.waitForTimeout(3500);
  await world(page).dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: at.x, clientY: at.y - 60 });
  await expect(page.locator('.walk-stick')).toBeHidden();
  await expect(place(page)).toHaveText('Gallery 2027');
  await page.getByRole('button', { name: 'Newest book' }).click();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog', { name: '📖 Tapped' })).toBeVisible();
});

test('where 3D can’t be drawn, the shelves instead', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind.startsWith('webgl') ? null : get.call(this, kind as '2d', ...(rest as []));
    } as typeof get;
  });
  await write(page, '2026-06-01', 'Flat', 10);
  await page.goto('/#/library');
  await expect(page.getByText('This device can’t show the Library in 3D, so here are your shelves.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Flat, / })).toBeVisible();
  await expect(world(page)).toHaveCount(0);
});

test('a book with a photo reads with its picture, and the reader is accessible, as a book and as a folder', async ({ page }) => {
  await page.goto('/#/new?date=2026-06-01');
  await page.getByLabel('Title').fill('Pictured');
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText('A day at the sea.');
  await page.getByTestId('photo-input').setInputFiles([{ name: 'sea.png', mimeType: 'image/png', buffer: png() }]);
  await expect(page.getByRole('img', { name: 'sea.png' })).toBeVisible();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.goto('/#/library/shelves');
  await page.getByRole('button', { name: /^Pictured, / }).click();
  const book = page.getByRole('dialog', { name: '📖 Pictured' });
  const picture = book.locator('.reader-flow img');
  await expect(picture).toHaveCount(1);
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const scan = async () => (await new AxeBuilder({ page }).include('dialog.reader').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(await scan()).toEqual([]);
  await book.getByRole('button', { name: 'Close' }).click();
  await open(page, '/#/library/storage');
  await page.getByRole('button', { name: 'Newest folder' }).click();
  await page.getByRole('button', { name: 'Read it' }).click();
  const folder = page.getByRole('dialog', { name: '🗂️ Pictured' });
  await expect(folder.locator('.reader-flow img')).toHaveCount(1);
  expect(await scan()).toEqual([]);
});

test('no focus ring from the page’s own focusing, a click or a drag; one when Tab brings you in', async ({ page }) => {
  await write(page, '2026-06-01', 'Ringless', 10);
  await open(page);
  const walk = page.locator('.walk');
  const shadow = () => walk.evaluate((el) => getComputedStyle(el).boxShadow);
  await expect(walk).not.toHaveAttribute('data-ring');
  expect(await shadow()).toBe('none');
  // Dragging to look around.
  const b = (await world(page).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expect(walk).not.toHaveAttribute('data-ring');
  expect(await shadow()).toBe('none');
  // Coming in from the keyboard, it shows where the focus went; a click puts it away.
  await page.getByRole('link', { name: '📖 Encyclopedia' }).focus();
  await page.keyboard.press('Tab');
  await expect(world(page)).toBeFocused();
  await expect(walk).toHaveAttribute('data-ring', 'true');
  expect(await shadow()).not.toBe('none');
  await world(page).click({ position: { x: 20, y: b.height - 20 } });
  await expect(walk).not.toHaveAttribute('data-ring');
});

test('full screen: the Library over the whole window, still to walk and read in, and Escape back', async ({ page }) => {
  await write(page, '2026-06-01', 'Wide open', 400);
  await open(page);
  await page.getByRole('button', { name: 'Full screen' }).click();
  const walk = page.locator('.walk');
  await expect(walk).toHaveAttribute('data-full', 'true');
  const size = page.viewportSize()!;
  await expect.poll(async () => JSON.stringify(await walk.boundingBox())).toBe(JSON.stringify({ x: 0, y: 0, width: size.width, height: size.height }));
  await expect(world(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Leave full screen' })).toBeVisible();
  // Reading in full screen: the book over it, and Escape closes only the book.
  await page.getByRole('button', { name: 'Newest book' }).click();
  await page.keyboard.press('Enter');
  const reader = page.getByRole('dialog', { name: '📖 Wide open' });
  await expect(reader).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(reader).toHaveCount(0);
  await expect(walk).toHaveAttribute('data-full', 'true');
  // Walking on.
  await page.locator('#walk-goto').selectOption('library');
  await world(page).focus();
  await hold(page, ['KeyW'], 3500);
  await expect(place(page)).toHaveText('Gallery 2027');
  // Escape: back to the page.
  await page.keyboard.press('Escape');
  await expect(walk).not.toHaveAttribute('data-full');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible();
  // Off and straight back on: on, however the browser's own full screen catches up.
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.getByRole('button', { name: 'Leave full screen' }).click();
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(walk).toHaveAttribute('data-full', 'true');
  await page.waitForTimeout(500);
  await expect(walk).toHaveAttribute('data-full', 'true');
  await page.getByRole('button', { name: 'Leave full screen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  // Leaving the Library leaves full screen too.
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(walk).toHaveAttribute('data-full', 'true');
  await page.evaluate(() => (location.hash = '#/'));
  await expect(walk).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});
