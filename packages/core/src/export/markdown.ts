import type { Block, Entry, RichNode } from '../model.ts';
import { shortUrl } from '../html-text.ts';
import { hasTopHeading, outputHeadingLevel } from '../richtext.ts';
import { backgroundLabel, mediaLabel, metaLine, safeHref, type MediaLookup, type RenderOptions } from './common.ts';

/**
 * Markdown and plain text from entries (D89). One walker for both: Markdown keeps headings, lists,
 * quotes, emphasis and links and escapes what would otherwise turn into markup; plain text keeps
 * the same shape (list markers, quotes) with links written out after their words.
 */

type Mode = 'md' | 'text';

interface Ctx {
  mode: Mode;
  /** The entry title's level: `#` in its own file, `##` in a shared one; the text's headings go below it. */
  shift: number;
  /** Whether the document has an H1, which then sits just below the title (D91). */
  topHeading?: boolean;
}

export interface MarkdownOptions extends RenderOptions {
  /** Front matter (title, date, mood, tags) for notes apps such as Obsidian; one file per entry. */
  frontMatter?: boolean;
  /** `#` for an entry in its own file, `##` when entries share one. */
  titleLevel?: 1 | 2;
}

export function richTextToMarkdown(doc: RichNode | undefined, shift = 0): string {
  return doc ? block(doc, { mode: 'md', shift }) : '';
}

export function richTextToText(doc: RichNode | undefined): string {
  return doc ? block(doc, { mode: 'text', shift: 0 }) : '';
}

export function entryToMarkdown(entry: Entry, media: MediaLookup, opts: MarkdownOptions = {}): string {
  const level = opts.titleLevel ?? 1;
  const ctx: Ctx = { mode: 'md', shift: level };
  const out: string[] = [];
  if (opts.frontMatter) {
    // JSON strings and arrays are valid YAML, and quote whatever a title holds.
    const fm = [`title: ${JSON.stringify(entry.title || 'Untitled')}`, `date: ${entry.date}`];
    if (entry.mood) fm.push(`mood: ${JSON.stringify(entry.mood)}`);
    if (entry.tags.length) fm.push(`tags: ${JSON.stringify(entry.tags)}`);
    out.push(`---\n${fm.join('\n')}\n---`);
  }
  out.push(`${'#'.repeat(level)} ${keepClosingHashes(escapeLine(escapeMd(entry.title || 'Untitled')))}`);
  out.push(`*${metaLine(entry, opts).map(escapeMd).join(' · ')}*`);
  if (entry.cover.kind === 'photo') out.push(mediaMd(media(entry.cover.mediaId), 'Cover photo', ''));
  if (entry.musicId) {
    const m = media(entry.musicId);
    out.push(mediaMd(m, m && m.kind !== 'audio' ? mediaLabel(m.kind) : 'Audio', backgroundLabel(m?.kind)));
  }
  const musicHref = entry.musicUrl ? safeHref(entry.musicUrl) : null;
  if (musicHref) out.push(`🎵 Background music: ${linkMd(musicHref, musicHref)}`);
  for (const b of entry.blocks) {
    const md = blockMd(b, media, ctx);
    if (md) out.push(md);
  }
  return `${out.filter(Boolean).join('\n\n')}\n`;
}

export function entryToText(entry: Entry, media: MediaLookup, opts: RenderOptions = {}): string {
  const ctx: Ctx = { mode: 'text', shift: 0 };
  const out = [`${entry.title || 'Untitled'}\n${metaLine(entry, opts).join(' · ')}`];
  if (entry.musicId) {
    const m = media(entry.musicId);
    out.push(mediaText(m, 'audio', backgroundLabel(m?.kind)));
  }
  if (entry.musicUrl) out.push(`Background music: ${entry.musicUrl}`);
  for (const b of entry.blocks) {
    const text = blockText(b, media, ctx);
    if (text) out.push(text);
  }
  return `${out.join('\n\n')}\n`;
}

// ── entry blocks ─────────────────────────────────────────────────────────────────────────────────

