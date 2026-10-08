/**
 * Every pricing knob in one place (PLAN §7, D25). Money is in US cents: Lulu quotes and Stripe
 * charges in USD. Change a number here and the unit tests show what moves.
 */
export const PRICING = {
  currency: 'usd',

  /** Book price = max(minimum, friendly(cost × markup + handling), friendly(margin floor)). */
  markup: 1.35,
  handlingCents: 800,
  minimumCents: 2499,
  /** Net margin the floor guarantees after Lulu, Stripe and the reserve. */
  minNetMargin: 0.25,

  /**
   * Stripe's worst case per payment: international card 3.5% + currency conversion 2% + Stripe Tax
   * 0.5%, plus a fixed fee of about US$0.20 (A$0.30). AU pricing, ASSUMPTIONS S4.
   */
  stripePercent: 0.035 + 0.02 + 0.005,
  stripeFixedCents: 20,
  /** Kept back from every book for refunds and reprints. */
  reservePercent: 0.04,

  /** Shipping = Lulu's quote grossed up for Stripe's percentage, plus a buffer, rounded up to this step. */
  shippingBufferCents: 100,
  shippingStepCents: 50,
} as const;

export type PricingConfig = typeof PRICING;
