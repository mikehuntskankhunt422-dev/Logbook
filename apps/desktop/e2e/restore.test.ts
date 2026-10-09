import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Journal, MemoryStore, emptyDoc, exportBackup } from '../../../packages/core/src/index.ts';
import { launch } from './driver.ts';
import { tree } from './files.ts';

/** 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** A backup as the website makes it: two entries, one with a photo; encrypted when given a passcode. */
async function websiteBackup(passcode?: string): Promise<string> {
  const web = await Journal.open(new MemoryStore());
  const photo = await web.addMedia(new Blob([PNG], { type: 'image/png' }), { name: 'lighthouse.png', width: 1, height: 1 });
  await web.saveEntry(web.newEntry({ date: '2026-09-20', title: 'Lighthouse', blocks: [{ id: 't', type: 'text', doc: emptyDoc('Climbed all 212 steps.') }, { id: 'p', type: 'photo', mediaId: photo.id, caption: '' }] }));
  await web.saveEntry(web.newEntry({ date: '2026-09-21', title: 'Rainy Sunday', blocks: [{ id: 't', type: 'text', doc: emptyDoc('Soup and a long book.') }] }));
  if (passcode) await web.enableEncryption(passcode, { alg: 'argon2id', memoryKiB: 1024, iterations: 1, parallelism: 1 });
  const path = join(mkdtempSync(join(tmpdir(), 'logbook-backup-')), 'logbook-backup-2026-09-22-1200.zip');
  writeFileSync(path, new Uint8Array(await (await exportBackup(web, { app: 'logbook-web test', keepEncrypted: Boolean(passcode) })).arrayBuffer()));
  return path;
}

describe('a website backup restores into the desktop folder (M5 slice D)', () => {
  const folder = mkdtempSync(join(tmpdir(), 'logbook-restore-'));
  after(() => rmSync(folder, { recursive: true, force: true }));

  it('restores from Settings, writing the entries and the photo into the folder', async () => {
    const zip = await websiteBackup();
    const app = await launch(folder);
    try {
      await app.text('Your logbook is empty');
      await app.go('#/settings');
      await app.text('Restore from backup');
      await app.type(await app.$('[data-testid="restore-input"]'), zip);
      await app.text('Restore from backup', 5000);
      await app.click(await app.$('dialog[open] .dialog-actions .btn-primary'));
      await app.text('Imported 2 new and 0 updated entries, 1 media files.');
      await app.go('#/');
      await app.text('Rainy Sunday');
      await app.text('Lighthouse');
    } finally {
      await app.close();
    }
    const files = tree(folder);
    assert.ok(files.some((f) => /^entries\/2026\/2026-09-20--lighthouse--[0-9a-z]{12}\.json$/.test(f)), files.join(', '));
    assert.ok(files.some((f) => /^entries\/2026\/2026-09-21--rainy-sunday--[0-9a-z]{12}\.json$/.test(f)));
    const png = files.find((f) => /^media\/[0-9a-z]{2}\/[0-9a-z]{12}\.png$/.test(f));
    assert.ok(png, 'the photo is in the media folder under its own type');
    assert.deepEqual(readFileSync(join(folder, png)), PNG);
  });

  it('starts from an encrypted backup on first run: asks its passcode before choosing a folder', async () => {
    const zip = await websiteBackup('harbour lights');
    const app = await launch(null);
    try {
      await app.text('Where should your journal live?');
      await app.type(await app.$('[data-testid="welcome-backup-input"]'), zip);
      await app.text('This backup is encrypted');
      const go = await app.text('Choose a folder and restore…');
      assert.equal(await app.exec<boolean>('return arguments[0].disabled', { 'element-6066-11e4-a52e-4f735466cecf': go }), true);
      await app.type(await app.$('#backup-pass'), 'harbour lights');
      assert.equal(await app.exec<boolean>('return arguments[0].disabled', { 'element-6066-11e4-a52e-4f735466cecf': go }), false);
      // The next click opens the system's folder dialog, which WebDriver can't drive.
    } finally {
      await app.close();
    }
  });
});
