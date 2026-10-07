import { describe, expect, it } from 'vitest';
import { PRICING } from '../src/pricing/config.ts';
import { bookPrice, friendly, shippingPrice, toCents } from '../src/pricing/price.ts';

/** Lulu's list prices (ASSUMPTIONS L2), which the sandbox matched exactly for all 16 packages (LS). */
const BASE = { '6x9': { PB: 199, CW: 1068 }, '8.5x11': { PB: 216, CW: 1098 } } as const;
const PER_PAGE = { '6x9': { PRE: 13.89, BW: 2.5 }, '8.5x11': { PRE: 21.48, BW: 3.85 } } as const;
const cost = (trim: keyof typeof BASE, ink: 'PRE' | 'BW', binding: 'PB' | 'CW', pages: number) => ({
  printCents: BASE[trim][binding] + PER_PAGE[trim][ink] * pages,
  fulfillmentCents: 75,
});
const dollars = (cents: number) => (cents / 100).toFixed(2);

describe('friendly prices', () => {
  it('round up to the next $X.99', () => {
    expect([3045, 3099, 3100, 2400.2, 99, 100].map(friendly)).toEqual([3099, 3099, 3199, 2499, 99, 199]);
  });

  it('turn Lulu’s decimal strings into exact cents', () => {
    // 19.99 × 100 is 1998.9999999999998 in floating point.
    expect([toCents('15.88'), toCents(0.75), toCents('22.32'), toCents('19.99'), toCents(0.1 + 0.2)]).toEqual([1588, 75, 2232, 1999, 30]);
  });
});

describe('book price (PLAN §7, D25)', () => {
  it('reproduces the approved table for premium colour', () => {
    const row = (trim: keyof typeof BASE, binding: 'PB' | 'CW') =>
      [binding === 'PB' ? 32 : 24, 100, 200, 300].map((p) => dollars(bookPrice(cost(trim, 'PRE', binding, p)).priceCents));
    expect(row('6x9', 'PB')).toEqual(['24.99', '30.99', '49.99', '68.99']);
    expect(row('6x9', 'CW')).toEqual(['27.99', '42.99', '60.99', '82.99']);
    expect(row('8.5x11', 'PB')).toEqual(['24.99', '40.99', '70.99', '103.99']);
    expect(row('8.5x11', 'CW')).toEqual(['30.99', '52.99', '84.99', '117.99']);
  });

  it('charges the minimum for short paperbacks and B&W books', () => {
    expect(bookPrice(cost('6x9', 'PRE', 'PB', 32))).toMatchObject({ priceCents: 2499, rule: 'minimum' });
    for (const p of [32, 100, 200, 300]) expect(bookPrice(cost('6x9', 'BW', 'PB', p))).toMatchObject({ priceCents: 2499, rule: 'minimum' });
    expect(bookPrice(cost('6x9', 'BW', 'PB', 800)).priceCents).toBe(3899);
  });

  it('marks a hardcover up by its real extra cost, not a flat amount', () => {
    const pb = bookPrice(cost('6x9', 'PRE', 'PB', 100));
    const cw = bookPrice(cost('6x9', 'PRE', 'CW', 100));
    expect(cw.costCents - pb.costCents).toBe(869);
    expect(cw.priceCents - pb.priceCents).toBe(1200);
    expect(cw.rule).toBe('markup');
  });

  it('switches to the margin floor where the markup would earn less than 25%', () => {
    const r = bookPrice(cost('6x9', 'PRE', 'PB', 300));
    expect(r.rule).toBe('margin-floor');
    expect(r.priceCents).toBe(6899);
    // The markup alone would have given $67.99.
    expect(friendly(r.costCents * PRICING.markup + PRICING.handlingCents)).toBe(6799);
  });

  it('keeps at least the minimum margin and never sells below cost, for every product and page count', () => {
    for (const trim of ['6x9', '8.5x11'] as const)
      for (const ink of ['PRE', 'BW'] as const)
        for (const binding of ['PB', 'CW'] as const)
          for (let pages = binding === 'PB' ? 32 : 24; pages <= 800; pages += 2) {
            const r = bookPrice(cost(trim, ink, binding, pages));
            const label = `${trim} ${ink} ${binding} ${pages}`;
            expect(r.netMargin, label).toBeGreaterThanOrEqual(PRICING.minNetMargin);
            expect(r.priceCents, label).toBeGreaterThan(r.costCents);
            expect(r.priceCents % 100, label).toBe(99);
          }
  });

  it('prices the largest book (800 pages, 8.5×11 premium hardcover) by the margin floor', () => {
    const r = bookPrice(cost('8.5x11', 'PRE', 'CW', 800));
    expect(r).toMatchObject({ priceCents: 28299, rule: 'margin-floor' });
    expect(r.netMargin).toBeGreaterThanOrEqual(0.25);
    expect(r.netMargin).toBeLessThan(0.26);
  });
});

describe('shipping price', () => {
  it('grosses Lulu’s quote up for Stripe, adds the buffer and rounds up to 50¢', () => {
    // Sandbox quotes: AU MAIL $8.34, AU EXPRESS $15.19, US MAIL $5.69.
    expect([834, 1519, 569].map((c) => shippingPrice(c))).toEqual([1000, 1750, 750]);
    expect(shippingPrice(0)).toBe(100);
  });

  it('always covers Lulu’s quote and Stripe’s percentage', () => {
    for (let c = 0; c <= 10_000; c += 7) {
      const p = shippingPrice(c);
      expect(p * (1 - PRICING.stripePercent)).toBeGreaterThanOrEqual(c);
      expect(p % 50).toBe(0);
    }
  });
});
