import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launch, type App } from './driver.ts';
import { entry, put, tree } from './files.ts';

/** Another computer's changes arrive while the app is open (M5 slice C, D82, D83). */
describe('the desktop app follows changes synced into its folder', () => {
  const folder = mkdtempSync(join(tmpdir(), 'logbook-sync-'));
  const a = entry('aaaa11112222', '2026-10-01', 'Morning walk', 'Saw two herons by the river.');
  const aPath = `entries/2026/2026-10-01--morning-walk--${a.id}.json`;
  let app: App;

  before(async () => {
    put(folder, 'logbook.json', { format: 'logbook', version: 1 });
    put(folder, aPath, a);
    app = await launch(folder);
    await app.text('Morning walk');
  });
  after(async () => {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it('shows an entry another computer added, without a restart', async () => {
    const b = entry('bbbb11112222', '2026-10-02', 'Market day', 'Bought figs.');
    put(folder, `entries/2026/2026-10-02--market-day--${b.id}.json`, b);
    await app.text('Market day', 8000);
  });

  it('shows an edit made on another computer', async () => {
    put(folder, aPath, { ...a, title: 'Morning walk', blocks: [{ ...a.blocks[0], doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saw three herons and a kingfisher.' }] }] } }], rev: 2 });
    await app.text('a kingfisher', 8000);
  });

  it('asks which version to keep when two computers changed one entry, and keeps the chosen one', async () => {
    const copy = `entries/2026/2026-10-01--morning-walk--${a.id} (Laptop's conflicted copy).json`;
    put(folder, copy, { ...a, title: 'Morning walk by the lake', rev: 2, updatedAt: '2026-10-03T08:00:00.000Z' });
    await app.text('An entry was changed on two computers at once', 8000);
    await app.click(await app.$('[aria-label="Sync conflicts"] button'));
    await app.text('Which version should Logbook keep?');
    await app.text('Morning walk by the lake');
    await app.click(await app.$('section[aria-label="Version 2"] button'));
    await app.text('every entry has one version again');
    assert.deepEqual(
      tree(folder).filter((p) => p.startsWith('entries/')),
      [`entries/2026/2026-10-01--morning-walk-by-the-lake--${a.id}.json`, `entries/2026/2026-10-02--market-day--bbbb11112222.json`],
    );
    assert.equal(JSON.parse(readFileSync(join(folder, `entries/2026/2026-10-01--morning-walk-by-the-lake--${a.id}.json`), 'utf8')).title, 'Morning walk by the lake');
  });

  it('can keep both versions as separate entries', async () => {
    const path = `entries/2026/2026-10-02--market-day--bbbb11112222.json`;
    const b = JSON.parse(readFileSync(join(folder, path), 'utf8'));
    put(folder, `entries/2026/2026-10-02--market-day--bbbb11112222-DESKTOP-PC.json`, { ...b, blocks: [{ ...b.blocks[0], doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bought figs and honey.' }] }] } }], rev: 5 });
    await app.click(await app.$('[aria-label="Sync conflicts"] button', 8000));
    await app.text('Bought figs and honey.');
    await app.click(await app.$('.conflict-dialog .dialog-actions .btn:last-child'));
    await app.text('Market day (other version)');
    const entries = tree(folder).filter((p) => p.startsWith('entries/'));
    assert.equal(entries.length, 3, entries.join(', '));
    assert.ok(entries.includes(path));
    assert.ok(entries.some((p) => /--market-day-other-version--[0-9a-z]{12}\.json$/.test(p)));
  });

  it('reopens the journal, locked, when another computer sets a passcode', async () => {
    // Only the vault's presence matters here: the app must stop using its unencrypted view at once.
    const vault = { v: 1, kdf: { alg: 'argon2id', memoryKiB: 1024, iterations: 1, parallelism: 1, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' }, wrappedKey: { iv: 'AAAAAAAAAAAAAAAA', data: 'AAAA' }, createdAt: '2026-10-09T00:00:00.000Z' };
    put(folder, 'logbook.json', { format: 'logbook', version: 1, vault });
    await app.text('passcode was changed on another computer', 8000);
    await app.text('Logbook is locked', 10_000);
  });
});
