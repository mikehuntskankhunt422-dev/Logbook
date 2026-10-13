import type { Block, Entry, RichNode } from '../model.ts';
import { esc, shortUrl } from '../print/html.ts';
import { alignStyle, codeBlockHtml, isChecked, tableHtml, wrapMark } from '../rich-html.ts';
import { hasTopHeading, outputHeadingLevel } from '../richtext.ts';
import { mediaLabel, metaLine, safeHref, type ExportMedia, type MediaLookup, type RenderOptions } from './common.ts';

/**
 * Entries as a web page (D89): the "Web page" export, and the page Logbook prints for "PDF". Unlike
 * the book's print HTML (D38), links stay clickable. Everything from an entry is escaped; links
 * other than web and email addresses stay text. Videos play in the web page; in print, a video
 * shows its poster frame and recordings and files are named.
 */

export interface HtmlOptions extends RenderOptions {
  /** `page`: a saved web page (videos and recordings play). `print`: the page printed to PDF. */
  mode?: 'page' | 'print';
}

/** All the entries' markup, inside `<div class="lbx">`; pair it with EXPORT_CSS. */
export function entriesHtml(entries: Entry[], media: MediaLookup, opts: HtmlOptions = {}): string {
  return `<div class="lbx">${entries.map((e) => entryHtml(e, media, opts)).join('')}</div>`;
}

export function entryHtml(entry: Entry, media: MediaLookup, opts: HtmlOptions = {}): string {
  const mode = opts.mode ?? 'page';
  const parts = [`<h2 class="lbx-title">${esc(entry.title || 'Untitled')}</h2>`, `<p class="lbx-meta">${metaLine(entry, opts).map(esc).join(' · ')}</p>`];
  if (entry.cover.kind === 'photo') parts.push(mediaHtml(media(entry.cover.mediaId), '', mode, 'image'));
  // Background music (D91): a player in a saved page; nothing on paper.
  if (entry.musicId && mode === 'page') parts.push(mediaHtml(media(entry.musicId), 'Background music', mode, 'audio'));
  if (entry.musicUrl && mode === 'page') parts.push(`<p class="lbx-attachment">🎵 Background music: ${anchor(entry.musicUrl, entry.musicUrl)}</p>`);
  for (const b of entry.blocks) parts.push(blockHtml(b, media, mode));
  return `<article class="lbx-entry">${parts.join('')}</article>`;
}

/** A whole web page: title, a line about the export, the entries. */
export function exportPageHtml(entries: Entry[], media: MediaLookup, opts: HtmlOptions & { title?: string; subtitle?: string } = {}): string {
  const title = opts.title ?? 'Logbook';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body class="lbx-page">
<header class="lbx-header"><h1>${esc(title)}</h1>${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ''}</header>
${entriesHtml(entries, media, opts)}
</body>
</html>
`;
}

function blockHtml(b: Block, media: MediaLookup, mode: 'page' | 'print'): string {
  switch (b.type) {
    case 'text':
      return `<div class="lbx-text">${richTextToExportHtml(b.doc)}</div>`;
    case 'photo':
      return mediaHtml(media(b.mediaId), b.caption, mode, 'image');
    case 'video':
    case 'audio':
    case 'file':
      return mediaHtml(media(b.mediaId), b.caption, mode, b.type);
    case 'gallery':
      return `<figure class="lbx-gallery lbx-${b.layout}"><div class="lbx-grid">${b.items.map((i) => mediaHtml(media(i.mediaId), i.caption, mode, 'image')).join('')}</div>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
    case 'link':
      return `<p class="lbx-link">${anchor(b.url, b.title || shortUrl(b.url))}${b.caption ? `<br><span class="lbx-caption">${esc(b.caption)}</span>` : ''}</p>`;
    case 'embed': {
      const label = `▶ ${b.title || `${b.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video`}`;
      return `<p class="lbx-link">${anchor(b.url, label)}${mode === 'print' ? ` <span class="lbx-url">${esc(shortUrl(b.url))}</span>` : ''}${b.caption ? `<br><span class="lbx-caption">${esc(b.caption)}</span>` : ''}</p>`;
    }
  }
}

