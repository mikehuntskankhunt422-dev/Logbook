import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { Journal } from '../src/journal.ts';
import { MemoryStore } from '../src/storage.ts';
import { emptyDoc } from '../src/richtext.ts';
import type { RichNode } from '../src/model.ts';
import { ExportTooLargeError, entriesHtml, entryHtml, entryToMarkdown, entryToText, exportEntries, richTextToExportHtml, richTextToMarkdown, richTextToText, safeName } from '../src/export/index.ts';
import { LockedError } from '../src/journal.ts';
import { FAST_KDF, pngBytes } from './helpers.ts';

const t = (text: string, marks: RichNode['marks'] = []): RichNode => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const p = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content });
const link = (href: string) => [{ type: 'link', attrs: { href } }];

const doc: RichNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [t('Morning')] },
    p(t('A '), t(' bold ', [{ type: 'bold' }]), t('swim at '), t('Glenelg', link('https://example.com/glenelg')), t('.')),
    p(t('# not a heading, *not* emphasis, 1. not a list')),
    p(t('line one'), { type: 'hardBreak' }, t('line two')),
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(t('towel'))] },
        { type: 'listItem', content: [p(t('snacks')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('apples'))] }] }] },
      ],
    },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(t('third'))] }] },
    { type: 'blockquote', content: [p(t('Quoted'))] },
    p(t('click', link('javascript:alert(1)'))),
  ],
};

describe('rich text to Markdown and plain text', () => {
  it('keeps headings, emphasis, links, lists, quotes and line breaks', () => {
    const md = richTextToMarkdown(doc, 1);
    expect(md).toContain('## Morning');
    // The spaces go outside the markers, or it wouldn't be bold.
    expect(md).toContain('A  **bold** swim at [Glenelg](https://example.com/glenelg).');
    expect(md).toContain('line one\\\nline two');
    expect(md).toContain('- towel\n- snacks\n  - apples');
    expect(md).toContain('3. third');
    expect(md).toContain('> Quoted');
  });

  it('escapes text that would turn into Markdown', () => {
    const md = richTextToMarkdown(doc);
    expect(md).toContain('\\# not a heading, \\*not\\* emphasis, 1. not a list');
    expect(richTextToMarkdown({ type: 'doc', content: [p(t('1. starts like a list'))] })).toBe('1\\. starts like a list');
    expect(richTextToMarkdown({ type: 'doc', content: [p(t('- dash'))] })).toBe('\\- dash');
  });

  it("doesn't link anything but web and email addresses", () => {
    expect(richTextToMarkdown(doc)).toContain('\nclick');
    expect(richTextToMarkdown(doc)).not.toContain('javascript');
    expect(richTextToExportHtml(doc)).not.toContain('javascript');
  });

  it('writes plain text with links after their words', () => {
    const text = richTextToText(doc);
    expect(text).toContain('Morning');
    expect(text).toContain('A  bold swim at Glenelg (https://example.com/glenelg).');
    expect(text).toContain('- towel\n- snacks\n  - apples');
    expect(text).not.toContain('**');
  });

  it('escapes everything in HTML and keeps links clickable', () => {
    const html = richTextToExportHtml({ type: 'doc', content: [p(t('<script>alert(1)</script> & '), t('site', link('https://example.com/?a=1&b="2"')))] });
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; <a href="https://example.com/?a=1&amp;b=&quot;2&quot;" rel="noopener noreferrer">site</a></p>');
  });
});

