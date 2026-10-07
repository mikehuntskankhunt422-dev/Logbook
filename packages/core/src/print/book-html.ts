import { GRADIENTS, type Entry, type MediaMeta } from '../model.ts';
import { blockHtml, type PrintAssets } from './blocks-html.ts';
import { pageGeometry } from './geometry.ts';
import { esc } from './html.ts';
import { MOOD_SVG } from './mood-svg.ts';
import { formatDateRange, formatLongDate, formatMonth, formatShortDate, type BookOptions } from './options.ts';
import { linkNotesHtml } from './richtext-html.ts';

export interface BookInput {
  options: BookOptions;
  /** Already selected and sorted (selectEntries). */
  entries: Entry[];
  meta(id: string): MediaMeta | undefined;
  assets: PrintAssets;
  /** Blank "Notes" pages appended at the end (from padPageCount). */
  notesPages: number;
  /** ISO date printed on the colophon. Passed in so a re-render is byte-identical. */
  printedOn: string;
}

/** Lines on a Notes page; fits the text block of both trims. */
const NOTES_LINES = 18;

/**
 * The book's body HTML. It doesn't depend on the gutter: margins live in the stylesheet
 * (print-css.ts), so the planner can re-run layout with a new gutter without rebuilding this.
 */
export function bookBodyHtml(input: BookInput): string {
  const { options, entries } = input;
  const geometry = pageGeometry(options.product.trim, 0);
  const parts: string[] = [titlePage(input), colophon(input)];
  if (options.contents && entries.length) parts.push(contents(input));

  const perMonth = new Map<string, number>();
  for (const e of entries) perMonth.set(e.date.slice(0, 7), (perMonth.get(e.date.slice(0, 7)) ?? 0) + 1);
  let month = '';
  entries.forEach((entry, i) => {
    const m = entry.date.slice(0, 7);
    if (options.monthDividers && m !== month) {
      const count = perMonth.get(m)!;
      parts.push(
        `<section class="month-divider" id="month-${m}"><h2>${formatMonth(m)}</h2><p>${count} ${count === 1 ? 'entry' : 'entries'}</p></section>`,
      );
    }
    month = m;
    parts.push(entryHtml(entry, i, input, geometry));
  });

  for (let n = 0; n < input.notesPages; n++) {
    parts.push(`<section class="notes-page"><h2>Notes</h2>${'<div class="rule"></div>'.repeat(NOTES_LINES)}</section>`);
  }
  return parts.join('\n');
}

function titlePage({ options, entries }: BookInput): string {
  const range = entries.length ? formatDateRange(entries[0]!.date, entries.at(-1)!.date) : '';
  return (
    `<section class="title-page"><h1>${esc(options.title)}</h1>` +
    (options.subtitle ? `<p class="subtitle">${esc(options.subtitle)}</p>` : '') +
    (range ? `<p class="range">${esc(range)}</p>` : '') +
    (options.author ? `<p class="author">${esc(options.author)}</p>` : '') +
    `</section>`
  );
}

function colophon({ options, entries, printedOn }: BookInput): string {
  const moods = entries.some((e) => e.mood);
  return (
    `<section class="colophon">` +
    `<p>${esc(options.title)}${options.author ? ` · ${esc(options.author)}` : ''}</p>` +
    `<p>${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}. Written in Logbook, printed by Lulu.</p>` +
    `<p>Book made ${formatShortDate(printedOn)}.</p>` +
    (moods ? `<p class="credit">Mood emoji: Twemoji by Twitter, Inc. and contributors, CC-BY 4.0.</p>` : '') +
    `</section>`
  );
}

function contents({ entries, options }: BookInput): string {
  let month = '';
  const items = entries.map((e, i) => {
    const m = e.date.slice(0, 7);
    const head = options.monthDividers && m !== month ? `<li class="toc-month">${formatMonth(m)}</li>` : '';
    month = m;
    const label = e.title ? `${formatShortDate(e.date)} · ${esc(e.title)}` : formatShortDate(e.date);
    return `${head}<li class="toc-entry"><span class="toc-title">${label}</span><span class="toc-dots"></span><span class="toc-page" data-ref="#entry-${i}"></span></li>`;
  });
  return `<nav class="contents"><h2>Contents</h2><ol>${items.join('')}</ol></nav>`;
}

function entryHtml(entry: Entry, index: number, input: BookInput, geometry: ReturnType<typeof pageGeometry>): string {
  const { options, assets } = input;
  const links: string[] = [];
  const ctx = { geometry, meta: input.meta, assets, links };
  const flow = options.entryStart === 'flow';

  let band: string;
  if (entry.cover.kind === 'photo') {
    const url = assets.imageUrl(entry.cover.mediaId);
    band = url ? `<div class="band band-photo"><img class="cover" src="${esc(url)}" alt=""></div>` : `<div class="band band-plain"></div>`;
  } else {
    band = `<div class="band${flow ? ' band-thin' : ''}" style="background-image:${esc(GRADIENTS[entry.cover.gradient].css)}"></div>`;
  }
  const mood = entry.mood ? `<span class="mood">${MOOD_SVG[entry.mood]}</span>` : '';
  const title = entry.title ? `<h2 class="entry-title">${esc(entry.title)}${mood}</h2>` : '';
  const tags = entry.tags.length ? `<p class="tags">${entry.tags.map((t) => `#${esc(t)}`).join('  ')}</p>` : '';
  const date = `<p class="entry-date">${formatLongDate(entry.date)}${title ? '' : mood}</p>`;
  const blocks = entry.blocks.map((b) => blockHtml(b, ctx)).join('');

  return (
    `<article class="entry${flow ? '' : ' entry-new-page'}" id="entry-${index}" data-runhead="${formatMonth(entry.date)}">` +
    `<header class="entry-head">${band}${date}${title}${tags}</header>${blocks}${linkNotesHtml(links)}</article>`
  );
}

/** A complete HTML document. `head` is where the renderer adds its font stylesheets and scripts. */
export function bookDocument(parts: { css: string; body: string; head?: string; title?: string }): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(parts.title ?? 'Logbook')}</title>` +
    `${parts.head ?? ''}<style>${parts.css}</style></head><body>${parts.body}</body></html>`
  );
}
