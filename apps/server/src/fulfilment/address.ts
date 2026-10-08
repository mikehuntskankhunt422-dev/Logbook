import type { LuluAddress } from '../lulu/client.ts';
import type { Payment } from '../orders/db.ts';

/** Lulu's limits (ASSUMPTIONS L1): name 35, street lines and city 30, phone 8–20 of these characters. */
export const LIMITS = { name: 35, street: 30, city: 30 } as const;
const PHONE = /^\+?[\d\s\-./()]{8,20}$/;

/** The address can't go to Lulu as it is; a person has to sort it out with the customer (PLAN risk #7). */
export class AddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddressError';
  }
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Fits Stripe's two address lines into Lulu's two 30-character lines: as they are when they fit,
 * otherwise re-wrapped at spaces and commas, keeping the words in order. Null when the words can't
 * fit (a single word over 30 characters, or more than two lines' worth).
 */
export function fitStreet(line1: string, line2: string): [string, string] | null {
  if (line1.length <= LIMITS.street && line2.length <= LIMITS.street) return [line1, line2];
  const words = `${line1}${line2 ? `, ${line2}` : ''}`.split(' ').filter(Boolean);
  const lines: string[] = [''];
  for (const word of words) {
    if (word.length > LIMITS.street) return null;
    const current = lines.at(-1)!;
    const joined = current ? `${current} ${word}` : word;
    if (joined.length <= LIMITS.street) lines[lines.length - 1] = joined;
    else lines.push(word);
  }
  if (lines.length > 2) return null;
  // A line break where a comma was needs no comma.
  return [lines[0]!.replace(/,$/, ''), (lines[1] ?? '').replace(/^,\s*/, '')];
}

/**
 * Lulu's shipping address from what Stripe Checkout collected (PLAN §1.5 step 7). Throws
 * `AddressError` when something Lulu requires is missing or can't be made to fit.
 */
export function luluAddress(p: Payment): LuluAddress {
  const a = p.address;
  if (!a?.country) throw new AddressError('Stripe has no shipping address for this order.');
  const name = clean(p.name);
  if (!name) throw new AddressError('The shipping address has no name.');
  if (name.length > LIMITS.name) throw new AddressError(`The recipient's name is longer than Lulu's ${LIMITS.name} characters.`);
  const street = fitStreet(clean(a.line1), clean(a.line2));
  if (!street || !street[0]) throw new AddressError(`The street address doesn't fit Lulu's two lines of ${LIMITS.street} characters.`);
  const city = clean(a.city);
  if (!city) throw new AddressError('The shipping address has no city.');
  if (city.length > LIMITS.city) throw new AddressError(`The city is longer than Lulu's ${LIMITS.city} characters.`);
  const phone = clean(p.phone);
  if (!PHONE.test(phone)) throw new AddressError('The phone number is missing or not in a form Lulu accepts.');
  const email = clean(p.email);
  if (!email) throw new AddressError('There is no email address for the carrier.');
  // Stripe gives subdivision codes for the countries that need them (US, CA, AU, …); anything
  // longer is a region name Lulu wouldn't take as a state code.
  const state = clean(a.state).toUpperCase();
  const postcode = clean(a.postalCode);
  return {
    name,
    street1: street[0],
    ...(street[1] ? { street2: street[1] } : {}),
    city,
    ...(/^[A-Z0-9]{1,3}$/.test(state) ? { stateCode: state } : {}),
    countryCode: a.country,
    postcode,
    phoneNumber: phone,
    email,
    ...(p.recipientTaxId ? { recipientTaxId: clean(p.recipientTaxId) } : {}),
  };
}
