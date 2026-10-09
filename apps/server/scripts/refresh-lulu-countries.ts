/**
 * Which of Stripe's Checkout countries Lulu ships to (open question #5, D60):
 *
 *   npm run lulu:countries -w @logbook/server
 *
 * Asks the Lulu sandbox's `/shipping-options/` for one 100-page 6 × 9 in premium-colour paperback to
 * every country Stripe Checkout can ship to, and rewrites `packages/core/src/print/lulu-countries.ts`
 * with the ones that got at least one shipping option. The order page offers only those (Stripe's
 * list ∩ Lulu's), so nobody picks a country only to be told there's no shipping. Prints a summary
 * for docs/M4.md. Needs LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { STRIPE_CHECKOUT_COUNTRIES } from '@logbook/core';
import { loadConfig } from '../src/config.ts';
import { LuluClient, LuluError, type ShippingOption } from '../src/lulu/client.ts';

const config = loadConfig();
if (!config.lulu || config.mode !== 'test') throw new Error('Set LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET (sandbox only).');
const lulu = new LuluClient(config.lulu);
const ITEM = { podPackageId: '0600X0900.FC.PRE.PB.080CW444.MXX', pageCount: 100, quantity: 1 };

interface Answer {
  country: string;
  options: ShippingOption[];
  error?: string;
}

const answers: Answer[] = [];
const queue = [...STRIPE_CHECKOUT_COUNTRIES];
// A few at a time: about 250 small requests.
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let country = queue.shift(); country; country = queue.shift()) {
      try {
        answers.push({ country, options: (await lulu.shippingOptions(ITEM, country)).filter((o) => o.is_active !== false) });
      } catch (err) {
        answers.push({ country, options: [], error: err instanceof LuluError ? `HTTP ${err.status}` : String(err).slice(0, 100) });
      }
    }
  }),
);
answers.sort((a, b) => a.country.localeCompare(b.country));
const unexpected = answers.filter((a) => a.error && a.error !== 'HTTP 400');
if (unexpected.length) throw new Error(`Lulu didn't answer for ${unexpected.map((a) => `${a.country} (${a.error})`).join(', ')}; run again.`);

const ships = answers.filter((a) => a.options.length);
const none = answers.filter((a) => !a.options.length).map((a) => a.country);
const ddu = ships.filter((a) => a.options.some((o) => /\bDDU\b/i.test(o.carrier_service_name))).map((a) => a.country);
const today = new Date().toISOString().slice(0, 10);

const wrap = (codes: string[]) =>
  codes
    .map((c) => `'${c}'`)
    .reduce<string[]>((lines, c) => {
      const last = lines.at(-1);
      if (last !== undefined && `${last}, ${c}`.length <= 98) lines[lines.length - 1] = `${last}, ${c}`;
      else lines.push(c);
      return lines;
    }, [])
    .map((l) => `  ${l},`)
    .join('\n');

const file = `/**
 * Countries Lulu ships to: those of Stripe's Checkout countries for which the Lulu sandbox's
 * \`/shipping-options/\` offered at least one option for a 100-page 6 × 9 in premium-colour paperback
 * on ${today}. Written by \`npm run lulu:countries -w @logbook/server\`
 * (apps/server/scripts/refresh-lulu-countries.ts); don't edit by hand.
 */
export const LULU_COUNTRIES: readonly string[] = [
${wrap(ships.map((a) => a.country))}
];

/** Where Lulu answered 400 (no shipping) on ${today}. */
export const LULU_NO_SHIPPING: readonly string[] = [
${wrap(none)}
];
`;
const path = fileURLToPath(new URL('../../../packages/core/src/print/lulu-countries.ts', import.meta.url));
await writeFile(path, file);

const cheapest = (a: Answer) => Math.min(...a.options.map((o) => o.cost_excl_tax));
console.log(`**${today}, Lulu sandbox:** ${ships.length} of ${answers.length} Stripe Checkout countries have shipping; ${none.length} don't.`);
console.log('');
console.log(`- No shipping: ${none.join(', ') || 'none'}`);
console.log(`- Some option named DDU (duties unpaid): ${ddu.join(', ') || 'none'}`);
console.log(`- Options per country: ${[1, 2, 3, 4, 5].map((n) => `${n}: ${ships.filter((a) => a.options.length === n).length}`).join(', ')}, more: ${ships.filter((a) => a.options.length > 5).length}`);
console.log(`- Cheapest shipping for one book: from $${Math.min(...ships.map(cheapest)).toFixed(2)} to $${Math.max(...ships.map(cheapest)).toFixed(2)}`);
console.error(`Wrote ${path}`);
