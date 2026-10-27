import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
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

test('a video, GIF or photo in the music bar, shown while the entry is open (D106)', async ({ page }) => {
  await writeEntry(page, 'Rainy day', 'Stayed in');
  await page.getByRole('button', { name: '🎵 Music' }).click();
  const bar = page.getByRole('group', { name: 'Background music' });
  const file = bar.locator('input[type=file]');
  await expect(file).toHaveAttribute('accept', 'audio/*,video/*,image/*');

  // A video plays in view, with its own controls instead of Logbook's button.
  await file.setInputFiles({ name: 'rain.webm', mimeType: 'video/webm', buffer: await webm(page) });
  await expect(bar.getByText('🎬 rain.webm')).toBeVisible();
  const video = bar.locator('video[aria-label="rain.webm"]');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controls', '');
  await expect(bar.getByRole('button', { name: /the music$/ })).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(bar.locator('video[aria-label="rain.webm"]')).toBeVisible();

  // A GIF is shown in its place.
  await file.setInputFiles({ name: 'cat.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
  await expect(bar.getByText('🖼 cat.gif')).toBeVisible();
  await expect(bar.getByRole('img', { name: 'cat.gif' })).toBeVisible();
  await expect(bar.locator('video')).toHaveCount(0);

  // Anything else isn't taken, and the GIF stays.
  await file.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('notes.txt isn\'t a sound, video or picture Logbook can show.')).toBeVisible();
  await expect(bar.getByRole('img', { name: 'cat.gif' })).toBeVisible();
});

test('background music from a link: a site’s player, a stream, and saying when a link won’t play (D93)', async ({ page }) => {
  // Stand-ins for the sites: this test never reaches the real ones.
  await page.route('https://www.youtube-nocookie.com/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      // A player that says it won't play here, as YouTube does when embedding is off.
      body: `<p>YouTube player</p><script>addEventListener('message', (e) => { if (String(e.data).includes('listening')) parent.postMessage(JSON.stringify({ event: 'onError', info: 153 }), '*'); });</script>`,
    }),
  );
  await page.route('https://player.vimeo.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>Vimeo player</p>' }));
  await page.route('https://radio.example.org/**', (r) => r.fulfill({ contentType: 'audio/wav', body: wav() }));
  await page.route('https://rumble.com/api/**', (r) =>
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ html: '<iframe src="https://rumble.com/embed/v4abc12/?pub=4"></iframe>' }) }),
  );
  await page.route('https://rumble.com/embed/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>Rumble player</p>' }));

  await writeEntry(page, 'Study session', 'Notes');
  await page.getByRole('button', { name: '🎵 Music' }).click();
  const bar = page.getByRole('group', { name: 'Background music' });
  const paste = async (link: string) => {
    await bar.getByRole('button', { name: /link/i }).click();
    await bar.getByLabel('Link to music').fill(link);
    await bar.getByRole('button', { name: 'Play' }).click();
  };

  // Not a link.
  await bar.getByRole('button', { name: /Paste a link/ }).click();
  await bar.getByLabel('Link to music').fill('lofi girl');
  await bar.getByRole('button', { name: 'Play' }).click();
  await expect(bar.getByRole('alert')).toContainText('isn’t a web address');
  await bar.getByRole('button', { name: 'Cancel' }).click();

  // YouTube in its own player; when it won't play here, the bar says so and offers the link.
  await paste('https://www.youtube.com/live/jfKfPfyJRdk');
  await expect(bar.getByText('🎵 YouTube')).toBeVisible();
  await expect(bar.getByRole('status')).toContainText('YouTube won’t play this video inside Logbook');
  await expect(bar.getByRole('link', { name: /Open it in your browser/ })).toHaveAttribute('href', 'https://www.youtube.com/live/jfKfPfyJRdk');

  // Vimeo's player, visible.
  await paste('vimeo.com/76979871');
  const frame = bar.locator('iframe[title="Vimeo player"]');
  await expect(frame).toBeVisible();
  expect(await frame.getAttribute('src')).toBe('https://player.vimeo.com/video/76979871?dnt=1&loop=1&autoplay=1');
  expect((await frame.boundingBox())!.height).toBeGreaterThanOrEqual(199);

  // A Rumble page, its player looked up.
  await paste('https://rumble.com/v4l0q8g-some-video.html');
  await expect(bar.locator('iframe[title="Rumble player"]')).toHaveAttribute('src', 'https://rumble.com/embed/v4abc12/?autoplay=1');

  // A radio stream plays like a sound file, with Logbook's own button.
  await paste('https://radio.example.org/stream');
  await expect(bar.getByText('🎵 radio.example.org')).toBeVisible();
  await expect(bar.getByRole('button', { name: /the music$/ })).toBeEnabled();
  await page.waitForTimeout(1500);

  // Kept after a reload.
  await page.reload();
  await expect(bar.getByText('🎵 radio.example.org')).toBeVisible();
  await bar.getByRole('button', { name: 'Remove' }).click();
  await expect(bar).toBeHidden();
});

test('a writing prompt on a new entry: another, write about it, or turn them off (D94)', async ({ page }) => {
  await page.goto('/#/new');
  const card = page.getByRole('group', { name: 'Writing prompt' });
  const first = await card.locator('.prompt-text').innerText();
  await card.getByRole('button', { name: /Another/ }).click();
  await expect(card.locator('.prompt-text')).not.toHaveText(first);
  const question = (await card.locator('.prompt-text').innerText()).replace(/^💭\s*/u, '');
  await card.getByRole('button', { name: 'Write about this' }).click();
  // The question heads the text, the cursor below it, and the card goes.
  const editor = page.getByRole('textbox', { name: 'Entry text' });
  await expect(editor.locator('h2')).toHaveText(question);
  await expect(card).toBeHidden();
  await page.keyboard.type('Mostly the sunshine.');
  await expect(editor.locator('p').last()).toHaveText('Mostly the sunshine.');

  // Off in Settings: new entries start blank.
  await page.goto('/#/settings');
  await page.getByRole('checkbox', { name: /writing prompt/ }).uncheck();
  await page.goto('/#/new');
  await expect(page.getByRole('textbox', { name: 'Entry text' })).toBeVisible();
  await expect(card).toHaveCount(0);
});

/** Half a second of video, recorded from a canvas in the page, as a WebM file. */
async function webm(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 48 });
    const ctx = canvas.getContext('2d')!;
    const recorder = new MediaRecorder(canvas.captureStream(10), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `hsl(${i * 60} 80% 50%)`;
      ctx.fillRect(0, 0, 64, 48);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    await stopped;
    let bytes = '';
    for (const b of new Uint8Array(await new Blob(chunks).arrayBuffer())) bytes += String.fromCharCode(b);
    return btoa(bytes);
  });
  return Buffer.from(base64, 'base64');
}

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
