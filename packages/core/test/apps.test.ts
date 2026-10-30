import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { APP_MAX_DATA, appCodeKind, appDataId, appDocument, appNameFrom, readAppMessage } from '../src/apps.ts';
import { Journal } from '../src/journal.ts';
import { emptyDoc } from '../src/richtext.ts';
import { MemoryStore } from '../src/storage.ts';
import { FAST_KDF } from './helpers.ts';

describe('your own apps (D111)', () => {
  it('tells pages, plain JavaScript and React apart', () => {
    expect(appCodeKind('<!doctype html><title>x</title>')).toBe('html');
    expect(appCodeKind('﻿  <div>hi</div>')).toBe('html');
    expect(appCodeKind('<style>p{}</style><p>hi</p>')).toBe('html');
    expect(appCodeKind('const a = 1 < 2;\ndocument.body.textContent = "hi";')).toBe('script');
    expect(appCodeKind('document.body.innerHTML = "<p>hi</p>";')).toBe('html');
    expect(appCodeKind("import React, { useState } from 'react';\nexport default function App() { return <div/>; }")).toBe('react');
    expect(appCodeKind('export default function App() {\n  return (\n    <main>hi</main>\n  );\n}')).toBe('react');
  });

  it('names an app from its page title, else its file', () => {
    expect(appNameFrom('<title> Tip  &amp; split </title>')).toBe('Tip & split');
    expect(appNameFrom('<p>no title</p>', 'habit_tracker.html')).toBe('habit tracker');
    expect(appNameFrom('alert(1)')).toBe('My app');
    expect(appNameFrom(`<title>${'x'.repeat(100)}</title>`)).toHaveLength(60);
  });

  it('puts its storage first, after the doctype, and keeps scripts and saved things from closing it early', () => {
    const page = appDocument('<!DOCTYPE html><html><body>hi</body></html>', { note: '</script><b>' });
    expect(page.startsWith('<!DOCTYPE html><script>')).toBe(true);
    expect(page.endsWith('<html><body>hi</body></html>')).toBe(true);
    expect(page.match(/<\/script>/g)).toHaveLength(1);
    const script = appDocument('const end = "</script";');
    expect(script).toContain('<body><script>const end = "<\\/script";</script></body>');
  });

  it("gives the frame a localStorage holding what it saved, and hands each change over", async () => {
    const posted: unknown[] = [];
    const listeners: Record<string, () => void> = {};
    const win: Record<string, unknown> = {};
    const shim = /<script>([\s\S]*?)<\/script>/.exec(appDocument('<p>x</p>', { score: '3', __proto__x: 'a' }))![1]!;
    runInNewContext(shim, {
      window: win,
      parent: { postMessage: (m: unknown) => posted.push(m) },
      addEventListener: (type: string, fn: () => void) => (listeners[type] = fn),
      setTimeout,
      clearTimeout,
    });
    const ls = win.localStorage as Storage & Record<string, string>;
    expect(ls.getItem('score')).toBe('3');
    expect(ls.length).toBe(2);
    ls.setItem('score', '4');
    ls.best = '9';
    expect(ls.getItem('best')).toBe('9');
    expect(Object.keys(ls).sort()).toEqual(['__proto__x', 'best', 'score']);
    ls.removeItem('__proto__x');
    expect(ls.key(5)).toBeNull();
    // Once the code making the changes has run, everything at once.
    expect(posted).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 5));
    expect(posted).toHaveLength(1);
    expect(readAppMessage(posted[0])).toEqual({ score: '4', best: '9' });
    // Kept on the way out, too.
    ls.clear();
    listeners.pagehide!();
    expect(readAppMessage(posted[1])).toEqual({});
    // sessionStorage lasts only while it's open.
    const ss = win.sessionStorage as Storage;
    ss.setItem('tab', '1');
    await new Promise((r) => setTimeout(r, 5));
    expect(posted).toHaveLength(2);
  });

  it('only takes strings, and no more than a browser would keep', () => {
    expect(readAppMessage({ logbookApp: 1, kind: 'storage', items: { a: 'b' } })).toEqual({ a: 'b' });
    expect(readAppMessage({ logbookApp: 1, kind: 'storage', items: { a: 2 } })).toBeUndefined();
    expect(readAppMessage({ kind: 'storage', items: {} })).toBeUndefined();
    expect(readAppMessage('hello')).toBeUndefined();
    expect(readAppMessage({ logbookApp: 1, kind: 'storage', items: { big: 'x'.repeat(APP_MAX_DATA) } })).toBe('too-big');
  });

  it('keeps apps in the journal: listed, renamed, recoded, their saved things, through clean-up and the passcode, then deleted', async () => {
    const store = new MemoryStore();
    const journal = await Journal.open(store);
    const photoEntry = journal.newEntry({ title: 'Just words', blocks: [{ id: 'b', type: 'text', doc: emptyDoc('hi') }] });
    await journal.saveEntry(photoEntry);
    const tip = await journal.addApp('  Tip   calculator ', '<p>tip</p>');
    const habit = await journal.addApp('Habits', 'document.body.textContent = "habits"');
    expect(tip.id.startsWith('app')).toBe(true);
    expect(tip.name).toBe('Tip calculator');
    expect((await journal.listApps()).map((a) => a.name)).toEqual(['Habits', 'Tip calculator']);

    await journal.saveAppData(tip.id, { total: '42' });
    expect(await journal.appData(tip.id)).toEqual({ total: '42' });
    expect(await journal.appData(habit.id)).toEqual({});
    // What an app saved isn't an app.
    expect(await journal.listApps()).toHaveLength(2);

    const renamed = await journal.updateApp(tip, { name: 'Tips' });
    const recoded = await journal.updateApp(renamed, { code: '<p>tips v2</p>' });
    expect(await journal.appCode(tip.id)).toBe('<p>tips v2</p>');
    expect(recoded.bytes).toBe('<p>tips v2</p>'.length);
    expect(await journal.appData(tip.id)).toEqual({ total: '42' });

    // No entry uses them, and they stay.
    expect(await journal.collectGarbage()).toBe(0);
    await journal.enableEncryption('open sesame', FAST_KDF);
    expect(JSON.stringify(await store.all('media'))).not.toContain('Tips');
    journal.lock();
    const reopened = await Journal.open(store);
    await reopened.unlock('open sesame');
    expect((await reopened.listApps()).map((a) => a.name)).toEqual(['Habits', 'Tips']);
    expect(await reopened.appCode(tip.id)).toBe('<p>tips v2</p>');
    expect(await reopened.appData(tip.id)).toEqual({ total: '42' });

    await reopened.saveAppData(tip.id, {});
    expect(await reopened.getMediaMeta(appDataId(tip.id))).toBeUndefined();
    await reopened.saveAppData(tip.id, { total: '7' });
    await reopened.deleteApp(tip.id);
    expect(await reopened.getMediaMeta(appDataId(tip.id))).toBeUndefined();
    expect((await reopened.listApps()).map((a) => a.name)).toEqual(['Habits']);
  });
});
