import type { Entry, RichNode } from './model.ts';

const BLOCK_NODES = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'horizontalRule']);

/** Plain text of a TipTap/ProseMirror document, with block boundaries as newlines. */
export function richTextToPlain(node: RichNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(richTextToPlain).join('');
  return BLOCK_NODES.has(node.type) ? `${inner}\n` : inner;
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
