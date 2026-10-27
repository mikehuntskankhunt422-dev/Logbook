import type { RichNode } from './model.ts';
import { esc } from './html-text.ts';
import { fontStackFor } from './fonts.ts';
import { safeAlign, safeColor } from './richtext.ts';

/**
 * Pieces of HTML shared by the web-page export and the printed book (D91). Only checked values
 * reach the markup: opaque `#rrggbb` colours, Logbook's own fonts or a safe name of your own
 * (D107), a fixed set of alignments and whole-number cell spans. Everything else in a document is
 * text, escaped.
 */

/** Marks that are one HTML element each. */
export const MARK_TAGS: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  strike: 's',
  underline: 'u',
  code: 'code',
  subscript: 'sub',
  superscript: 'sup',
};

type Mark = NonNullable<RichNode['marks']>[number];

/** Wraps `html` in one mark: an element, or a span for a colour, highlight or font. */
export function wrapMark(m: Mark, html: string): string {
  const tag = MARK_TAGS[m.type];
  if (tag) return `<${tag}>${html}</${tag}>`;
  if (m.type === 'highlight') {
    const color = safeColor(m.attrs?.['color']);
    return color ? `<mark style="background-color:${color}">${html}</mark>` : `<mark>${html}</mark>`;
  }
  if (m.type === 'textStyle') {
    const styles: string[] = [];
    const color = safeColor(m.attrs?.['color']);
    if (color) styles.push(`color:${color}`);
    const font = fontStackFor(m.attrs?.['fontFamily']);
    if (font) styles.push(`font-family:${esc(font)}`);
    return styles.length ? `<span style="${styles.join(';')}">${html}</span>` : html;
  }
  return html;
}

/** ` style="text-align:…"` for a centred, right-aligned or justified paragraph or heading. */
export function alignStyle(n: RichNode): string {
  const align = safeAlign(n.attrs?.['textAlign']);
  return align ? ` style="text-align:${align}"` : '';
}

/** A table, its cells rendered by `blocks`; a column or row span only when it's a whole number. */
export function tableHtml(n: RichNode, blocks: (cell: RichNode) => string): string {
  const rows = (n.content ?? []).filter((r) => r.type === 'tableRow');
  const body = rows
    .map((r) => {
      const cells = (r.content ?? [])
        .map((c) => {
          const tag = c.type === 'tableHeader' ? 'th' : 'td';
          return `<${tag}${span(c, 'colspan')}${span(c, 'rowspan')}>${blocks(c)}</${tag}>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table><tbody>${body}</tbody></table>`;
}

function span(c: RichNode, attr: 'colspan' | 'rowspan'): string {
  const v = Number(c.attrs?.[attr] ?? 1);
  return Number.isInteger(v) && v > 1 && v <= 50 ? ` ${attr}="${v}"` : '';
}

/** A code block: its text as written, line breaks kept. */
export function codeBlockHtml(n: RichNode): string {
  return `<pre><code>${esc((n.content ?? []).map((c) => c.text ?? '').join(''))}</code></pre>`;
}

/** Whether a task item is ticked. */
export function isChecked(n: RichNode): boolean {
  return n.attrs?.['checked'] === true;
}