function blockMd(b: Block, media: MediaLookup, ctx: Ctx): string {
  switch (b.type) {
    case 'text':
      return block(b.doc, ctx);
    case 'photo':
    case 'video':
    case 'audio':
    case 'file':
      return mediaMd(media(b.mediaId), mediaLabel(media(b.mediaId)?.kind ?? kindOf(b.type)), b.caption);
    case 'gallery':
      return [...b.items.map((i) => mediaMd(media(i.mediaId), 'Photo', i.caption)), captionMd(b.caption)].filter(Boolean).join('\n\n');
    case 'link':
      return withCaption(linkMd(b.title || shortUrl(b.url), b.url), b.caption);
    case 'embed':
      return withCaption(linkMd(`▶ ${b.title || `${b.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`}`, b.url), b.caption);
  }
}

function blockText(b: Block, media: MediaLookup, ctx: Ctx): string {
  switch (b.type) {
    case 'text':
      return block(b.doc, ctx);
    case 'photo':
    case 'video':
    case 'audio':
    case 'file':
      return mediaText(media(b.mediaId), kindOf(b.type), b.caption);
    case 'gallery':
      return [...b.items.map((i) => mediaText(media(i.mediaId), 'image', i.caption)), b.caption].filter(Boolean).join('\n');
    case 'link':
      return [b.title && b.title !== b.url ? `${b.title} (${b.url})` : b.url, b.caption].filter(Boolean).join('\n');
    case 'embed':
      return [`${b.title || `${b.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`} (${b.url})`, b.caption].filter(Boolean).join('\n');
  }
}

const kindOf = (t: 'photo' | 'video' | 'audio' | 'file') => (t === 'photo' ? 'image' : t);

function mediaMd(m: ReturnType<MediaLookup>, label: string, caption: string): string {
  const cap = caption.trim() ? `\n${captionMd(caption)}` : '';
  if (!m?.src) return `*\\[${label}${m?.name ? `: ${escapeMd(m.name)}` : ''}\\]*${cap}`;
  if (m.kind === 'image') return `![${escapeMd(caption.trim() || m.name)}](${mdUrl(m.src)})${cap}`;
  const icon = m.kind === 'video' ? '▶' : m.kind === 'audio' ? '🔊' : '📎';
  return `[${icon} ${escapeMd(m.name)}](${mdUrl(m.src)})${cap}`;
}

function mediaText(m: ReturnType<MediaLookup>, kind: 'image' | 'video' | 'audio' | 'file', caption: string): string {
  const what = `[${mediaLabel(m?.kind ?? kind)}${m?.name ? `: ${m.src ? decodeURIComponentSafe(m.src) : m.name}` : ''}]`;
  return caption ? `${what} ${caption}` : what;
}

/**
 * A caption in italics. Trimmed first: "*Sunset *" isn't italic in Markdown, and "* Sunset*" on a
 * line of its own is a list item.
 */
function captionMd(caption: string): string {
  const c = caption.trim();
  return c ? `*${escapeMd(c)}*` : '';
}

const withCaption = (md: string, caption: string) => (caption.trim() ? `${md}\n${captionMd(caption)}` : md);

/** A link block: clickable only for web and email addresses (D89); anything else is written out. */
function linkMd(label: string, url: string): string {
  const href = safeHref(url);
  return href ? `[${escapeMd(label)}](${mdUrl(href)})` : escapeLine(escapeMd(label === url ? url : `${label} (${url})`));
}

// ── rich text ────────────────────────────────────────────────────────────────────────────────────

function block(n: RichNode, ctx: Ctx, sep = '\n\n'): string {
  const kids = (s = sep) =>
    (n.content ?? [])
      .map((c) => block(c, ctx, s))
      .filter(Boolean)
      .join(s);
  switch (n.type) {
    case 'doc':
      return (n.content ?? [])
        .map((c) => block(c, { ...ctx, topHeading: hasTopHeading(n) }, sep))
        .filter(Boolean)
        .join(sep);
    case 'paragraph':
      return paragraph(n.content ?? [], ctx);
    case 'heading': {
      // A heading is one line: a line break inside one becomes a space.
      const text = paragraph((n.content ?? []).map((c) => (c.type === 'hardBreak' ? { type: 'text', text: ' ' } : c)), ctx);
      if (!text) return '';
      if (ctx.mode === 'text') return text;
      const level = Math.max(1, outputHeadingLevel(n, ctx.shift, ctx.topHeading ?? false));
      return `${'#'.repeat(level)} ${keepClosingHashes(text)}`;
    }
    case 'bulletList':
      return (n.content ?? []).map((li) => listItem(li, '- ', ctx)).join('\n');
    case 'orderedList': {
      const start = Number(n.attrs?.['start'] ?? 1);
      const first = Number.isInteger(start) ? start : 1;
      return (n.content ?? []).map((li, i) => listItem(li, `${first + i}. `, ctx)).join('\n');
    }
    case 'listItem':
    case 'taskItem':
      return listItemBody(n, ctx);
    case 'taskList':
      // GitHub's task lists: "- [x] done". Nested lines indent by the bullet only, or four more
      // spaces would make them code.
      return (n.content ?? []).map((li) => listItem(li, `${ctx.mode === 'md' ? '- ' : ''}[${li.attrs?.['checked'] === true ? 'x' : ' '}] `, ctx, 2)).join('\n');
    case 'codeBlock': {
      const code = (n.content ?? []).map((c) => c.text ?? '').join('');
      if (ctx.mode === 'text') return code;
      const fence = '`'.repeat(Math.max(3, longestRun(code, '`') + 1));
      return `${fence}\n${code}\n${fence}`;
    }
    case 'table':
      return table(n, ctx);
    case 'blockquote':
      return kids()
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'horizontalRule':
      return '* * *';
    case 'text':
    case 'hardBreak':
      return paragraph([n], ctx);
    default:
      // Unknown block: keep its words.
      return n.content?.some((c) => c.type === 'text') ? paragraph(n.content, ctx) : kids();
  }
}

/**
 * A list item's blocks: a blank line between paragraphs (or they'd merge, and text after a nested
 * list would join the sub-item). A paragraph followed by its own sub-list stays tight only where
 * Markdown lets a list start straight after a paragraph: a bullet or a list from 1, with a first
 * item that isn't empty (an empty "-" under a line would underline it into a heading).
 */
function listItemBody(li: RichNode, ctx: Ctx): string {
  let out = '';
  let prev: RichNode | undefined;
  for (const c of li.content ?? []) {
    const md = block(c, ctx);
    if (!md) continue;
    const tight = prev?.type === 'paragraph' && /^(?:- |1\. )\S/.test(md);
    if (out) out += tight ? '\n' : '\n\n';
    out += md;
    prev = c;
  }
  return out;
}

function listItem(li: RichNode, marker: string, ctx: Ctx, indent = marker.length): string {
  const body = listItemBody(li, ctx);
  const [first = '', ...rest] = body.split('\n');
  const pad = ' '.repeat(indent);
  return [marker + first, ...rest.map((l) => (l ? pad + l : l))].join('\n');
}

/** A paragraph's inline content; a line that would start a list or heading is escaped. */
function paragraph(nodes: RichNode[], ctx: Ctx): string {
  // A line break at either end of a paragraph would leave a stray backslash.
  const text = inline(nodes, ctx)
    .replace(/^(?:\s*\\\n)+/, '')
    .replace(/(?:\\\n\s*)+$/, '')
    .trim();
  return ctx.mode === 'md' ? text.split('\n').map(escapeLine).join('\n') : text;
}

/** Inline runs, grouping neighbours that share one link into a single link. */
function inline(nodes: RichNode[], ctx: Ctx): string {
  let out = '';
  for (let i = 0; i < nodes.length; ) {
    const href = linkOf(nodes[i]!);
    let j = i + 1;
    if (href) while (j < nodes.length && linkOf(nodes[j]!) === href) j++;
    const run = nodes.slice(i, j);
    const inner = run.map((r) => leaf(r, ctx)).join('');
    if (!href) out += inner;
    else {
      const words = run.map((r) => r.text ?? '').join('');
      const isAddress = shortUrl(words.trim()).toLowerCase() === shortUrl(href).toLowerCase();
      if (ctx.mode === 'text') out += isAddress ? words : `${words} (${href})`;
      else out += isAddress && !/[\s<>]/.test(href) ? `<${href}>` : `[${inner}](${mdUrl(href)})`;
    }
    i = j;
  }
  return out;
}

/** Marks Markdown has no syntax for, as HTML, which Markdown readers render (colours and fonts are dropped). */
const TAG_MARKS: Record<string, [string, string]> = {
  underline: ['<u>', '</u>'],
  highlight: ['<mark>', '</mark>'],
  subscript: ['<sub>', '</sub>'],
  superscript: ['<sup>', '</sup>'],
};
const MD_MARKS: Record<string, [string, string]> = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], ...TAG_MARKS };
/** The same marks as HTML, which Markdown readers render wherever they appear. */
const HTML_MARKS: Record<string, [string, string]> = { bold: ['<strong>', '</strong>'], italic: ['<em>', '</em>'], strike: ['<s>', '</s>'], ...TAG_MARKS };
const EDGE_PUNCTUATION = /^[\p{P}\p{S}]|[\p{P}\p{S}]$/u;

