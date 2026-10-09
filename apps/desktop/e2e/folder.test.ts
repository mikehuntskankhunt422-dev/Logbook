import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './driver.ts';
import { tree } from './files.ts';

const folder = mkdtempSync(join(tmpdir(), 'logbook-desktop-'));
after(() => rmSync(folder, { recursive: true, force: true }));

describe('the desktop app keeps the journal in a folder (M5 slice B)', () => {
  it('writes a new entry as a dated, readable file in the folder', async () => {
    const app = await launch(folder);
    try {
      await app.text('Your logbook is empty');
      assert.deepEqual(tree(folder), ['logbook.json']);
      await app.go('#/new');
      await app.type(await app.$('#entry-title'), 'Desktop day');
      const body = await app.$('[aria-label="Entry text"]');
      await app.click(body);
      await app.type(body, 'Written in the desktop app.');
      await app.text('Saved on this device');
      const files = tree(folder);
      const entry = files.find((f) => /^entries\/\d{4}\/\d{4}-\d\d-\d\d--desktop-day--[0-9a-z]+\.json$/.test(f));
      assert.ok(entry, `no entry file in ${files.join(', ')}`);
      const json = JSON.parse(readFileSync(join(folder, entry), 'utf8')) as { title: string; blocks: unknown[] };
      assert.equal(json.title, 'Desktop day');
      assert.match(JSON.stringify(json.blocks), /Written in the desktop app\./);
      assert.deepEqual(files.filter((f) => f.includes('~lb-')), []);
    } finally {
      await app.close();
    }
  });

  it('opens the same folder again and shows where the journal is', async () => {
    const app = await launch(folder);
    try {
      await app.text('Desktop day');
      await app.go('#/settings');
      await app.text('Journal folder');
      const shown = await app.exec<string>('return document.querySelector("#folder-h + p code").textContent');
      assert.equal(shown, folder);
    } finally {
      await app.close();
    }
  });
});
