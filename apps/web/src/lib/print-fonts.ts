/*
 * The static print fonts (D35) as CSS strings with their font files emitted by Vite, for the book
 * preview iframe. These must be the same files the server renders with, so the preview's line
 * breaks, and therefore its page count, match the PDF. print-fonts.test.ts checks this list against
 * core's PRINT_FONT_STYLESHEETS.
 */
import newsreader400 from '@fontsource/newsreader/400.css?inline';
import newsreader400i from '@fontsource/newsreader/400-italic.css?inline';
import newsreader700 from '@fontsource/newsreader/700.css?inline';
import newsreader700i from '@fontsource/newsreader/700-italic.css?inline';
import bricolage400 from '@fontsource/bricolage-grotesque/400.css?inline';
import bricolage700 from '@fontsource/bricolage-grotesque/700.css?inline';
import notoEmoji400 from '@fontsource/noto-emoji/400.css?inline';

export const PRINT_FONT_SPECIFIERS = [
  '@fontsource/newsreader/400.css',
  '@fontsource/newsreader/400-italic.css',
  '@fontsource/newsreader/700.css',
  '@fontsource/newsreader/700-italic.css',
  '@fontsource/bricolage-grotesque/400.css',
  '@fontsource/bricolage-grotesque/700.css',
  '@fontsource/noto-emoji/400.css',
];

const css = [newsreader400, newsreader400i, newsreader700, newsreader700i, bricolage400, bricolage700, notoEmoji400].join('\n');

/**
 * The font CSS with absolute font URLs. The preview is a srcdoc iframe whose address is
 * `about:srcdoc`; Paged.js resolves every CSS url() against that address and throws on paths like
 * `/assets/x.woff2`, which would stop the preview.
 */
export function printFontCss(base = location.href): string {
  return absoluteCssUrls(css, base);
}

export function absoluteCssUrls(text: string, base: string): string {
  return text.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q: string, url: string) => (url.startsWith('data:') ? m : `url(${q}${new URL(url, base).href}${q})`));
}