describe('Markdown that reads back as written (pre-merge review)', () => {
  const md = (...content: RichNode[]) => richTextToMarkdown({ type: 'doc', content }, 1);
  const li = (...content: RichNode[]): RichNode => ({ type: 'listItem', content });
  const ul = (...content: RichNode[]): RichNode => ({ type: 'bulletList', content });
  const br: RichNode = { type: 'hardBreak' };

  it('keeps a # at the end of a heading', () => {
    expect(md({ type: 'heading', attrs: { level: 2 }, content: [t('Issue #')] })).toBe('## Issue \\#');
  });

  it('puts a blank line between blocks of one list item, but keeps a sub-list tight', () => {
    expect(md(ul(li(p(t('a')), ul(li(p(t('sub')))), p(t('b')))))).toBe('- a\n  - sub\n\n  b');
    expect(md(ul(li(p(t('first')), p(t('second')))))).toBe('- first\n\n  second');
  });

  it('uses HTML tags for emphasis that starts or ends with punctuation', () => {
    expect(md(p(t('"quote"', [{ type: 'bold' }]), t('word')))).toBe('<strong>"quote"</strong>word');
    expect(md(p(t('今天很好。', [{ type: 'bold' }]), t('明天')))).toBe('<strong>今天很好。</strong>明天');
    expect(md(p(t('A '), t('bold', [{ type: 'bold' }]), t(' word')))).toBe('A **bold** word');
  });

  it('keeps a sub-list tight only where Markdown lets it follow a paragraph (second review)', () => {
    const ol = (start: number, ...content: RichNode[]): RichNode => ({ type: 'orderedList', attrs: { start }, content });
    expect(md(ul(li(p(t('a')), ul(li(p()), li(p(t('b')))))))).toBe('- a\n\n  - \n  - b');
    expect(md(ul(li(p(t('a')), ol(3, li(p(t('three')))))))).toBe('- a\n\n  3. three');
    expect(md(ul(li(p(t('a')), ol(1, li(p(t('one')))))))).toBe('- a\n  1. one');
  });

  it('drops a line break at the end of a paragraph, and turns one in a heading into a space', () => {
    expect(md(p(t('one'), br), p(t('two')))).toBe('one\n\ntwo');
    expect(md({ type: 'heading', attrs: { level: 2 }, content: [t('H'), br, t('second')] })).toBe('## H second');
    expect(md(p(t('one'), br, t('two')))).toBe('one\\\ntwo');
  });
});

describe('entries as documents', () => {
  const entry = {
    v: 1 as const,
    id: 'e1',
    date: '2026-10-07',
    title: 'A good day',
    mood: '😄' as const,
    cover: { kind: 'gradient' as const, gradient: 'sunrise' as const },
    tags: ['beach', 'swim'],
    blocks: [
      { id: 'b1', type: 'text' as const, doc: emptyDoc('Swam at Glenelg') },
      { id: 'b2', type: 'photo' as const, mediaId: 'm1', caption: 'Sunset' },
      { id: 'b3', type: 'link' as const, url: 'https://example.com', title: 'Tide times', caption: '' },
    ],
    createdAt: '2026-10-07T00:00:00Z',
    updatedAt: '2026-10-07T00:00:00Z',
    rev: 1,
    deletedAt: null,
    expiresAt: null,
    musicId: null,
    musicUrl: null,
  };

  it('Markdown with front matter, the photo and the link', () => {
    const md = entryToMarkdown(entry, () => ({ kind: 'image', name: 'beach day.png', src: 'media/beach%20day.png' }), { frontMatter: true });
    expect(md).toMatch(/^---\ntitle: "A good day"\ndate: 2026-10-07\nmood: "😄"\ntags: \["beach","swim"\]\n---\n\n# A good day\n\n\*2026-10-07 · Mood: 😄 · Tags: beach, swim\*\n\nSwam at Glenelg\n\n/);
    expect(md).toContain('![Sunset](media/beach%20day.png)\n*Sunset*');
    expect(md).toContain('[Tide times](https://example.com)');
  });

  it('names the background music, and plays it in a saved web page but not on paper (D91)', () => {
    const withMusic = { ...entry, musicId: 'song' };
    const lookup = (id: string) => (id === 'song' ? { kind: 'audio' as const, name: 'waves.mp3', src: 'media/waves.mp3' } : undefined);
    expect(entryToMarkdown(withMusic, lookup)).toContain('[🔊 waves.mp3](media/waves.mp3)\n*Background music*');
    expect(entryHtml(withMusic, lookup)).toContain('<audio src="media/waves.mp3" controls preload="metadata"></audio><figcaption>Background music</figcaption>');
    expect(entryHtml(withMusic, lookup, { mode: 'print' })).not.toContain('waves.mp3');
  });

  it('links background music from the web in exports, not on paper (D93)', () => {
    const withLink = { ...entry, musicUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' };
    expect(entryToMarkdown(withLink, () => undefined)).toContain('🎵 Background music: [https://www.youtube.com/watch?v=jfKfPfyJRdk](https://www.youtube.com/watch?v=jfKfPfyJRdk)');
    expect(entryHtml(withLink, () => undefined)).toContain('🎵 Background music: <a href="https://www.youtube.com/watch?v=jfKfPfyJRdk"');
    expect(entryHtml(withLink, () => undefined, { mode: 'print' })).not.toContain('youtube');
    expect(entryToText(withLink, () => undefined)).toContain('Background music: https://www.youtube.com/watch?v=jfKfPfyJRdk');
  });

  it('trims captions, so they stay italic and never turn into a list', () => {
    const withCaption = { ...entry, blocks: [{ id: 'p', type: 'photo' as const, mediaId: 'm1', caption: ' Sunset at the pier ' }] };
    expect(entryToMarkdown(withCaption, () => ({ kind: 'image', name: 'a.png', src: 'media/a.png' }))).toContain('![Sunset at the pier](media/a.png)\n*Sunset at the pier*');
  });

  it('writes out a link block that isn’t a web or email address instead of linking it', () => {
    const bad = { ...entry, blocks: [{ id: 'l', type: 'link' as const, url: 'javascript:alert(1)', title: 'click me', caption: '' }] };
    const out = entryToMarkdown(bad, () => undefined);
    expect(out).toContain('click me (javascript:alert(1))');
    expect(out).not.toContain('](');
    // Written out at the start of a line, it mustn't turn into a heading or list.
    const titled = { ...entry, blocks: [{ id: 'l', type: 'link' as const, url: 'tel:+15551234', title: '# Call mum', caption: '' }] };
    expect(entryToMarkdown(titled, () => undefined)).toContain('\n\\# Call mum (tel:+15551234)\n');
  });

  it('names a photo that isn’t in the export', () => {
    expect(entryToMarkdown(entry, () => ({ kind: 'image', name: 'beach.png' }))).toContain('*\\[Photo: beach.png\\]*\n*Sunset*');
    expect(entryToText(entry, () => ({ kind: 'image', name: 'beach.png' }))).toContain('[Photo: beach.png] Sunset');
  });

  it('HTML for print shows a video’s poster frame', () => {
    const withVideo = { ...entry, blocks: [{ id: 'v', type: 'video' as const, mediaId: 'v1', caption: 'Waves' }] };
    const html = entriesHtml([withVideo], () => ({ kind: 'video', name: 'waves.mp4', src: 'blob:x', posterSrc: 'blob:poster' }), { mode: 'print' });
    expect(html).toContain('<img src="blob:poster"');
    expect(html).toContain('▶ waves.mp4 · Waves');
    expect(entriesHtml([withVideo], () => ({ kind: 'video', name: 'waves.mp4', src: 'media/waves.mp4' }))).toContain('<video src="media/waves.mp4" controls');
  });
});

async function journalWithPhoto() {
  const journal = await Journal.open(new MemoryStore());
  const photo = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'Beach: day?.png', width: 1, height: 1 });
  const second = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'Beach: day?.png', width: 1, height: 1 });
  const a = await journal.saveEntry(
    journal.newEntry({
      date: '2026-10-07',
      title: 'A good day',
      blocks: [
        { id: 't', type: 'text', doc: emptyDoc('Swam at Glenelg') },
        { id: 'p', type: 'photo', mediaId: photo.id, caption: 'Sunset' },
        { id: 'p2', type: 'photo', mediaId: second.id, caption: '' },
      ],
    }),
  );
  const b = await journal.saveEntry(journal.newEntry({ date: '2026-10-01', title: 'Earlier: plans/ideas', blocks: [{ id: 't', type: 'text', doc: emptyDoc('Packed') }] }));
  return { journal, entries: [a, b], photo };
}

