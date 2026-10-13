import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { writeEntry } from './helpers.ts';

// Expiring entries, background music and the export buttons on the entry and journal pages (D91).

test('an entry set to expire goes to the trash when its time comes, and can be restored', async ({ page }) => {
  await page.clock.install();
  await writeEntry(page, 'Secret plans', 'Nobody needs to see this next week.');
  await page.getByRole('button', { name: '⏳ Expiry' }).click();
  await page.getByRole('group', { name: 'Expiry' }).getByRole('button', { name: 'In a day' }).click();
  await expect(page.locator('.hero-expiry')).toContainText('Expires');
  await page.waitForTimeout(1500);
  await expect(page.getByText('Saved on this device')).toBeVisible();

  // On the journal page, with a note of when; then a day later it's gone.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal' }).click();
  await expect(page.locator('.entry-expiry-chip')).toContainText('Expires in');
  await page.clock.fastForward('25:00:00');
  await expect(page.getByText('Secret plans')).toHaveCount(0);

  // In the trash, from where it comes back without its (passed) expiry.
  await page.goto('/#/settings');
  const trash = page.getByRole('region', { name: 'Recently deleted' });
  await expect(trash).toContainText('Secret plans');
  await trash.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal' }).click();
  await expect(page.getByText('Secret plans')).toBeVisible();
  await expect(page.locator('.entry-expiry-chip')).toHaveCount(0);
});

test('background music, and exporting from the entry and the journal page', async ({ page }) => {
  await writeEntry(page, 'Beach', 'Waves all day');
  await page.getByRole('button', { name: '🎵 Music' }).click();
  const bar = page.getByRole('group', { name: 'Background music' });
  await bar.locator('input[type=file]').setInputFiles({ name: 'waves.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(bar.getByText('🎵 waves.wav')).toBeVisible();
  await expect(bar.getByRole('button', { name: /the music$/ })).toBeEnabled();
  await page.waitForTimeout(1500);
  await expect(page.getByText('Saved on this device')).toBeVisible();

  // Still there after a reload.
  await page.reload();
  await expect(bar.getByText('🎵 waves.wav')).toBeVisible();

  // The entry's own export: Markdown with the music beside it.
  await page.getByRole('button', { name: '⬇️ Export' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export this entry' });
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /Download 1 entry/ }).click();
  const files = unzipSync(new Uint8Array(await readFile((await (await pending).path())!)));
  const md = strFromU8(Object.entries(files).find(([n]) => n.endsWith('.md'))![1]);
  expect(md).toContain('*Background music*');
  expect(Object.keys(files).some((n) => n.endsWith('waves.wav'))).toBe(true);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  // And the journal page's, for every entry.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal' }).click();
  await page.getByRole('button', { name: '⬇️ Export' }).click();
  await expect(page.getByRole('dialog', { name: 'Export your journal' }).getByRole('button', { name: /Download 1 entry/ })).toBeVisible();
});

/** A quarter of a second of silence, as a WAV file. */
function wav(): Buffer {
  const rate = 8000;
  const samples = rate / 4;
  const b = Buffer.alloc(44 + samples);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples, 40);
  b.fill(128, 44);
  return b;
}
