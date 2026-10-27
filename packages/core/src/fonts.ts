import { FLAG_FONT, fontFor, fontStack } from './richtext.ts';

/**
 * Fonts of your own (D107): font files added in Settings, kept in the journal as media with a
 * `font` note in their details, so they travel with the journal folder and its backups. Here: what
 * a font file is called and how heavy it is, read from the file itself where it can be (TrueType,
 * OpenType and WOFF), else from its file name (WOFF2).
 */

/** How a font's media id starts (`font…`), so fonts are found without reading every other file's details. */
export const FONT_ID_PREFIX = 'font';

export interface FontInfo {
  /** The family the text names, cleaned (`cleanFamily`). */
  family: string;
  /** 100 (thin) to 900 (black); 400 is regular, 700 bold. */
  weight: number;
  style: 'normal' | 'italic';
}

/** What text can name a font of your own: letters, digits, spaces, dots, hyphens and underscores, so it can never break out of CSS. */
const UNSAFE = /[^\p{L}\p{N} ._-]+/gu;

/** A family name as text can use it: anything that could break out of CSS taken out, at most 60 characters. */
export function cleanFamily(name: string): string {
  return name.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
}

/** Whether a name is one a font of your own could have (what `cleanFamily` gives). */
export function isSafeFamily(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 60 && cleanFamily(name) === name;
}

/**
 * CSS `font-family` for whatever font text names: one of Logbook's own, or a font of your own (with
 * the journal font behind it), or nothing for a name that can't be one.
 */
export function fontStackFor(family: unknown): string | undefined {
  const ours = fontFor(family);
  if (ours) return fontStack(ours);
  return isSafeFamily(family) ? `'${FLAG_FONT}', '${family}', 'Newsreader', Georgia, serif` : undefined;
}

/** The first font a CSS `font-family` list names, quotes taken off, other than the flag font; null for none. */
export function firstFamily(css: string): string | null {
  for (const part of css.split(',')) {
    const name = part.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    if (name && name !== FLAG_FONT) return name;
  }
  return null;
}

/** A font file's type, from its first bytes; '' when it isn't one of these. */
export function fontMime(bytes: Uint8Array): string {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  if (tag === 'wOFF') return 'font/woff';
  if (tag === 'wOF2') return 'font/woff2';
  if (tag === 'OTTO') return 'font/otf';
  if (tag === '\0\x01\0\0' || tag === 'true') return 'font/ttf';
  if (tag === 'ttcf') return 'font/collection';
  return '';
}

const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  roman: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};
/** Words in font file names that say nothing about the family. */
const NOISE = new Set(['variablefont', 'variable', 'font', 'wght', 'ital', 'opsz', 'wdth', 'webfont', 'subset']);

/** Family, weight and style from a file name such as `Roboto-BoldItalic.ttf` or `inter-latin-700-normal.woff2`. */
export function fontFromFileName(fileName: string): FontInfo {
  const base = fileName.replace(/\.[a-z0-9]{2,6}$/i, '');
  const words = base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.,]+/)
    .filter(Boolean);
  let weight = 400;
  let style: FontInfo['style'] = 'normal';
  const family: string[] = [];
  for (const word of words) {
    const w = word.toLowerCase();
    if (w === 'italic' || w === 'oblique') style = 'italic';
    else if (WEIGHTS[w] !== undefined && family.length) weight = WEIGHTS[w];
    else if (/^[1-9]00$/.test(w) && family.length) weight = Number(w);
    else if (!(NOISE.has(w) && family.length)) family.push(word);
  }
  return { family: cleanFamily(family.join(' ')) || cleanFamily(base) || 'My font', weight, style };
}

/**
 * Family, weight and style of a font file, from its own tables (name and OS/2) for TrueType,
 * OpenType and WOFF; from its file name otherwise, or when the file doesn't say. Never throws: a
 * damaged file just falls back to its name.
 */
