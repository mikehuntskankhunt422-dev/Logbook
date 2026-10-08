import { PRICING, type PricingConfig } from './config.ts';

/** What Lulu charges us for one book, before shipping. US cents. */
export interface BookCost {
  printCents: number;
  /** Lulu's per-order fulfilment fee ($0.75 in the sandbox). */
  fulfillmentCents: number;
}

export interface BookPrice {
  priceCents: number;
  costCents: number;
  /** Which rule set the price. */
  rule: 'markup' | 'margin-floor' | 'minimum';
  /** What's left after Lulu, Stripe's worst case and the reserve. */
  netCents: number;
  netMargin: number;
}

/** Dollars to cents, without float drift (Lulu sends "15.88"). */
export function toCents(usd: number | string): number {
  return Math.round(Number(usd) * 100);
}

/** Rounds up to the next $X.99. */
export function friendly(cents: number): number {
  return Math.ceil((Math.ceil(cents) - 99) / 100) * 100 + 99;
}

/** Stripe's worst-case fees and the reserve for a charge of `cents`. */
function deductions(cents: number, c: PricingConfig): number {
  return cents * (c.stripePercent + c.reservePercent) + c.stripeFixedCents;
}

/**
 * The book price (PLAN §7, D25): the larger of the minimum price, the cost marked up plus handling,
 * and the lowest price that still leaves the minimum net margin. All rounded up to $X.99, so the
 * margin floor holds after rounding and the price can never be below cost.
 */
export function bookPrice(cost: BookCost, c: PricingConfig = PRICING): BookPrice {
  const costCents = cost.printCents + cost.fulfillmentCents;
  const markup = friendly(costCents * c.markup + c.handlingCents);
  // net = price × (1 − stripe% − reserve%) − fixed − cost ≥ margin × price
  const floor = friendly((costCents + c.stripeFixedCents) / (1 - c.stripePercent - c.reservePercent - c.minNetMargin));
  const priceCents = Math.max(c.minimumCents, markup, floor);
  const rule = priceCents === markup ? 'markup' : priceCents === floor ? 'margin-floor' : 'minimum';
  const netCents = Math.round(priceCents - deductions(priceCents, c) - costCents);
  return { priceCents, costCents, rule, netCents, netMargin: netCents / priceCents };
}

/**
 * What the customer pays for shipping: Lulu's quote grossed up for Stripe's percentage fees, plus a
 * buffer for the re-quote with the full address after payment, rounded up to the next 50¢.
 */
export function shippingPrice(luluCents: number, c: PricingConfig = PRICING): number {
  const grossed = luluCents / (1 - c.stripePercent) + c.shippingBufferCents;
  return Math.ceil(Math.round(grossed * 100) / 100 / c.shippingStepCents) * c.shippingStepCents;
}