function mediaHtml(m: ExportMedia | undefined, caption: string, mode: 'page' | 'print', expected: ExportMedia['kind']): string {
  const kind = m?.kind ?? expected;
  const cap = caption ? `<figcaption>${esc(caption)}</figcaption>` : '';
  const size = m?.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
  // Lazy loading only in a saved page: the print layout is hidden on screen, where a lazy picture never loads.
  const lazy = mode === 'page' ? ' loading="lazy"' : '';
  if (m?.src && kind === 'image') return `<figure class="lbx-figure"><img src="${esc(m.src)}" alt="${esc(caption || m.name)}"${size}${lazy}>${cap}</figure>`;
  if (m?.src && kind === 'video' && mode === 'page') return `<figure class="lbx-figure"><video src="${esc(m.src)}" controls preload="metadata"${size}></video>${cap}</figure>`;
  if (m?.src && kind === 'audio' && mode === 'page') return `<figure class="lbx-figure"><audio src="${esc(m.src)}" controls preload="metadata"></audio>${cap}</figure>`;
  if (kind === 'video' && m?.posterSrc && mode === 'print')
    return `<figure class="lbx-figure"><img src="${esc(m.posterSrc)}" alt="${esc(caption || m.name)}"${size}><figcaption>▶ ${esc(m.name)}${caption ? ` · ${esc(caption)}` : ''}</figcaption></figure>`;
  // Not part of the export, or nothing to show on paper: name it.
  const icon = kind === 'video' ? '▶' : kind === 'audio' ? '🔊' : kind === 'image' ? '🖼' : '📎';
  const name = m?.name ? `${mediaLabel(kind)}: ${m.name}` : mediaLabel(kind);
  const label = m?.src && mode === 'page' ? `<a href="${esc(m.src)}">${icon} ${esc(name)}</a>` : `${icon} ${esc(name)}`;
  return `<p class="lbx-attachment">${label}${caption ? `<br><span class="lbx-caption">${esc(caption)}</span>` : ''}</p>`;
}

