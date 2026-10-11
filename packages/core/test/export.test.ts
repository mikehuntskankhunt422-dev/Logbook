import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { Journal } from '../src/journal.ts';
import { MemoryStore } from '../src/storage.ts';
import { emptyDoc } from '../src/richtext.ts';
import type { RichNode } from '../src/model.ts';
import { entriesHtml, entryToMarkdown, entryToText, exportEntries, richTextToExportHtml, richTextToMarkdown, richTextToText, safeName } from '../src/export/index.ts';
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
  };

  it('Markdown with front matter, the photo and the link', () => {
    const md = entryToMarkdown(entry, () => ({ kind: 'image', name: 'beach day.png', src: 'media/beach%20day.png' }), { frontMatter: true });
    expect(md).toMatch(/^---\ntitle: "A good day"\ndate: 2026-10-07\nmood: "😄"\ntags: \["beach","swim"\]\n---\n\n# A good day\n\n\*2026-10-07 · Mood: 😄 · Tags: beach, swim\*\n\nSwam at Glenelg\n\n/);
    expect(md).toContain('![Sunset](media/beach%20day.png)\n*Sunset*');
    expect(md).toContain('[Tide times](https://example.com)');
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

describe('safeName', () => {
  it('makes names every system accepts', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
    expect(safeName('trailing dots...  ')).toBe('trailing dots');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('x'.repeat(200))).toHaveLength(80);
  });
});