function leaf(n: RichNode, ctx: Ctx): string {
  if (n.type === 'hardBreak') return ctx.mode === 'md' ? '\\\n' : '\n';
  if (n.type !== 'text') return inline(n.content ?? [], ctx);
  const raw = n.text ?? '';
  if (ctx.mode === 'text') return raw;
  // Markers hug the words: "** bold**" isn't bold in Markdown, so spaces go outside them.
  const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw) ?? [];
  if (!core) return raw;
  // Code takes no other marks; it's written as it is, between enough backticks.
  if (n.marks?.some((m) => m.type === 'code')) {
    const ticks = '`'.repeat(longestRun(core, '`') + 1);
    return lead + (core.startsWith('`') || core.endsWith('`') ? `${ticks} ${core} ${ticks}` : `${ticks}${core}${ticks}`) + trail;
  }
  let md = escapeMd(core);
  // `**"quote"**word` isn't bold in Markdown (a marker next to punctuation must also have a space
  // or punctuation on its outside), and Chinese and Japanese have no spaces: HTML tags then.
  const marks = EDGE_PUNCTUATION.test(core) ? HTML_MARKS : MD_MARKS;
  for (const m of n.marks ?? []) {
    const wrap = marks[m.type];
    if (wrap) md = `${wrap[0]}${md}${wrap[1]}`;
  }
  return lead + md + trail;
}

