import { z } from 'zod';

/**
 * The curated Lulu product set (PLAN §4, D19, D24). Package IDs use Lulu's dotted format
 * `[Trim].[Ink].[Quality].[Binding].[Paper].[Finish]`; the legacy undotted IDs stop working on 2027-02-01.
 */
export const TRIMS = {
  '6x9': { code: '0600X0900', label: '6 × 9 in', widthIn: 6, heightIn: 9 },
  '8.5x11': { code: '0850X1100', label: '8.5 × 11 in', widthIn: 8.5, heightIn: 11 },
} as const;

export const INTERIORS = {
  color: { code: 'FC.PRE', paper: '080CW444', label: 'Premium colour' },
  bw: { code: 'BW.STD', paper: '060UW444', label: 'Black & white' },
} as const;

/** Page limits from Lulu's spec sheet and Book Creation Guide (ASSUMPTIONS.md, L2/L3). */
export const BINDINGS = {
  paperback: { code: 'PB', label: 'Paperback', minPages: 32, maxPages: 800 },
  hardcover: { code: 'CW', label: 'Hardcover', minPages: 24, maxPages: 800 },
} as const;

export const FINISHES = {
  matte: { code: 'MXX', label: 'Matte' },
  gloss: { code: 'GXX', label: 'Gloss' },
} as const;

export type TrimId = keyof typeof TRIMS;
export type InteriorId = keyof typeof INTERIORS;
export type BindingId = keyof typeof BINDINGS;
export type FinishId = keyof typeof FINISHES;

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const productSchema = z.object({
  trim: z.enum(keys(TRIMS)),
  interior: z.enum(keys(INTERIORS)),
  binding: z.enum(keys(BINDINGS)),
  finish: z.enum(keys(FINISHES)),
});
export type Product = z.infer<typeof productSchema>;

/** D20: 6×9 premium-colour paperback, matte. */
export const DEFAULT_PRODUCT: Product = { trim: '6x9', interior: 'color', binding: 'paperback', finish: 'matte' };

export function packageId(p: Product): string {
  const i = INTERIORS[p.interior];
  return [TRIMS[p.trim].code, i.code, BINDINGS[p.binding].code, i.paper, FINISHES[p.finish].code].join('.');
}

export function parsePackageId(id: string): Product | null {
  for (const p of allProducts()) if (packageId(p) === id) return p;
  return null;
}

/** All 16 curated combinations. */
export function allProducts(): Product[] {
  const out: Product[] = [];
  for (const trim of keys(TRIMS))
    for (const interior of keys(INTERIORS))
      for (const binding of keys(BINDINGS)) for (const finish of keys(FINISHES)) out.push({ trim, interior, binding, finish });
  return out;
}

export function productLabel(p: Product): string {
  return `${TRIMS[p.trim].label} ${BINDINGS[p.binding].label.toLowerCase()}, ${INTERIORS[p.interior].label.toLowerCase()}, ${FINISHES[p.finish].label.toLowerCase()} cover`;
}

export function pageLimits(p: Product): { minPages: number; maxPages: number } {
  const { minPages, maxPages } = BINDINGS[p.binding];
  return { minPages, maxPages };
}
