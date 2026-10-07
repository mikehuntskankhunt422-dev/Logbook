import { bookDocument, coverHtml, coverLayout, type BookOptions, type CoverDimensions, type CoverLayout } from '@logbook/core';
import { FONT_LINKS } from './assets.ts';
import { openRoutedPage } from './browser.ts';
import { finishCover } from './pdf.ts';

export interface CoverSource {
  options: BookOptions;
  /** Final interior page count. */
  pages: number;
  /** From Lulu's `/cover-dimensions/`, or the offline estimate when `approximate`. */
  dims: CoverDimensions;
  approximate: boolean;
  dateRange: string;
  /** Print-ready front photo, when options.cover is a photo. */
  frontImage?: string;
}

export interface CoverResult {
  pdf: Uint8Array;
  layout: CoverLayout;
  blocked: string[];
}

/** The wraparound cover: one page at Lulu's exact size, laid out by Chromium itself (no pagination needed). */
export async function renderCover(src: CoverSource): Promise<CoverResult> {
  const layout = coverLayout(src.options.product, src.pages, src.dims, src.options.spineText, src.approximate);
  const { css, body } = coverHtml({ options: src.options, layout, dateRange: src.dateRange, frontImageUrl: src.frontImage ? '/media/front' : undefined });
  const routed = await openRoutedPage((path) => (path === '/media/front' ? src.frontImage : undefined));
  try {
    await routed.show(bookDocument({ title: src.options.title, head: FONT_LINKS, css, body }));
    const raw = await routed.page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: false, outline: false });
    const pdf = await finishCover(raw, layout.width * 72, layout.height * 72);
    return { pdf, layout, blocked: [...routed.blocked] };
  } finally {
    await routed.close();
  }
}
