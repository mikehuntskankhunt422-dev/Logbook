import { z } from 'zod';

/** Lulu's curated product set (PLAN §4). Only the dotted package-ID format is used (D19). */

export const TRIMS = {
  '6x9': { label: '6 × 9 in', widthIn: 6, heightIn: 9, code: '0600X0900' },
  '8.5x11': { label: '8.5 × 11 in', widthIn: 8.5, heightIn: 11, code: '0850X1100' },
} as const;
export type TrimId = keyof typeof TRIMS;

export const INTERIORS = {
  color: { label: 'Premium colour', ink: 'FC', quality: 'PRE', paper: '080CW444' },
  bw: { label: 'Black & white', ink: 'BW', quality: 'STD', paper: '060UW444' },
} as const;
export type InteriorId = keyof typeof INTERIORS;

export const BINDINGS = {
  paperback: { label: 'Paperback', code: 'PB', minPages: 32, maxPages: 800 },
  hardcover: { label: 'Hardcover', code: 'CW', minPages: 24, maxPages: 800 },
} as const;
export type BindingId = keyof typeof BINDINGS;

export const FINISHES = {
  matte: { label: 'Matte', code: 'MXX' },
  gloss: { label: 'Gloss', code: 'GXX' },
} as const;
export type FinishId = keyof typeof FINISHES;

/** Every printed page and the cover extend this far past the trim on each side (L1, L3 p.23). */
export const BLEED_IN = 0.125;
/** Nothing important may sit closer than this to a trim edge (L3 p.23). */
export const SAFETY_IN = 0.5;
/**
 * A hardcover's printed case wrap folds this far around the board on each outer edge, on top of the
 * bleed (Lulu help centre; the sandbox's `/cover-dimensions/` gives trim + 0.875″ per edge).
 */
export const HARDCOVER_WRAP_IN = 0.75;

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const productSchema = z.object({
  trim: z.enum(keys(TRIMS)).default('6x9'),
  interior: z.enum(keys(INTERIORS)).default('color'),
  binding: z.enum(keys(BINDINGS)).default('paperback'),
  finish: z.enum(keys(FINISHES)).default('matte'),
});
export type Product = z.infer<typeof productSchema>;

/** 6×9 premium-colour matte paperback: the only product where the price anchors hold (D20). */
export const DEFAULT_PRODUCT: Product = productSchema.parse({});

/** `0600X0900.FC.PRE.PB.080CW444.MXX` — [Trim].[Ink].[Quality].[Binding].[Paper].[Finish]. */
export function podPackageId(p: Product): string {
  const i = INTERIORS[p.interior];
  return [TRIMS[p.trim].code, i.ink, i.quality, BINDINGS[p.binding].code, i.paper, FINISHES[p.finish].code].join('.');
}

export function allProducts(): Product[] {
  const out: Product[] = [];
  for (const trim of keys(TRIMS))
    for (const interior of keys(INTERIORS))
      for (const binding of keys(BINDINGS))
        for (const finish of keys(FINISHES)) out.push({ trim, interior, binding, finish });
  return out;
}

export function pageLimits(p: Product): { min: number; max: number } {
  const b = BINDINGS[p.binding];
  return { min: b.minPages, max: b.maxPages };
}

export function productLabel(p: Product): string {
  return `${TRIMS[p.trim].label} ${INTERIORS[p.interior].label.toLowerCase()} ${BINDINGS[p.binding].label.toLowerCase()}, ${FINISHES[p.finish].label.toLowerCase()}`;
}