export async function readFontInfo(bytes: Uint8Array, fileName: string): Promise<FontInfo> {
  const fallback = fontFromFileName(fileName);
  try {
    const tables = await fontTables(bytes);
    if (!tables) return fallback;
    const names = tables.name ? readNames(tables.name) : new Map<number, string>();
    const family = cleanFamily(names.get(16) ?? names.get(1) ?? '');
    const sub = (names.get(17) ?? names.get(2) ?? '').toLowerCase();
    const os2 = tables['OS/2'];
    const view = os2 ? new DataView(os2.buffer, os2.byteOffset, os2.byteLength) : undefined;
    const weightClass = view && os2!.byteLength >= 6 ? view.getUint16(4) : 0;
    const italicBit = view && os2!.byteLength >= 64 ? (view.getUint16(62) & 1) === 1 : false;
    return {
      family: family || fallback.family,
      weight: weightClass >= 1 && weightClass <= 1000 ? Math.min(900, Math.max(100, Math.round(weightClass / 100) * 100)) : fallback.weight,
      style: italicBit || /italic|oblique/.test(sub) ? 'italic' : view || sub ? 'normal' : fallback.style,
    };
  } catch {
    return fallback;
  }
}

type Tables = Partial<Record<'name' | 'OS/2', Uint8Array>>;

/** The name and OS/2 tables of a TrueType, OpenType or WOFF file; undefined for anything else. */
async function fontTables(bytes: Uint8Array): Promise<Tables | undefined> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = fontMime(bytes);
  const out: Tables = {};
  const slice = (offset: number, length: number) => {
    if (offset + length > bytes.byteLength || length < 0) throw new RangeError('table out of bounds');
    return bytes.subarray(offset, offset + length);
  };
  if (kind === 'font/ttf' || kind === 'font/otf') {
    const count = view.getUint16(4);
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16;
      const tag = String.fromCharCode(...slice(at, 4));
      if (tag === 'name' || tag === 'OS/2') out[tag] = slice(view.getUint32(at + 8), view.getUint32(at + 12));
    }
    return out;
  }
  if (kind === 'font/woff') {
    const count = view.getUint16(12);
    for (let i = 0; i < count; i++) {
      const at = 44 + i * 20;
      const tag = String.fromCharCode(...slice(at, 4));
      if (tag !== 'name' && tag !== 'OS/2') continue;
      const data = slice(view.getUint32(at + 4), view.getUint32(at + 8));
      const length = view.getUint32(at + 12);
      out[tag] = data.byteLength < length ? await inflate(data) : data;
    }
    return out;
  }
  return undefined;
}

/** A WOFF table's zlib data, unpacked. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A name table's strings by name ID, in English where the font has a choice. */
function readNames(table: Uint8Array): Map<number, string> {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(2);
  const strings = view.getUint16(4);
  const found = new Map<number, { text: string; rank: number }>();
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    if (at + 12 > table.byteLength) break;
    const [platform, encoding, language, nameId, length, offset] = [0, 2, 4, 6, 8, 10].map((k) => view.getUint16(at + k)) as [number, number, number, number, number, number];
    const start = strings + offset;
    if (start + length > table.byteLength) continue;
    const raw = table.subarray(start, start + length);
    let text: string;
    let rank: number;
    if (platform === 3 || platform === 0) {
      // Windows and Unicode names are UTF-16, big-endian.
      text = new TextDecoder('utf-16be').decode(raw);
      rank = platform === 3 && language === 0x409 ? 3 : platform === 3 ? 2 : 1;
    } else if (platform === 1 && encoding === 0) {
      text = String.fromCharCode(...raw);
      rank = language === 0 ? 1 : 0;
    } else continue;
    const best = found.get(nameId);
    if (text.trim() && (!best || rank > best.rank)) found.set(nameId, { text, rank });
  }
  return new Map([...found].map(([id, { text }]) => [id, text]));
}
