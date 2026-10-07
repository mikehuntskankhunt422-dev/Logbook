/**
 * Prices every product Logbook sells from live Lulu sandbox costs (PLAN §7 promised this for M3):
 *
 *   npm run pricing:table -w @logbook/server
 *
 * Prints a Markdown table: price, Lulu's cost (print + fulfilment) and net margin after Stripe's
 * worst case and the reserve, at each binding's minimum and at 100, 200, 300 and 800 pages.
 * Needs LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET.
 */
import { allProducts, pageLimits, podPackageId, productLabel } from '@logbook/core';
import { loadConfig } from '../src/config.ts';
import { LuluClient } from '../src/lulu/client.ts';
import { bookPrice, toCents } from '../src/pricing/price.ts';

const config = loadConfig();
if (!config.lulu || config.mode !== 'test') throw new Error('Set LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET (sandbox only).');
const lulu = new LuluClient(config.lulu);
const ADDRESS = { street1: '1 SE Main St', city: 'Portland', stateCode: 'OR', countryCode: 'US', postcode: '97201', phoneNumber: '+1 503 555 0100' };
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Finish (matte or gloss) doesn't change the cost, so one row per trim, interior and binding.
const products = allProducts().filter((p) => p.finish === 'matte');
const rows: string[] = [];
for (const product of products) {
  const pod = podPackageId(product);
  const counts = [pageLimits(product).min, 100, 200, 300, 800];
  const cells = await Promise.all(
    counts.map(async (pages) => {
      const c = await lulu.costCalculation({ lineItems: [{ podPackageId: pod, pageCount: pages, quantity: 1 }], shippingAddress: ADDRESS, shippingOption: 'MAIL' });
      const p = bookPrice({ printCents: toCents(c.line_item_costs[0]!.total_cost_excl_tax), fulfillmentCents: toCents(c.fulfillment_cost?.total_cost_excl_tax ?? 0) });
      return `**${usd(p.priceCents)}** (cost ${usd(p.costCents)}, ${Math.round(p.netMargin * 100)}%${p.rule === 'markup' ? '' : p.rule === 'minimum' ? ', min' : ', floor'})`;
    }),
  );
  rows.push(`| ${productLabel(product).replace(/, matte$/, '')} | ${pageLimits(product).min} | ${cells.join(' | ')} |`);
}
console.log(`Sandbox costs, ${new Date().toISOString().slice(0, 10)}. Each cell: price (Lulu cost incl. $0.75 fulfilment, net margin; "min" = minimum price, "floor" = 25% margin floor).\n`);
console.log('| Product | Min pages | At min | 100 p | 200 p | 300 p | 800 p |');
console.log('|---|---|---|---|---|---|---|');
console.log(rows.join('\n'));
