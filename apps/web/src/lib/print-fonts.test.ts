import { describe, expect, it } from 'vitest';
import { PRINT_FONT_STYLESHEETS } from '@logbook/core';
import { PRINT_FONT_SPECIFIERS, absoluteCssUrls } from './print-fonts.ts';

describe('print fonts', () => {
  it('loads exactly the stylesheets the server renders with', () => {
    expect(PRINT_FONT_SPECIFIERS).toEqual([...PRINT_FONT_STYLESHEETS]);
  });

  it('makes font URLs absolute, because Paged.js resolves them against about:srcdoc', () => {
    const css = `@font-face { src: url(/assets/a.woff2) format('woff2'), url("./b.woff") format('woff'), url('data:font/woff2;base64,AA==') }`;
    expect(absoluteCssUrls(css, 'https://logbook.example/app/')).toBe(
      `@font-face { src: url(https://logbook.example/assets/a.woff2) format('woff2'), url("https://logbook.example/app/b.woff") format('woff'), url('data:font/woff2;base64,AA==') }`,
    );
  });
});
