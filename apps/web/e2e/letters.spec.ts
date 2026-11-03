import { expect, test } from '@playwright/test';

// Letters to your future self (D122): written and sealed; only the envelope shows, search doesn't
// look inside, the Library's book wears a seal; it can be broken early; on its day, it opens.

test('a letter to your future self: sealed, its words out of sight, until the seal is broken', async ({ page }) => {
  await page.goto('/#/new?date=2026-06-01');
  await page.getByLabel('Title').fill('Groceries');
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText('bread and milk');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.goto('/#/');
  await page.getByRole('link', { name: '✉️ Letter to future me' }).click();
  // A new letter: a title to start, sealed for a year, the seal's choices open.
  await expect(page.getByLabel('Title')).toHaveValue('Dear future me');
  const seal = page.getByRole('group', { name: 'Letter to your future self' });
  await expect(seal).toContainText('Sealed until');
  await seal.getByRole('button', { name: 'In five years' }).click();
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText('I hope you kept writing. Marmalade.');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  // Still writing: the words are there to finish.
  await expect(page.getByText(/A letter to your future self, sealed until/)).toBeVisible();
  // In the journal: the envelope only.
  await page.goto('/#/');
  const card = page.getByRole('link', { name: /^Dear future me, .*a letter sealed until/ });
  await expect(card).toContainText('📜 Opens');
  await expect(card).toContainText('A letter to your future self, sealed until its day.');
  await expect(card).not.toContainText('Marmalade');
  // Search can't see inside it.
  await page.goto('/#/search');
  await page.getByRole('searchbox').fill('marmalade');
  await expect(page.getByText('0 results')).toBeVisible();
  await page.getByRole('searchbox').fill('future');
  await expect(page.getByRole('link', { name: /^Dear future me/ })).toBeVisible();
  // On the Library's shelves: a sealed book, whose reader shows the envelope.
  await page.goto('/#/library/shelves');
  const book = page.getByRole('button', { name: /^Dear future me, .*a letter sealed until/ });
  await expect(book).toHaveAttribute('data-sealed', '');
  await book.click();
  const reader = page.getByRole('dialog', { name: '📖 Dear future me' });
  await expect(reader.locator('.reader-flow')).toContainText('Sealed until');
  await expect(reader.locator('.reader-flow')).not.toContainText('Marmalade');
  await reader.getByRole('link', { name: 'Open in the editor' }).click();
  // Opened: the envelope, and the seal to break.
  const letter = page.getByRole('region', { name: 'Dear future me' });
  await expect(letter).toContainText('It opens by itself that day.');
  await expect(page.getByRole('textbox', { name: 'Entry text' })).toHaveCount(0);
  await letter.getByRole('button', { name: 'Break the seal early…' }).click();
  await letter.getByRole('button', { name: 'Break the seal' }).click();
  await expect(page.getByRole('textbox', { name: 'Entry text' })).toContainText('Marmalade');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: /^Dear future me/ })).toContainText('Marmalade');
});

test('on its day, a letter opens, and Logbook says so once', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T09:00:00') });
  await page.goto('/#/new?letter=1');
  await page.getByRole('group', { name: 'Letter to your future self' }).getByRole('button', { name: 'In a month' }).click();
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText('Did the move go well?');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: /^Dear future me/ })).toContainText('📜 Opens');
  // A month and a bit later.
  await page.clock.setFixedTime(new Date('2026-12-05T09:00:00'));
  await page.reload();
  await expect(page.getByText(/A letter you wrote to yourself on .* has opened: “Dear future me”\./)).toBeVisible();
  await expect(page.getByRole('link', { name: /^Dear future me/ })).toContainText('Did the move go well?');
  await page.getByRole('button', { name: 'Read it' }).click();
  await expect(page.getByRole('textbox', { name: 'Entry text' })).toContainText('Did the move go well?');
  // Said once.
  await page.goto('/#/');
  await page.reload();
  await expect(page.getByRole('link', { name: /^Dear future me/ })).toBeVisible();
  await expect(page.getByText(/has opened/)).toHaveCount(0);
});