const unzip = async (blob: Blob) => {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v]));
};

describe('exportEntries', () => {
  const now = new Date('2026-10-11T09:00:00');

  it('Markdown, one file per entry, with a media folder in a zip', async () => {
    const { journal, entries } = await journalWithPhoto();
    const out = await exportEntries(journal, entries, { format: 'markdown', layout: 'per-entry', includeMedia: true, now });
    expect(out.fileName).toBe('Logbook export 2026-10-11 (md).zip');
    expect(out).toMatchObject({ entries: 2, mediaFiles: 2, mediaMissing: 0 });
    const files = await unzip(out.blob);
    expect(Object.keys(files).sort()).toEqual([
      'Logbook export 2026-10-11/2026-10-01 Earlier plans ideas.md',
      'Logbook export 2026-10-11/2026-10-07 A good day.md',
      'Logbook export 2026-10-11/media/Beach day (2).png',
      'Logbook export 2026-10-11/media/Beach day.png',
    ]);
    const md = strFromU8(files['Logbook export 2026-10-11/2026-10-07 A good day.md']!);
    expect(md).toContain('![Sunset](media/Beach%20day.png)');
    expect(md).toContain('![Beach day.png](media/Beach%20day%20%282%29.png)');
    expect(files['Logbook export 2026-10-11/media/Beach day.png']).toEqual(pngBytes());
  });

  it('Markdown in one file, oldest first', async () => {
    const { journal, entries } = await journalWithPhoto();
    const out = await exportEntries(journal, entries, { format: 'markdown', includeMedia: false, now });
    expect(out.fileName).toBe('Logbook 2026-10-11.md');
    const md = await out.blob.text();
    expect(md.indexOf('## Earlier: plans/ideas')).toBeLessThan(md.indexOf('## A good day'));
    expect(md).toContain('*\\[Photo: Beach day.png\\]*');
  });

  it('plain text is one file without media', async () => {
    const { journal, entries } = await journalWithPhoto();
    const out = await exportEntries(journal, entries, { format: 'text', includeMedia: true, now });
    expect(out.fileName).toBe('Logbook 2026-10-11.txt');
    expect(out.mediaFiles).toBe(0);
    expect(await out.blob.text()).toContain('A good day\n2026-10-07\n\nSwam at Glenelg\n\n[Photo: Beach day.png] Sunset');
  });

  it('a web page with its pictures, or on its own', async () => {
    const { journal, entries } = await journalWithPhoto();
    const zipped = await exportEntries(journal, entries, { format: 'html', includeMedia: true, now });
    const files = await unzip(zipped.blob);
    const page = strFromU8(files['Logbook export 2026-10-11/index.html']!);
    expect(page).toContain('<img src="media/Beach%20day.png" alt="Sunset"');
    expect(page).toContain('2 entries, 2026-10-01 – 2026-10-07');
    const alone = await exportEntries(journal, entries, { format: 'html', includeMedia: false, now });
    expect(alone.fileName).toBe('Logbook 2026-10-11.html');
    expect(await alone.blob.text()).toContain('🖼 Photo: Beach day.png');
  });

  it('counts media it couldn’t read instead of failing', async () => {
    const { journal, entries, photo } = await journalWithPhoto();
    journal.getMediaBlob = async (id) => (id === photo.id ? undefined : new Blob([pngBytes()]));
    const out = await exportEntries(journal, entries, { format: 'markdown', includeMedia: true, now });
    expect(out).toMatchObject({ mediaFiles: 1, mediaMissing: 1 });
  });

  it('exports from a journal with a passcode in plain text', async () => {
    const { journal, entries } = await journalWithPhoto();
    await journal.enableEncryption('correct horse', FAST_KDF);
    const out = await exportEntries(journal, entries, { format: 'markdown', layout: 'per-entry', includeMedia: true, now });
    const files = await unzip(out.blob);
    expect(strFromU8(files['Logbook export 2026-10-11/2026-10-07 A good day.md']!)).toContain('Swam at Glenelg');
    expect(files['Logbook export 2026-10-11/media/Beach day.png']).toEqual(pngBytes());
  });
});