function anchor(href: string, text: string): string {
  const safe = safeHref(href);
  return safe ? `<a href="${esc(safe)}" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
}

// ── rich text ────────────────────────────────────────────────────────────────────────────────────

/** HTML for a TipTap document, with clickable links. Unknown nodes keep their words. */
export function richTextToExportHtml(doc: RichNode | undefined): string {
  return doc ? node(doc, hasTopHeading(doc)) : '';
}

/** `topHeading`: the document has an H1, which goes just below the entry title (`h2`, D91). */
function node(n: RichNode, topHeading: boolean): string {
  const kids = () => inline(n.content ?? []);
  const blocks = (of: RichNode = n) => (of.content ?? []).map((c) => node(c, topHeading)).join('');
  switch (n.type) {
    case 'doc':
      return blocks();
    case 'paragraph':
      return n.content?.length ? `<p${alignStyle(n)}>${kids()}</p>` : '';
    case 'heading': {
      const tag = `h${outputHeadingLevel(n, 2, topHeading)}`;
      return `<${tag}${alignStyle(n)}>${kids()}</${tag}>`;
    }
    case 'taskList':
      return `<ul class="lbx-tasks">${blocks()}</ul>`;
    case 'taskItem': {
      const done = isChecked(n);
      return `<li class="lbx-task${done ? ' lbx-done' : ''}"><input type="checkbox" disabled${done ? ' checked' : ''} aria-label="${done ? 'Done' : 'Not done'}"><div>${blocks()}</div></li>`;
    }
    case 'codeBlock':
      return codeBlockHtml(n);
    case 'table':
      return `<div class="lbx-table">${tableHtml(n, (c) => blocks(c))}</div>`;
    case 'bulletList':
      return `<ul>${blocks()}</ul>`;
    case 'orderedList': {
      const start = Number(n.attrs?.['start'] ?? 1);
      return Number.isInteger(start) && start !== 1 ? `<ol start="${start}">${blocks()}</ol>` : `<ol>${blocks()}</ol>`;
    }
    case 'listItem':
      return `<li>${blocks()}</li>`;
    case 'blockquote':
      return `<blockquote>${blocks()}</blockquote>`;
    case 'horizontalRule':
      return '<hr>';
    case 'text':
    case 'hardBreak':
      return inline([n]);
    default:
      return n.content?.some((c) => c.type === 'text') ? `<p>${kids()}</p>` : blocks();
  }
}

function inline(nodes: RichNode[]): string {
  let out = '';
  for (let i = 0; i < nodes.length; ) {
    const href = linkOf(nodes[i]!);
    let j = i + 1;
    if (href) while (j < nodes.length && linkOf(nodes[j]!) === href) j++;
    const html = nodes.slice(i, j).map(leaf).join('');
    out += href ? `<a href="${esc(href)}" rel="noopener noreferrer">${html}</a>` : html;
    i = j;
  }
  return out;
}

function leaf(n: RichNode): string {
  if (n.type === 'hardBreak') return '<br>';
  let html = n.type === 'text' ? esc(n.text ?? '') : inline(n.content ?? []);
  for (const m of n.marks ?? []) html = wrapMark(m, html);
  return html;
}

function linkOf(n: RichNode): string | undefined {
  return safeHref(n.marks?.find((m) => m.type === 'link')?.attrs?.['href']);
}

/**
 * The export's look, scoped to `.lbx` so the same rules work in a saved page and inside the app's
 * own document when it prints. Light and dark on screen; always light on paper.
 */
export const EXPORT_CSS = `
.lbx-page { margin: 0; padding: 2rem 1rem 4rem; background: #fbfaf7; color: #1f1d1a; }
.lbx-header, .lbx { max-width: 44rem; margin: 0 auto; }
.lbx-header h1 { font: 700 2rem/1.2 "Twemoji Country Flags", system-ui, sans-serif; margin: 0 0 .25rem; }
.lbx-header p { color: #6b665d; margin: 0 0 2rem; font: 1rem/1.4 "Twemoji Country Flags", system-ui, sans-serif; }
.lbx { font: 1.0625rem/1.65 "Twemoji Country Flags", Georgia, "Iowan Old Style", "Times New Roman", serif; color: #1f1d1a; }
.lbx-entry { padding: 1.5rem 0 2rem; border-top: 1px solid #e3ded4; }
.lbx-entry:first-child { border-top: 0; }
.lbx .lbx-title { font: 700 1.5rem/1.25 "Twemoji Country Flags", system-ui, sans-serif; margin: 0 0 .25rem; }
.lbx .lbx-meta { font: .9rem/1.4 "Twemoji Country Flags", system-ui, sans-serif; color: #6b665d; margin: 0 0 1rem; }
.lbx h3 { font: 700 1.2rem/1.3 "Twemoji Country Flags", system-ui, sans-serif; margin: 1.25rem 0 .5rem; }
.lbx h4 { font: 700 1.05rem/1.3 "Twemoji Country Flags", system-ui, sans-serif; margin: 1rem 0 .5rem; }
.lbx h5 { font: 700 1rem/1.3 "Twemoji Country Flags", system-ui, sans-serif; margin: 1rem 0 .5rem; }
.lbx h6 { font: 700 .9rem/1.3 "Twemoji Country Flags", system-ui, sans-serif; margin: 1rem 0 .5rem; text-transform: uppercase; letter-spacing: .04em; }
.lbx mark { color: #1f1d1a; background: #fff176; padding: 0 .1em; border-radius: 2px; }
.lbx code { font: .9em/1.4 ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace; background: #efebe3; padding: .05em .3em; border-radius: 4px; }
.lbx pre { background: #efebe3; padding: .75rem 1rem; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 .75rem; }
.lbx pre code { background: none; padding: 0; }
.lbx-table { overflow-x: auto; margin: 0 0 .75rem; }
.lbx table { border-collapse: collapse; width: 100%; }
.lbx th, .lbx td { border: 1px solid #d8d2c6; padding: .35rem .6rem; vertical-align: top; text-align: left; }
.lbx th { background: #f3efe7; }
.lbx td > :last-child, .lbx th > :last-child { margin-bottom: 0; }
.lbx-tasks { list-style: none; padding-left: .25rem; }
.lbx-task { display: flex; gap: .5rem; align-items: baseline; }
.lbx-task > div { flex: 1; }
.lbx-done > div { text-decoration: line-through; color: #6b665d; }
.lbx p { margin: 0 0 .75rem; }
.lbx blockquote { margin: 0 0 .75rem; padding-left: 1rem; border-left: 3px solid #d8d2c6; color: #4a463f; }
.lbx ul, .lbx ol { margin: 0 0 .75rem; padding-left: 1.5rem; }
.lbx hr { border: 0; border-top: 1px solid #e3ded4; margin: 1.25rem 0; }
.lbx a { color: #1d5fa8; }
.lbx-figure { margin: 0 0 1rem; }
.lbx-figure img, .lbx-figure video { display: block; max-width: 100%; height: auto; border-radius: 6px; }
.lbx-figure audio { width: 100%; }
.lbx figcaption, .lbx-caption { font: .9rem/1.4 "Twemoji Country Flags", system-ui, sans-serif; color: #6b665d; margin-top: .35rem; }
.lbx-gallery { margin: 0 0 1rem; }
.lbx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: .5rem; }
.lbx-grid .lbx-figure { margin: 0; }
.lbx-grid img { width: 100%; aspect-ratio: 1; object-fit: cover; }
.lbx-attachment, .lbx-link { font: .95rem/1.45 "Twemoji Country Flags", system-ui, sans-serif; }
.lbx-url { color: #6b665d; }
@media (prefers-color-scheme: dark) {
  .lbx-page { background: #181715; }
  .lbx-page .lbx, .lbx-page .lbx-header h1 { color: #ece8e1; }
  .lbx-page .lbx-meta, .lbx-page figcaption, .lbx-page .lbx-caption, .lbx-page .lbx-header p, .lbx-page .lbx-url { color: #a9a397; }
  .lbx-page .lbx-entry, .lbx-page hr { border-color: #34312c; }
  .lbx-page blockquote { color: #c9c3b8; border-color: #4a463f; }
  .lbx-page a { color: #8bb8f0; }
  .lbx-page code, .lbx-page pre, .lbx-page th { background: #26241f; }
  .lbx-page th, .lbx-page td { border-color: #4a463f; }
}
@media print {
  @page { margin: 18mm 16mm; }
  .lbx-page { background: #fff; padding: 0; }
  .lbx, .lbx-page .lbx { color: #000; font-size: 11pt; }
  .lbx-page .lbx-header h1 { color: #000; }
  .lbx .lbx-title { break-after: avoid; }
  .lbx-figure, .lbx-attachment, .lbx-link, .lbx tr, .lbx pre { break-inside: avoid; }
  .lbx-entry > .lbx-figure img { max-height: 120mm; width: auto; }
  .lbx a { color: inherit; text-decoration: none; }
}
`;
