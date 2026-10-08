import type { RichNode } from '../model.ts';
import { esc, shortUrl } from './html.ts';

/**
 * Print HTML for a TipTap document (D41). Covers the editor's node set (paragraphs, H2/H3, lists,
 * quotes, rules, hard breaks; bold, italic, strike, underline, links). Unknown nodes print their
 * text so nothing written is ever lost. Everything is escaped; nothing from the entry becomes markup.
 *
 * Links never become `<a href>` (D38): linked text gets a note number, and the entry ends with the
 * numbered addresses. Text that already is the address prints as-is without a note.
 */
export function richTextToHtml(doc: RichNode | undefined, links: string[] = []): string {
  return doc ? node(doc, links) : '';
}

const MARK_TAGS: Record<string, string> = { bold: 'strong', italic: 'em', strike: 's', underline: 'u' };

function node(n: RichNode, links: string[]): string {
  const kids = () => inline(n.content ?? [], links);
  const blocks = () => (n.content ?? []).map((c) => node(c, links)).join('');
  switch (n.type) {
    case 'doc':
      return blocks();
    case 'paragraph':
      return n.content?.length ? `<p>${kids()}</p>` : '<p class="blank"></p>';
    case 'heading': {
      const tag = n.attrs?.['level'] === 3 ? 'h4' : 'h3';
      return `<${tag}>${kids()}</${tag}>`;
    }
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
      return inline([n], links);
    default:
      // Unknown block: keep its words.
      return n.content?.some((c) => c.type === 'text') ? `<p>${kids()}</p>` : blocks();
  }
}

/** Inline runs, grouping neighbours that share one link so a split link gets a single note number. */
function inline(nodes: RichNode[], links: string[]): string {
  let out = '';
  for (let i = 0; i < nodes.length; ) {
    const href = linkOf(nodes[i]!);
    let j = i + 1;
    if (href) while (j < nodes.length && linkOf(nodes[j]!) === href) j++;
    const run = nodes.slice(i, j);
    const html = run.map(leaf).join('');
    if (href) {
      const text = run.map((r) => r.text ?? '').join('');
      if (isTheAddress(text, href)) out += `<span class="url">${esc(shortUrl(href))}</span>`;
      else {
        let n = links.indexOf(href) + 1;
        if (!n) n = links.push(href);
        out += `<span class="link">${html}</span><sup class="link-ref">${n}</sup>`;
      }
    } else out += html;
    i = j;
  }
  return out;
}

function leaf(n: RichNode): string {
  if (n.type === 'hardBreak') return '<br>';
  let html = n.type === 'text' ? esc(n.text ?? '') : inline(n.content ?? [], []);
  for (const m of n.marks ?? []) {
    const tag = MARK_TAGS[m.type];
    if (tag) html = `<${tag}>${html}</${tag}>`;
  }
  return html;
}

function linkOf(n: RichNode): string | undefined {
  const href = n.marks?.find((m) => m.type === 'link')?.attrs?.['href'];
  return typeof href === 'string' && href ? href : undefined;
}

function isTheAddress(text: string, href: string): boolean {
  const t = shortUrl(text.trim()).toLowerCase();
  return t === shortUrl(href).toLowerCase();
}

/** The numbered link addresses printed at the end of an entry. */
export function linkNotesHtml(links: string[]): string {
  if (!links.length) return '';
  return `<ol class="link-notes">${links.map((l) => `<li>${esc(shortUrl(l))}</li>`).join('')}</ol>`;
}
