import { describe, expect, it } from 'vitest';
import { parseEmbedUrl, embedPlayerUrl } from '../src/embeds.ts';
import { countWords, detectLinks, emptyDoc, linksInDoc, richTextToPlain } from '../src/richtext.ts';
import { slugify } from '../src/ids.ts';
import type { RichNode } from '../src/model.ts';

const doc: RichNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Beach day' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Swam at ' },
        { type: 'text', text: 'Glenelg', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com/glenelg' } }] },
        { type: 'text', text: '.' },
      ],
    },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ice cream' }] }] }] },
  ],
};

describe('rich text', () => {
  it('extracts plain text with block breaks', () => {
    expect(richTextToPlain(doc)).toContain('Beach day\n');
    expect(richTextToPlain(doc)).toContain('Swam at Glenelg.\n');
    expect(richTextToPlain(doc)).toContain('ice cream');
  });

  it('collects link marks', () => {
    expect(linksInDoc(doc)).toEqual(['https://example.com/glenelg']);
  });

  it('counts words across punctuation and unicode', () => {
    expect(countWords("It's a café-day, isn't it? 42")).toBe(6);
    expect(countWords('   ')).toBe(0);
  });

  it('emptyDoc produces a valid paragraph', () => {
    expect(richTextToPlain(emptyDoc('hi'))).toBe('hi\n');
  });

  it('detects links without trailing punctuation and upgrades bare www', () => {
    expect(detectLinks('see https://a.com/x?y=1, and www.b.org/path.')).toEqual(['https://a.com/x?y=1', 'https://www.b.org/path']);
  });
});

describe('embeds', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('parses YouTube %s', (url, id) => {
    expect(parseEmbedUrl(url)).toMatchObject({ provider: 'youtube', videoId: id });
  });

  it('parses Vimeo page and player URLs', () => {
    expect(parseEmbedUrl('https://vimeo.com/76979871')).toMatchObject({ provider: 'vimeo', videoId: '76979871' });
    expect(parseEmbedUrl('https://player.vimeo.com/video/76979871?h=x')).toMatchObject({ videoId: '76979871' });
  });

  it('rejects other URLs and junk', () => {
    expect(parseEmbedUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseEmbedUrl('javascript:alert(1)')).toBeNull();
    expect(parseEmbedUrl('not a url')).toBeNull();
  });

  it('uses privacy-friendlier players', () => {
    expect(embedPlayerUrl({ provider: 'youtube', videoId: 'abc123def45' })).toContain('youtube-nocookie.com');
    expect(embedPlayerUrl({ provider: 'vimeo', videoId: '1' })).toContain('dnt=1');
  });
});

describe('slugify', () => {
  it('makes readable ASCII file-name parts', () => {
    expect(slugify('Café au lait — à Paris!')).toBe('cafe-au-lait-a-paris');
    expect(slugify('')).toBe('entry');
    expect(slugify('日本')).toBe('entry');
  });
});
