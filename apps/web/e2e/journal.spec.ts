import { expect, test } from '@playwright/test';
import { png, writeEntry } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  // Confetti is decorative; reduced motion also proves the app works with animations off.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('write an entry with rich text and photos, and it survives a reload', async ({ page }) => {
  await writeEntry(page, 'Beach day', 'Swam at Glenelg. ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Best day');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' see https://example.com/tide ');

  await page.getByTestId('photo-input').setInputFiles([
    { name: 'sunset.png', mimeType: 'image/png', buffer: png([250, 120, 60]) },
    { name: 'sand.png', mimeType: 'image/png', buffer: png([240, 210, 150]) },
  ]);
  await expect(page.getByRole('img', { name: 'Photo 1' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Photo 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Mood 😄' }).click();
  await page.getByLabel('Add a tag').fill('summer');
  await page.getByLabel('Add a tag').press('Enter');
  await expect(page.getByText('Saved on this device')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Title')).toHaveValue('Beach day');
  const editor = page.getByRole('textbox', { name: 'Entry text' });
  await expect(editor.locator('strong')).toHaveText('Best day');
  await expect(editor.locator('a[href="https://example.com/tide"]')).toBeVisible(); // autolinked
  await expect(page.getByRole('img', { name: 'Photo 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove tag summer' })).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('link', { name: /Beach day/ })).toBeVisible();
});

test('blocks can be reordered with the keyboard and the menu', async ({ page }) => {
  await writeEntry(page, 'Order test', 'first block');
  await page.getByRole('button', { name: /Link or YouTube/ }).click();
  await page.getByLabel('Web address').fill('https://youtu.be/dQw4w9WgXcQ');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Video link block 2 of 2' })).toBeVisible();

  // Keyboard drag: focus the handle, space to lift, arrow up, space to drop.
  // Keyboard: focus the handle, space to lift, arrow up, space to drop. Focus follows the block.
  await page.getByRole('button', { name: 'Drag to reorder Video link block 2 of 2' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByText(/Picked up Video link block/)).toBeAttached();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(page.getByRole('region', { name: 'Video link block 1 of 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Drag to reorder Video link block 1 of 2' })).toBeFocused();

  // Escape cancels a move.
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('region', { name: 'Video link block 2 of 2' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Video link block 1 of 2' })).toBeVisible();

  // Menu fallback: move it back down.
  await page.getByRole('button', { name: 'More actions for Video link block 1 of 2' }).click();
  await page.getByRole('menuitem', { name: '↓ Move down' }).click();
  await expect(page.getByRole('region', { name: 'Text block 1 of 2' })).toBeVisible();
  await expect(page.getByText('Saved on this device')).toBeVisible();
});

test('search, tags, calendar and on-this-day find past entries', async ({ page }) => {
  await writeEntry(page, 'Kangaroo Island trip', 'Saw sea lions at Seal Bay.');
  const lastYear = new Date();
  lastYear.setFullYear(lastYear.getFullYear() - 1);
  const iso = `${lastYear.getFullYear()}-${String(lastYear.getMonth() + 1).padStart(2, '0')}-${String(lastYear.getDate()).padStart(2, '0')}`;
  await page.getByLabel('Date').fill(iso);
  await expect(page.getByText('Saved on this device')).toBeVisible();

  await page.goto('/#/search');
  await page.getByLabel('Search your journal').fill('sea lion');
  await expect(page.getByRole('link', { name: /Kangaroo Island trip/ })).toBeVisible();
  await expect(page.getByText('1 result')).toBeVisible();

  await page.goto('/#/memories');
  await expect(page.getByRole('heading', { name: /A year ago/ })).toBeVisible();

  await page.goto(`/#/calendar?month=${iso.slice(0, 7)}`);
  await page.getByRole('button', { name: new RegExp(`${lastYear.getDate()}.*1 entry`) }).first().click();
  await expect(page.getByRole('link', { name: /Kangaroo Island trip/ })).toBeVisible();
});

test('backup: download a zip, wipe the journal, restore it', async ({ page }) => {
  await writeEntry(page, 'Keep me safe', 'Important memory.');
  await page.getByTestId('photo-input').setInputFiles([{ name: 'keep.png', mimeType: 'image/png', buffer: png() }]);
  await expect(page.getByRole('img', { name: 'keep.png' })).toBeVisible();
  await expect(page.getByText('Saved on this device')).toBeVisible();

  await page.goto('/#/settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download backup/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^logbook-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
  const zipPath = await download.path();

  await page.getByRole('button', { name: 'Delete all entries…' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete everything', exact: true }).click();
  await expect(page.getByText('Everything was deleted from this device.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your logbook is empty' })).toBeVisible();

  await page.goto('/#/settings');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Restore from backup/ }).click();
  await (await chooser).setFiles(zipPath);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText(/Imported 1 new/)).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: /Keep me safe/ }).click();
  await expect(page.getByRole('img', { name: 'keep.png' })).toBeVisible();
});

test('passcode lock encrypts, locks, rejects a wrong passcode and unlocks', async ({ page }) => {
  await writeEntry(page, 'Secret plans', 'Surprise party for Sam.');
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Set a passcode' }).click();
  await expect(page.getByText('A forgotten passcode cannot be recovered.')).toBeVisible();
  await page.getByLabel('New passcode').fill('purple-otter-42');
  await page.getByLabel('Type it again').fill('purple-otter-42');
  const save = page.getByRole('button', { name: 'Save passcode' });
  await expect(save).toBeDisabled(); // must acknowledge the trade-off first
  await page.getByLabel(/I understand a forgotten passcode/).check();
  await save.click();
  await expect(page.getByText(/Your journal is encrypted on this device/).first()).toBeVisible();

  // Nothing readable at rest: inspect IndexedDB directly.
  const raw = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('logbook');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all = await new Promise<unknown[]>((res) => {
      const r = db.transaction('entries').objectStore('entries').getAll();
      r.onsuccess = () => res(r.result);
    });
    return JSON.stringify(all);
  });
  expect(raw).not.toContain('Secret plans');
  expect(raw).not.toContain('Surprise party');

  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByRole('heading', { name: 'Logbook is locked' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Logbook is locked' })).toBeVisible();
  await page.getByLabel('Passcode').fill('wrong-passcode');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('That passcode is not right.');
  await page.getByLabel('Passcode').fill('purple-otter-42');
  await page.getByRole('button', { name: 'Unlock' }).click();
  // Unlocking returns you to where you were (Settings). A reload would lock again, so use the nav.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal' }).click();
  await expect(page.getByRole('link', { name: /Secret plans/ })).toBeVisible();
});

test('works offline after the first visit (service worker)', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await writeEntry(page, 'Written online', 'hello');

  await context.setOffline(true);
  await page.goto('/');
  await page.reload();
  await expect(page.getByRole('link', { name: /Written online/ })).toBeVisible();
  await page.goto('/#/new');
  await page.getByLabel('Title').fill('Written offline');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await context.setOffline(false);
});

test('theme switch applies and persists', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
