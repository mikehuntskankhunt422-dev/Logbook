import { describe, expect, it } from 'vitest';
import { isShipCountry, LULU_NO_SHIPPING, SHIP_COUNTRIES, STRIPE_CHECKOUT_COUNTRIES, TAX_ID_COUNTRIES } from '../src/index.ts';

describe('destination countries (D60, open question #5)', () => {
  it('are Stripe’s Checkout countries that Lulu ships to', () => {
    expect(SHIP_COUNTRIES.length).toBeGreaterThan(150);
    for (const c of SHIP_COUNTRIES) expect(STRIPE_CHECKOUT_COUNTRIES).toContain(c);
    for (const c of LULU_NO_SHIPPING) expect(isShipCountry(c), c).toBe(false);
    for (const c of ['AU', 'US', 'GB', 'CA', 'NZ', 'DE']) expect(isShipCountry(c), c).toBe(true);
  });

  it('include the countries that need a recipient tax ID (D26)', () => {
    for (const c of Object.keys(TAX_ID_COUNTRIES)) expect(isShipCountry(c), c).toBe(true);
  });
});
