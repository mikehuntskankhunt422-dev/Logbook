import type { Product } from '@logbook/core';

/** The products the samples are rendered in: the default book, the largest and most different one, and black and white. */
export const SAMPLE_PRODUCTS = {
  '6x9-pb-matte': { trim: '6x9', interior: 'color', binding: 'paperback', finish: 'matte' },
  '8.5x11-cw-gloss': { trim: '8.5x11', interior: 'color', binding: 'hardcover', finish: 'gloss' },
  '6x9-bw-pb-matte': { trim: '6x9', interior: 'bw', binding: 'paperback', finish: 'matte' },
} satisfies Record<string, Product>;
export type SampleProductId = keyof typeof SAMPLE_PRODUCTS;
