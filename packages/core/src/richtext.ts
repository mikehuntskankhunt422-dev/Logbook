import type { Entry, RichNode } from './model.ts';

const BLOCK_NODES = new Set(['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'horizontalRule', 'codeBlock']);

/** Plain text of a TipTap/ProseMirror document, with block boundaries as newlines. */
export function richTextToPlain(node: RichNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(richTextToPlain).join('');
  return BLOCK_NODES.has(node.type) ? `${inner}\n` : inner;
}

// ── formatting shared by the editor, exports and printed books (D91) ──────────────────────────────

export interface ColorChoice {
  name: string;
  value: string;
}

/** Text colours offered in the editor: readable on the light and the dark page. */
export const TEXT_COLORS: readonly ColorChoice[] = [
  { name: 'Red', value: '#d93025' },
  { name: 'Orange', value: '#e8710a' },
  { name: 'Green', value: '#188038' },
  { name: 'Teal', value: '#00897b' },
  { name: 'Blue', value: '#1a73e8' },
  { name: 'Purple', value: '#9334e6' },
  { name: 'Pink', value: '#d01884' },
  { name: 'Brown', value: '#8d5a3c' },
  { name: 'Grey', value: '#6b6f76' },
];

/** Highlighter colours: light, under dark text. */
export const HIGHLIGHT_COLORS: readonly ColorChoice[] = [
  { name: 'Yellow', value: '#fff176' },
  { name: 'Green', value: '#c5f0c0' },
  { name: 'Blue', value: '#c6e4ff' },
  { name: 'Pink', value: '#ffd0e6' },
  { name: 'Orange', value: '#ffd9a8' },
  { name: 'Purple', value: '#e4d4ff' },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * An opaque `#rrggbb` colour from a document, or undefined. Nothing else from a document ever
 * reaches CSS: printed books can't have transparency, and a document is never trusted with CSS.
 */
export function safeColor(value: unknown): string | undefined {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : undefined;
}

export type TextAlign = 'center' | 'right' | 'justify';

/** A paragraph or heading's alignment; left (the default) is undefined. */
export function safeAlign(value: unknown): TextAlign | undefined {
  return value === 'center' || value === 'right' || value === 'justify' ? value : undefined;
}

export interface FontChoice {
  /** The family name, as stored in the text (`textStyle.fontFamily`) and in CSS. */
  family: string;
  label: string;
  /** What to fall back on, in CSS. */
  fallback: string;
}

/**
 * The fonts text can be set in (D91). All open-licence, bundled with the app and the print
 * server, so they work offline and print exactly as shown.
 */
export const FONTS: readonly FontChoice[] = [
  { family: 'Newsreader', label: 'Newsreader (the journal font)', fallback: 'Georgia, serif' },
  { family: 'Bricolage Grotesque', label: 'Bricolage (clean)', fallback: 'system-ui, sans-serif' },
  { family: 'Atkinson Hyperlegible', label: 'Atkinson Hyperlegible (easy to read)', fallback: 'system-ui, sans-serif' },
  { family: 'Lora', label: 'Lora (book)', fallback: 'Georgia, serif' },
  { family: 'Playfair Display', label: 'Playfair (elegant)', fallback: 'Georgia, serif' },
  { family: 'Caveat', label: 'Caveat (handwriting)', fallback: 'cursive' },
  { family: 'JetBrains Mono', label: 'JetBrains Mono (typewriter)', fallback: 'ui-monospace, monospace' },
];

/** The font a document names, if it's one of ours; any other name is ignored. */
export function fontFor(family: unknown): FontChoice | undefined {
  return typeof family === 'string' ? FONTS.find((f) => f.family.toLowerCase() === family.toLowerCase()) : undefined;
}

/** CSS `font-family` value for one of our fonts. */
export function fontStack(font: FontChoice): string {
  return `'${font.family}', ${font.fallback}`;
}

/** A heading's level, 1 to 6 (documents from before H1–H6 only have 2 and 3). */
export function headingLevel(node: RichNode): number {
  const level = node.attrs?.['level'];
  return typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2;
}

/** Whether a document uses a top-level heading (H1). */
export function hasTopHeading(node: RichNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'heading' && headingLevel(node) === 1) return true;
  return (node.content ?? []).some(hasTopHeading);
}

/**
 * The output level of a heading under an entry title at level `top`: the document's biggest
 * heading sits just below the title, the rest follow, up to 6. Text without an H1 keeps the levels
 * it always had (H2 just below the title).
 */
export function outputHeadingLevel(node: RichNode, top: number, topHeading: boolean): number {
  return Math.min(6, top + headingLevel(node) - (topHeading ? 0 : 1));
}

export function emptyDoc(text = ''): RichNode {
  return text
    ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
    : { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function countWords(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/** All searchable text in an entry: title, rich text, captions, link and embed titles. */
export function entryPlainText(entry: Entry): string {
  const parts: string[] = [];
  for (const b of entry.blocks) {
    switch (b.type) {
      case 'text':
        parts.push(richTextToPlain(b.doc));
        break;
      case 'gallery':
        parts.push(b.caption, ...b.items.map((i) => i.caption));
        break;
      case 'link':
      case 'embed':
        parts.push(b.title, b.caption, b.url);
        break;
      default:
        parts.push(b.caption);
    }
  }
  return parts.filter(Boolean).join('\n');
}

export function entryWordCount(entry: Entry): number {
  return countWords(`${entry.title}\n${entryPlainText(entry)}`);
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;
const WWW_RE = /\bwww\.[a-z0-9-]+(\.[a-z0-9-]+)+[^\s<>"']*[^\s<>"'.,;:!?)\]}]/gi;

/** URLs found in plain text, normalised to https for bare www. links. */
export function detectLinks(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(URL_RE)) found.add(m[0]);
  for (const m of text.matchAll(WWW_RE)) {
    const prefixed = `https://${m[0]}`;
    if (![...found].some((f) => f.endsWith(m[0]))) found.add(prefixed);
  }
  return [...found];
}

/** Every link mark in a document, for print fallbacks (QR codes) and link lists. */
export function linksInDoc(node: RichNode | undefined, out: string[] = []): string[] {
  if (!node) return out;
  for (const mark of node.marks ?? []) {
    const href = mark.type === 'link' ? mark.attrs?.['href'] : undefined;
    if (typeof href === 'string' && !out.includes(href)) out.push(href);
  }
  for (const child of node.content ?? []) linksInDoc(child, out);
  return out;
}
