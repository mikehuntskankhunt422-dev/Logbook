/*
 * Fonts for the app's own screens (D91): the ones text can be set in (core's FONTS), and the
 * colour flag font. The same static files as the printed book (print-fonts.ts), so a page shows
 * text the way it prints. A font file only loads once something on screen uses it.
 */
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/400-italic.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/atkinson-hyperlegible/700-italic.css';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/400-italic.css';
import '@fontsource/opendyslexic/700.css';
import '@fontsource/opendyslexic/700-italic.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/lora/700.css';
import '@fontsource/lora/700-italic.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/700-italic.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/700-italic.css';
import flagFont from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url';
import { FLAG_FONT } from '@logbook/core';

/**
 * Twemoji Country Flags (CC-BY 4.0): only flags, by its unicode-range, first in every font stack.
 * Windows' emoji font draws a flag as two letters; this draws the flag everywhere.
 */
export function loadFlagFont(): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  const face = new FontFace(FLAG_FONT, `url(${flagFont}) format('woff2')`, {
    unicodeRange: 'U+1F1E6-1F1FF, U+1F3F4, U+E0062-E0063, U+E0065, U+E0067, U+E006C, U+E006E, U+E0073-E0074, U+E0077, U+E007F',
    display: 'swap',
  });
  document.fonts.add(face);
}
