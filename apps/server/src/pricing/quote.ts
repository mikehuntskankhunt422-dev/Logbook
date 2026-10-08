import { allProducts, pageLimits, podPackageId } from '@logbook/core';
import type { LuluClient, ShippingOption } from '../lulu/client.ts';
import { PRICING } from './config.ts';
import { bookPrice, shippingPrice, toCents } from './price.ts';

/** The package IDs Logbook sells, with their page limits. Nothing else is passed on to Lulu. */
export const PACKAGES = new Map(allProducts().map((p) => [podPackageId(p), pageLimits(p)]));

/** Checks a package ID and page count against what Logbook sells; returns an error message or null. */
export function checkBook(podPackageId: string, pages: number): string | null {
  const limits = PACKAGES.get(podPackageId);
  if (!limits) return 'Unknown pod_package_id.';
  if (!Number.isInteger(pages) || pages % 2 !== 0 || pages < limits.min || pages > limits.max) return `pages must be an even number from ${limits.min} to ${limits.max}.`;
  return null;
}

/** Where book costs are asked for: the print cost doesn't depend on the destination (LS), only tax and shipping do. */
const REFERENCE_ADDRESS = { street1: '1 SE Main St', city: 'Portland', stateCode: 'OR', countryCode: 'US', postcode: '97201', phoneNumber: '+1 503 555 0100' };


export interface ShippingQuote {
  level: string;
  name: string;
  daysMin: number | null;
  daysMax: number | null;
  priceCents: number;
}

export interface Quote {
  podPackageId: string;
  pages: number;
  currency: 'usd';
  bookCents: number;
  /** Present when a destination was given. */
  country?: string;
  shipping?: ShippingQuote[];
}

/** A quote with Lulu's costs behind it: kept on the order so its prices can be reproduced, never sent to customers. */
export interface CostedQuote extends Quote {
  costCents: number;
  shipping?: (ShippingQuote & { luluCents: number })[];
}

/** The customer-facing part of a quote. */
export function publicQuote(q: CostedQuote): Quote {
  const { costCents: _cost, shipping, ...rest } = q;
  return { ...rest, ...(shipping ? { shipping: shipping.map(({ luluCents: _lulu, ...s }) => s) } : {}) };
}

/**
 * At most three choices for Checkout (PLAN §1.5 step 5): the cheapest, the fastest, and the cheapest
 * of the rest that arrives sooner than the cheapest. One per Lulu level.
 */
export function pickShipping(options: ShippingOption[]): ShippingOption[] {
  const cost = (o: ShippingOption) => o.cost_excl_tax;
  const days = (o: ShippingOption) => o.total_days_max ?? Number.POSITIVE_INFINITY;
  const byLevel = new Map<string, ShippingOption>();
  for (const o of options.filter((o) => o.is_active !== false)) {
    const seen = byLevel.get(o.level);
    if (!seen || cost(o) < cost(seen)) byLevel.set(o.level, o);
  }
  const all = [...byLevel.values()].sort((a, b) => cost(a) - cost(b) || days(a) - days(b));
  if (all.length <= 3) return all;
  const cheapest = all[0]!;
  const fastest = [...all].sort((a, b) => days(a) - days(b) || cost(a) - cost(b))[0]!;
  const middle = all.find((o) => o !== cheapest && o !== fastest && days(o) < days(cheapest));
  return [cheapest, ...(middle ? [middle] : []), ...(fastest === cheapest ? [] : [fastest])].sort((a, b) => cost(a) - cost(b));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Prices books from Lulu's live costs (D25). Content-free: it sees a package ID, a page count and
 * optionally a destination country. Costs are cached for a day; shipping quotes for an hour.
 */
export class Quoter {
  private costs = new Map<string, { at: number; value: Promise<number> }>();
  private shipping = new Map<string, { at: number; value: Promise<ShippingOption[]> }>();

  constructor(
    private readonly lulu: LuluClient,
    private readonly now: () => number = Date.now,
  ) {}

  async quote(podPackageId: string, pages: number, destination?: { country: string; state?: string }): Promise<CostedQuote> {
    const costCents = await this.cached(this.costs, `${podPackageId}@${pages}`, DAY_MS, async () => {
      const c = await this.lulu.costCalculation({ lineItems: [{ podPackageId, pageCount: pages, quantity: 1 }], shippingAddress: REFERENCE_ADDRESS, shippingOption: 'MAIL' });
      if (c.currency.toLowerCase() !== PRICING.currency) throw new Error(`Lulu quoted in ${c.currency}`);
      return toCents(c.line_item_costs[0]!.total_cost_excl_tax) + toCents(c.fulfillment_cost?.total_cost_excl_tax ?? 0);
    });
    const book = bookPrice({ printCents: costCents, fulfillmentCents: 0 });
    const quote: CostedQuote = { podPackageId, pages, currency: 'usd', bookCents: book.priceCents, costCents };
    if (!destination) return quote;

    const key = `${podPackageId}@${pages}@${destination.country}@${destination.state ?? ''}`;
    const options = await this.cached(this.shipping, key, DAY_MS / 24, () =>
      this.lulu.shippingOptions({ podPackageId, pageCount: pages, quantity: 1 }, destination.country, destination.state),
    );
    quote.country = destination.country;
    quote.shipping = pickShipping(options.filter((o) => o.currency.toLowerCase() === PRICING.currency)).map((o) => ({
      level: o.level,
      name: o.carrier_service_name,
      daysMin: o.total_days_min ?? null,
      daysMax: o.total_days_max ?? null,
      priceCents: shippingPrice(toCents(o.cost_excl_tax)),
      luluCents: toCents(o.cost_excl_tax),
    }));
    return quote;
  }

  private cached<T>(map: Map<string, { at: number; value: Promise<T> }>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = map.get(key);
    if (hit && this.now() - hit.at < ttl) return hit.value;
    const value = load();
    // A failure isn't remembered (unless a newer lookup has replaced it meanwhile).
    value.catch(() => map.get(key)?.value === value && map.delete(key));
    // Bounded: oldest entries go first.
    if (map.size >= 5000) map.delete(map.keys().next().value!);
    map.set(key, { at: this.now(), value });
    return value;
  }
}