/** The longest run of `ch` in `s`. */
function longestRun(s: string, ch: string): number {
  let best = 0;
  let run = 0;
  for (const c of s) {
    run = c === ch ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * A table: GitHub's Markdown table, each cell's lines joined with `<br>` (cells hold one line); a
 * table without a header row gets an empty one, which Markdown requires. Plain text: one line per
 * row, cells between " | ".
 */
function table(n: RichNode, ctx: Ctx): string {
  const rows = (n.content ?? []).filter((r) => r.type === 'tableRow');
  const cells = rows.map((r) =>
    (r.content ?? []).flatMap((c) => {
      const text = (c.content ?? [])
        .map((b) => block(b, ctx, '\n'))
        .filter(Boolean)
        .join('\n');
      const one = ctx.mode === 'md' ? text.split('\n').join('<br>') : text.split('\n').join(' / ');
      const span = Number(c.attrs?.['colspan'] ?? 1);
      return [one, ...Array<string>(Number.isInteger(span) && span > 1 ? Math.min(span, 50) - 1 : 0).fill('')];
    }),
  );
  if (!cells.length) return '';
  if (ctx.mode === 'text') return cells.map((r) => r.join(' | ')).join('\n');
  const width = Math.max(...cells.map((r) => r.length), 1);
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  const headed = rows[0]?.content?.every((c) => c.type === 'tableHeader') ?? false;
  const head = headed ? cells.shift()! : [];
  return [line(head), `|${Array.from({ length: width }, () => ' --- |').join('')}`, ...cells.map(line)].join('\n');
}

function linkOf(n: RichNode): string | undefined {
  return safeHref(n.marks?.find((m) => m.type === 'link')?.attrs?.['href']);
}

/** Characters that are Markdown syntax anywhere in a line. */
export function escapeMd(s: string): string {
  return s.replace(/[\\`*_[\]<>~|]/g, '\\$&').replace(/&(?=#?[a-z0-9]+;)/gi, '&amp;');
}

/** A `#` at the end of a heading would be read as its closing sequence and dropped. */
function keepClosingHashes(heading: string): string {
  return heading.replace(/(^|\s)(#+)(\s*)$/, '$1\\$2$3');
}

/** A line that would start a heading, quote, list or rule. */
function escapeLine(line: string): string {
  return line.replace(/^(\s*)(#|>|[-+=]|\d+(?=[.)]))/, (_m, sp: string, c: string) => (/^\d/.test(c) ? `${sp}${c}\\` : `${sp}\\${c}`));
}

/** A link target; angle brackets when it holds spaces or parentheses. */
function mdUrl(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
