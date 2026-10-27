import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { cleanFamily, firstFamily, fontFromFileName, fontMime, fontStackFor, readFontInfo } from '../src/fonts.ts';
import { wrapMark } from '../src/rich-html.ts';

/** A TrueType file with only the tables Logbook reads: names (Windows, UTF-16) and OS/2. */
function sfnt({ family, sub, weight, italic }: { family: string; sub: string; weight: number; italic: boolean }): Uint8Array {
  const utf16 = (s: string) => {
    const b = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) new DataView(b.buffer).setUint16(i * 2, s.charCodeAt(i));
    return b;
  };
  const strings = [utf16(family), utf16(sub)];
  const name = new Uint8Array(6 + 2 * 12 + strings[0]!.length + strings[1]!.length);
  const nv = new DataView(name.buffer);
  nv.setUint16(2, 2);
  nv.setUint16(4, 6 + 2 * 12);
  let offset = 0;
  [1, 2].forEach((nameId, i) => {
    const at = 6 + i * 12;
    [3, 1, 0x409, nameId, strings[i]!.length, offset].forEach((v, k) => nv.setUint16(at + k * 2, v));
    name.set(strings[i]!, 6 + 2 * 12 + offset);
    offset += strings[i]!.length;
  });
  const os2 = new Uint8Array(78);
  new DataView(os2.buffer).setUint16(4, weight);
  new DataView(os2.buffer).setUint16(62, italic ? 1 : 0x40);
  const tables: [string, Uint8Array][] = [
    ['OS/2', os2],
    ['name', name],
  ];
  const out = new Uint8Array(12 + tables.length * 16 + os2.length + name.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, tables.length);
  let at = 12 + tables.length * 16;
  tables.forEach(([tag, data], i) => {
    out.set([...tag].map((c) => c.charCodeAt(0)), 12 + i * 16);
    v.setUint32(12 + i * 16 + 8, at);
    v.setUint32(12 + i * 16 + 12, data.length);
    out.set(data, at);
    at += data.length;
  });
  return out;
}

describe('fonts of your own (D107)', () => {
  it('reads a TrueType font’s family, weight and style from the font itself', async () => {
    const bytes = sfnt({ family: 'Test Sans', sub: 'Bold Italic', weight: 700, italic: true });
    expect(fontMime(bytes)).toBe('font/ttf');
    expect(await readFontInfo(bytes, 'whatever.ttf')).toEqual({ family: 'Test Sans', weight: 700, style: 'italic' });
    expect(await readFontInfo(sfnt({ family: 'Test Sans', sub: 'Light', weight: 300, italic: false }), 'x.ttf')).toEqual({ family: 'Test Sans', weight: 300, style: 'normal' });
  });

  it('reads a WOFF font, unpacking its tables', async () => {
    const bytes = new Uint8Array(await readFile(new URL('../../../node_modules/@fontsource/caveat/files/caveat-latin-700-normal.woff', import.meta.url)));
    expect(fontMime(bytes)).toBe('font/woff');
    expect(await readFontInfo(bytes, 'caveat.woff')).toEqual({ family: 'Caveat', weight: 700, style: 'normal' });
  });

  it('goes by the file name for WOFF2, or a file it can’t read, and never throws', async () => {
    const woff2 = new Uint8Array(await readFile(new URL('../../../node_modules/@fontsource/caveat/files/caveat-latin-400-normal.woff2', import.meta.url)));
    expect(fontMime(woff2)).toBe('font/woff2');
    expect(await readFontInfo(woff2, 'Handy-BoldItalic.woff2')).toEqual({ family: 'Handy', weight: 700, style: 'italic' });
    expect(await readFontInfo(new TextEncoder().encode('not a font'), 'notes.txt')).toEqual({ family: 'notes', weight: 400, style: 'normal' });
    // Cut short, tables pointing past the end.
    const cut = sfnt({ family: 'Gone', sub: 'Regular', weight: 400, italic: false }).subarray(0, 40);
    expect(await readFontInfo(cut, 'Cut-Light.ttf')).toEqual({ family: 'Cut', weight: 300, style: 'normal' });
    expect(fontFromFileName('inter-latin-700-italic.woff2')).toEqual({ family: 'inter latin', weight: 700, style: 'italic' });
    expect(fontFromFileName('Caveat-VariableFont_wght.ttf')).toEqual({ family: 'Caveat', weight: 400, style: 'normal' });
    expect(fontFromFileName('Bold.ttf')).toEqual({ family: 'Bold', weight: 400, style: 'normal' });
  });

  it('only ever names a font in CSS with a name that can’t break out of it', () => {
    expect(cleanFamily(`Evil'; background:url(x)} "`)).toBe('Evil background url x');
    expect(fontStackFor('My Hand')).toBe("'Twemoji Country Flags', 'My Hand', 'Newsreader', Georgia, serif");
    expect(fontStackFor('Lora')).toContain("'Lora', Georgia, serif");
    expect(fontStackFor("x'; color:red")).toBeUndefined();
    expect(fontStackFor(42)).toBeUndefined();
    expect(wrapMark({ type: 'textStyle', attrs: { fontFamily: 'My Hand' } }, 'hi')).toBe(`<span style="font-family:&#39;Twemoji Country Flags&#39;, &#39;My Hand&#39;, &#39;Newsreader&#39;, Georgia, serif">hi</span>`);
    expect(wrapMark({ type: 'textStyle', attrs: { fontFamily: "a'}body{color:red" } }, 'hi')).toBe('hi');
    // Read back from the page: the first font of the list, not the flag font.
    expect(firstFamily(`"Twemoji Country Flags", "Hand 2", Newsreader, Georgia, serif`)).toBe('Hand 2');
    expect(firstFamily("'Lora', serif")).toBe('Lora');
    expect(firstFamily('')).toBeNull();
  });
});