describe('exportEntries when things go wrong (pre-merge review)', () => {
  const now = new Date('2026-10-11T09:00:00');

  it('stops with LockedError when the journal locks part-way, rather than saving an export with holes', async () => {
    const { journal, entries } = await journalWithPhoto();
    await journal.enableEncryption('correct horse', FAST_KDF);
    await expect(exportEntries(journal, entries, { format: 'markdown', includeMedia: true, now, onProgress: (done) => done === 1 && journal.lock() })).rejects.toBeInstanceOf(LockedError);
  });

  it('labels media whose record is gone by its block type, not "File"', async () => {
    const { journal, entries } = await journalWithPhoto();
    journal.getMediaMeta = async () => undefined;
    const out = await exportEntries(journal, entries, { format: 'markdown', includeMedia: true, now });
    expect(out).toMatchObject({ mediaFiles: 0, mediaMissing: 2 });
    expect(await out.blob.text()).toContain('*\\[Photo\\]*\n*Sunset*');
  });

  it('refuses before a zip would pass the 4 GB a zip without Zip64 can hold, without reading any media', async () => {
    const { journal, entries } = await journalWithPhoto();
    let read = 0;
    const getMediaBlob = journal.getMediaBlob.bind(journal);
    journal.getMediaBlob = (id) => (read++, getMediaBlob(id));
    await expect(exportEntries(journal, entries, { format: 'html', includeMedia: true, now, zipLimit: 100 })).rejects.toBeInstanceOf(ExportTooLargeError);
    expect(read).toBe(0);
  });

  it('stops when its signal is aborted (Settings closed)', async () => {
    const { journal, entries } = await journalWithPhoto();
    const controller = new AbortController();
    const run = exportEntries(journal, entries, { format: 'markdown', includeMedia: true, now, signal: controller.signal, onProgress: () => controller.abort() });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('safeName', () => {
  it('makes names every system accepts', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
    expect(safeName('trailing dots...  ')).toBe('trailing dots');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('x'.repeat(200))).toHaveLength(80);
  });
});
