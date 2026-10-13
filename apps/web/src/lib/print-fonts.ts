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
import atkinson400 from '@fontsource/atkinson-hyperlegible/400.css?inline';
import atkinson400i from '@fontsource/atkinson-hyperlegible/400-italic.css?inline';
import atkinson700 from '@fontsource/atkinson-hyperlegible/700.css?inline';
import atkinson700i from '@fontsource/atkinson-hyperlegible/700-italic.css?inline';
import openDyslexic400 from '@fontsource/opendyslexic/400.css?inline';
import openDyslexic400i from '@fontsource/opendyslexic/400-italic.css?inline';
import openDyslexic700 from '@fontsource/opendyslexic/700.css?inline';
import openDyslexic700i from '@fontsource/opendyslexic/700-italic.css?inline';
import lora400 from '@fontsource/lora/400.css?inline';
import lora400i from '@fontsource/lora/400-italic.css?inline';
import lora700 from '@fontsource/lora/700.css?inline';
import lora700i from '@fontsource/lora/700-italic.css?inline';
import playfair400 from '@fontsource/playfair-display/400.css?inline';
import playfair400i from '@fontsource/playfair-display/400-italic.css?inline';
import playfair700 from '@fontsource/playfair-display/700.css?inline';
import playfair700i from '@fontsource/playfair-display/700-italic.css?inline';
import caveat400 from '@fontsource/caveat/400.css?inline';
import caveat700 from '@fontsource/caveat/700.css?inline';
import jetbrainsMono400 from '@fontsource/jetbrains-mono/400.css?inline';
import jetbrainsMono400i from '@fontsource/jetbrains-mono/400-italic.css?inline';
import jetbrainsMono700 from '@fontsource/jetbrains-mono/700.css?inline';
import jetbrainsMono700i from '@fontsource/jetbrains-mono/700-italic.css?inline';

export const PRINT_FONT_SPECIFIERS = [
  '@fontsource/newsreader/400.css',
  '@fontsource/newsreader/400-italic.css',
  '@fontsource/newsreader/700.css',
  '@fontsource/newsreader/700-italic.css',
  '@fontsource/bricolage-grotesque/400.css',
  '@fontsource/bricolage-grotesque/700.css',
  '@fontsource/noto-emoji/400.css',
  '@fontsource/atkinson-hyperlegible/400.css',
  '@fontsource/atkinson-hyperlegible/400-italic.css',
  '@fontsource/atkinson-hyperlegible/700.css',
  '@fontsource/atkinson-hyperlegible/700-italic.css',
  '@fontsource/opendyslexic/400.css',
  '@fontsource/opendyslexic/400-italic.css',
  '@fontsource/opendyslexic/700.css',
  '@fontsource/opendyslexic/700-italic.css',
  '@fontsource/lora/400.css',
  '@fontsource/lora/400-italic.css',
  '@fontsource/lora/700.css',
  '@fontsource/lora/700-italic.css',
  '@fontsource/playfair-display/400.css',
  '@fontsource/playfair-display/400-italic.css',
  '@fontsource/playfair-display/700.css',
  '@fontsource/playfair-display/700-italic.css',
  '@fontsource/caveat/400.css',
  '@fontsource/caveat/700.css',
  '@fontsource/jetbrains-mono/400.css',
  '@fontsource/jetbrains-mono/400-italic.css',
  '@fontsource/jetbrains-mono/700.css',
  '@fontsource/jetbrains-mono/700-italic.css',
];

const css = [newsreader400, newsreader400i, newsreader700, newsreader700i, bricolage400, bricolage700, notoEmoji400, atkinson400, atkinson400i, atkinson700, atkinson700i, openDyslexic400, openDyslexic400i, openDyslexic700, openDyslexic700i, lora400, lora400i, lora700, lora700i, playfair400, playfair400i, playfair700, playfair700i, caveat400, caveat700, jetbrainsMono400, jetbrainsMono400i, jetbrainsMono700, jetbrainsMono700i].join('\n');

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
