import type { Block, Entry, RichNode } from '../model.ts';
import { shortUrl } from '../print/html.ts';
import { mediaLabel, metaLine, safeHref, type MediaLookup, type RenderOptions } from './common.ts';

/**
 * Markdown and plain text from entries (D89). One walker for both: Markdown keeps headings, lists,
 * quotes, emphasis and links and escapes what would otherwise turn into markup; plain text keeps
 * the same shape (list markers, quotes) with links written out after their words.
 */

type Mode = 'md' | 'text';

interface Ctx {
  mode: Mode;
  /** Added to an editor heading's level: the entry title is `#` in its own file, `##` in a shared one. */
  shift: number;
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
  out.push(`${'#'.repeat(level)} ${escapeLine(escapeMd(entry.title || 'Untitled'))}`);
  out.push(`*${metaLine(entry, opts).map(escapeMd).join(' · ')}*`);
  if (entry.cover.kind === 'photo') out.push(mediaMd(media(entry.cover.mediaId), 'Cover photo', ''));
  for (const b of entry.blocks) {
    const md = blockMd(b, media, ctx);
    if (md) out.push(md);
  }
  return `${out.filter(Boolean).join('\n\n')}\n`;
}

export function entryToText(entry: Entry, media: MediaLookup, opts: RenderOptions = {}): string {
  const ctx: Ctx = { mode: 'text', shift: 0 };
  const out = [`${entry.title || 'Untitled'}\n${metaLine(entry, opts).join(' · ')}`];
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
      return [...b.items.map((i) => mediaMd(media(i.mediaId), 'Photo', i.caption)), b.caption ? `*${escapeMd(b.caption)}*` : ''].filter(Boolean).join('\n\n');
    case 'link':
      return withCaption(`[${escapeMd(b.title || shortUrl(b.url))}](${mdUrl(b.url)})`, b.caption);
    case 'embed':
      return withCaption(`[▶ ${escapeMd(b.title || `${b.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`)}](${mdUrl(b.url)})`, b.caption);
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
  const cap = caption ? `\n*${escapeMd(caption)}*` : '';
  if (!m?.src) return `*\\[${label}${m?.name ? `: ${escapeMd(m.name)}` : ''}\\]*${cap}`;
  if (m.kind === 'image') return `![${escapeMd(caption || m.name)}](${mdUrl(m.src)})${cap}`;
  const icon = m.kind === 'video' ? '▶' : m.kind === 'audio' ? '🔊' : '📎';
  return `[${icon} ${escapeMd(m.name)}](${mdUrl(m.src)})${cap}`;
}

function mediaText(m: ReturnType<MediaLookup>, kind: 'image' | 'video' | 'audio' | 'file', caption: string): string {
  const what = `[${mediaLabel(m?.kind ?? kind)}${m?.name ? `: ${m.src ? decodeURIComponentSafe(m.src) : m.name}` : ''}]`;
  return caption ? `${what} ${caption}` : what;
}

const withCaption = (md: string, caption: string) => (caption ? `${md}\n*${escapeMd(caption)}*` : md);

// ── rich text ────────────────────────────────────────────────────────────────────────────────────

function block(n: RichNode, ctx: Ctx, sep = '\n\n'): string {
  const kids = (s = sep) =>
    (n.content ?? [])
      .map((c) => block(c, ctx, s))
      .filter(Boolean)
      .join(s);
  switch (n.type) {
    case 'doc':
      return kids();
    case 'paragraph':
      return paragraph(n.content ?? [], ctx);
    case 'heading': {
      const text = paragraph(n.content ?? [], ctx);
      if (!text) return '';
      if (ctx.mode === 'text') return text;
      const level = Math.min(6, (n.attrs?.['level'] === 3 ? 3 : 2) + ctx.shift - 1);
      return `${'#'.repeat(level)} ${text}`;
    }
    case 'bulletList':
      return (n.content ?? []).map((li) => listItem(li, '- ', ctx)).join('\n');
    case 'orderedList': {
      const start = Number(n.attrs?.['start'] ?? 1);
      const first = Number.isInteger(start) ? start : 1;
      return (n.content ?? []).map((li, i) => listItem(li, `${first + i}. `, ctx)).join('\n');
    }
    case 'listItem':
      return kids('\n');
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

function listItem(li: RichNode, marker: string, ctx: Ctx): string {
  const body = block(li, ctx, '\n') || '';
  const [first = '', ...rest] = body.split('\n');
  const pad = ' '.repeat(marker.length);
  return [marker + first, ...rest.map((l) => (l ? pad + l : l))].join('\n');
}

/** A paragraph's inline content; a line that would start a list or heading is escaped. */
function paragraph(nodes: RichNode[], ctx: Ctx): string {
  const text = inline(nodes, ctx).trim();
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

const MD_MARKS: Record<string, [string, string]> = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], underline: ['<u>', '</u>'] };

function leaf(n: RichNode, ctx: Ctx): string {
  if (n.type === 'hardBreak') return ctx.mode === 'md' ? '\\\n' : '\n';
  if (n.type !== 'text') return inline(n.content ?? [], ctx);
  const raw = n.text ?? '';
  if (ctx.mode === 'text') return raw;
  // Markers hug the words: "** bold**" isn't bold in Markdown, so spaces go outside them.
  const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw) ?? [];
  if (!core) return raw;
  let md = escapeMd(core);
  for (const m of n.marks ?? []) {
    const wrap = MD_MARKS[m.type];
    if (wrap) md = `${wrap[0]}${md}${wrap[1]}`;
  }
  return lead + md + trail;
}

function linkOf(n: RichNode): string | undefined {
  return safeHref(n.marks?.find((m) => m.type === 'link')?.attrs?.['href']);
}

/** Characters that are Markdown syntax anywhere in a line. */
export function escapeMd(s: string): string {
  return s.replace(/[\\`*_[\]<>~|]/g, '\\$&').replace(/&(?=#?[a-z0-9]+;)/gi, '&amp;');
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
