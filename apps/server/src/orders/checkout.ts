import { isShipCountry, productLabel, TAX_ID_COUNTRIES } from '@logbook/core';
import { LuluError } from '../lulu/client.ts';
import type { Quoter } from '../pricing/quote.ts';
import { StripeApiError, StripeSignatureError, type CheckoutParams, type CheckoutSession, type StripeEvent, type StripeGateway } from '../payments/stripe.ts';
import type { CheckoutRef, Order, OrderDb, Payment, StoredQuote } from './db.ts';
import type { ObjectStore } from '../storage/store.ts';
import { OrderError, printFilesExist } from './service.ts';

/** Stripe's page for an order stays open this long (Stripe's minimum is 30 minutes). */
export const CHECKOUT_TTL_MIN = 60;
/** A stored quote older than this is re-priced before payment, and the customer sees the new numbers (M3 §5). */
export const QUOTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** An open session this close to expiring is replaced rather than handed out again. */
const REUSE_MARGIN_MS = 5 * 60 * 1000;
/** How often reading an order may ask Stripe about its open session (the return page polls). */
const SYNC_EVERY_MS = 10_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Stripe tax codes, checked against the API 2026-10-08: printed books, and shipping sold with them. */
const TAX_CODE_BOOK = 'txcd_35010000';
const TAX_CODE_SHIPPING = 'txcd_92010001';
const TAX_ID_FIELD = 'recipienttaxid';

export const STRIPE_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'] as const;

/** The quote the client saw is no longer the one we'd charge. */
export class PriceChangedError extends OrderError {
  constructor(message = 'The price has changed since this page was loaded. Please check it again.') {
    super(message, 409);
    this.name = 'PriceChangedError';
  }
}

export interface CheckoutDeps {
  db: OrderDb;
  /** Where the print files are: a book is paid for only while they still exist. */
  store?: ObjectStore;
  quoter?: Quoter;
  stripe?: StripeGateway;
  taxEnabled: boolean;
  /** Website origins Stripe may send the customer back to (D15). */
  webOrigins: string[];
  /** Test mode also accepts a loopback website (development and e2e). */
  allowLoopbackReturn: boolean;
  log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
  now?: () => Date;
}

/** Where Stripe sends the customer back to: the website's address without query or fragment, if it's one of ours. */
export function returnBase(url: string, deps: Pick<CheckoutDeps, 'webOrigins' | 'allowLoopbackReturn'>): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const ours = deps.webOrigins.includes(u.origin) || (deps.allowLoopbackReturn && LOOPBACK.has(u.hostname));
  return ours ? `${u.origin}${u.pathname}` : null;
}

/**
 * The Checkout Session for an order (PLAN §1.5 step 5), built only from the stored quote. One
 * destination country (D11), its shipping choices, tax-exclusive prices, and no journal content:
 * Stripe sees the product, page count and order ID, never the title.
 */
export function checkoutParams(order: Order, quote: StoredQuote, opts: { base: string; taxEnabled: boolean; now: Date }): CheckoutParams {
  const back = `${opts.base}#/order/${encodeURIComponent(order.id)}`;
  const taxId = TAX_ID_COUNTRIES[quote.country];
  return {
    mode: 'payment',
    client_reference_id: order.id,
    metadata: { order_id: order.id, quote_version: String(quote.version) },
    payment_intent_data: { metadata: { order_id: order.id } },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: quote.bookCents,
          tax_behavior: 'exclusive',
          product_data: { name: 'Printed book', description: `${productLabel(order.product)}, ${order.pages} pages`, tax_code: TAX_CODE_BOOK },
        },
      },
    ],
    shipping_address_collection: { allowed_countries: [quote.country as never] },
    shipping_options: quote.shipping.map((s) => ({
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: s.name.slice(0, 100),
        fixed_amount: { amount: s.priceCents, currency: 'usd' },
        tax_behavior: 'exclusive',
        tax_code: TAX_CODE_SHIPPING,
        metadata: { level: s.level },
        ...(s.daysMin && s.daysMax && s.daysMin <= s.daysMax
          ? { delivery_estimate: { minimum: { unit: 'business_day', value: s.daysMin }, maximum: { unit: 'business_day', value: s.daysMax } } }
          : {}),
      },
    })),
    phone_number_collection: { enabled: true },
    automatic_tax: { enabled: opts.taxEnabled },
    ...(taxId ? { custom_fields: [{ key: TAX_ID_FIELD, type: 'text', label: { type: 'custom', custom: `Recipient tax ID (${taxId})` } }] } : {}),
    submit_type: 'pay',
    expires_at: Math.floor(opts.now.getTime() / 1000) + CHECKOUT_TTL_MIN * 60,
    success_url: back,
    cancel_url: `${back}?cancelled=1`,
  };
}

const rateId = (r: string | { id: string } | null | undefined) => (typeof r === 'string' ? r : (r?.id ?? null));

/** What a paid session tells us: amounts, the chosen shipping level, and where the book goes. */
export function paymentFromSession(session: CheckoutSession, quote: StoredQuote | null, paidAt: Date): Payment {
  // Stripe moved shipping details under `collected_information` (API 2025-03-31); older payloads have them at the top.
  const legacy = (session as unknown as { shipping_details?: { name?: string | null; address?: Record<string, string | null> | null } | null }).shipping_details;
  const details = session.collected_information?.shipping_details ?? legacy ?? null;
  const address = details?.address ?? null;
  const chosen = rateId(session.shipping_cost?.shipping_rate);
  const index = session.shipping_options.findIndex((o) => rateId(o.shipping_rate) === chosen);
  const byIndex = index >= 0 ? quote?.shipping[index] : undefined;
  const byAmount = quote?.shipping.find((s) => s.priceCents === session.shipping_cost?.amount_subtotal);
  const taxId = session.custom_fields.find((f) => f.key === TAX_ID_FIELD)?.text?.value ?? null;
  return {
    sessionId: session.id,
    paymentIntent: rateId(session.payment_intent),
    amountTotal: session.amount_total ?? 0,
    amountShipping: session.total_details?.amount_shipping ?? 0,
    amountTax: session.total_details?.amount_tax ?? 0,
    currency: session.currency ?? 'usd',
    shippingLevel: (byIndex ?? byAmount)?.level ?? null,
    email: session.customer_details?.email ?? null,
    phone: session.customer_details?.phone ?? null,
    name: details?.name ?? session.customer_details?.name ?? null,
    address: address
      ? { line1: address['line1'] ?? null, line2: address['line2'] ?? null, city: address['city'] ?? null, state: address['state'] ?? null, postalCode: address['postal_code'] ?? null, country: address['country'] ?? null }
      : null,
    recipientTaxId: taxId,
    paidAt: paidAt.toISOString(),
  };
}

/**
 * Prices an order for a destination, opens Stripe Checkout from that stored quote, and moves the
 * order as Stripe reports back (PLAN §1.5 steps 4–6). Stripe's webhooks are the source of truth for
 * "paid"; the return page also asks Stripe directly, through the same code, in case a webhook is late.
 */
export class CheckoutService {
  private readonly now: () => Date;
  private locks = new Map<string, Promise<unknown>>();
  private lastSync = new Map<string, number>();

  constructor(private readonly deps: CheckoutDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return Boolean(this.deps.stripe);
  }

  /** Throws `StripeSignatureError` unless the request really came from Stripe. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): StripeEvent {
    if (!this.deps.stripe) throw new StripeSignatureError('Payments are not configured.');
    return this.deps.stripe.verifyWebhook(rawBody, signature);
  }

  /** One request at a time per order: re-quotes and checkouts both wait on Lulu or Stripe in the middle. */
  private locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(id, tail);
    void tail.then(() => this.locks.get(id) === tail && this.locks.delete(id));
    return run;
  }

  /** Prices the book and its shipping to `country`, replacing any earlier quote. An open Checkout is closed first. */
  requote(order: Order, dest: { country: string; state?: string }): Promise<Order> {
    return this.locked(order.id, async () => {
      if (!isShipCountry(dest.country)) throw new OrderError('Choose a country from the list.', 400);
      let o = this.deps.db.get(order.id)!;
      if (o.state === 'awaiting_payment') o = await this.closeCheckout(o, 'customer:requote');
      if (o.state !== 'quoted') throw new OrderError(this.notPayable(o), 409);
      return this.priceFor(o, dest, 'customer:quote');
    });
  }

  private async priceFor(o: Order, dest: { country: string; state?: string }, cause: string): Promise<Order> {
    const quoter = this.deps.quoter;
    if (!quoter || o.pages === null) throw new OrderError('Prices are not available on this server.', 503);
    let q;
    try {
      q = await quoter.quote(o.podPackageId, o.pages, dest);
    } catch (err) {
      if (err instanceof LuluError && err.status === 400) throw new OrderError('The printer has no shipping to that country.', 422);
      if (err instanceof LuluError) throw new OrderError('The printer did not answer. Please try again in a moment.', 502);
      throw err;
    }
    if (!q.shipping?.length) throw new OrderError('The printer has no shipping to that country.', 422);
    const quote: StoredQuote = {
      version: (o.quote?.version ?? 0) + 1,
      at: this.now().toISOString(),
      country: dest.country,
      ...(dest.state ? { state: dest.state } : {}),
      bookCents: q.bookCents,
      costCents: q.costCents,
      shipping: q.shipping,
    };
    this.deps.db.transaction(() => {
      this.deps.db.update(o.id, { quote, bookCents: q.bookCents }, this.now());
      this.deps.db.move(o.id, 'quoted', cause, { detail: dest.country, now: this.now() });
    });
    this.deps.log.info({ orderId: o.id, country: dest.country, version: quote.version, bookCents: quote.bookCents }, 'order re-quoted');
    return this.deps.db.get(o.id)!;
  }

  /**
   * Stripe's page for the quote the customer saw (`quoteVersion`). The same open session is handed
   * out again; a new one gets a new idempotency key, `checkout:<order>:<quote version>:<attempt>`,
   * with the attempt counted before Stripe is asked (D55).
   */
  checkout(order: Order, input: { quoteVersion: number; returnUrl: string; checked: boolean }): Promise<{ url: string }> {
    return this.locked(order.id, async () => {
      const stripe = this.deps.stripe;
      if (!stripe) throw new OrderError('Payments are not available on this server yet.', 503);
      if (!input.checked) throw new OrderError('Please confirm that you have checked your book.', 400);
      const base = returnBase(input.returnUrl, this.deps);
      if (!base) throw new OrderError('This website is not allowed to take payments.', 400);

      let o = this.deps.db.get(order.id)!;
      const now = this.now();
      if (o.state === 'awaiting_payment' && o.checkout) {
        // A page showing an older quote is refused before anything happens to the open payment page.
        if (input.quoteVersion !== o.checkout.quoteVersion) throw new PriceChangedError();
        const fresh = Date.parse(o.checkout.expiresAt) - now.getTime() > REUSE_MARGIN_MS;
        if (fresh) return { url: o.checkout.url };
        o = await this.closeCheckout(o, 'customer:checkout');
      }
      if (o.state !== 'quoted') throw new OrderError(this.notPayable(o), 409);
      if (!o.quote) throw new OrderError('Choose where to send the book first.', 409);
      if (o.quote.version !== input.quoteVersion) throw new PriceChangedError();
      if (this.deps.store && !(await printFilesExist(this.deps.store, o.id))) {
        throw new OrderError("The print files have been deleted (they're kept for 7 days). Prepare the book again to order it.", 410);
      }
      if (now.getTime() - Date.parse(o.quote.at) > QUOTE_MAX_AGE_MS) {
        await this.priceFor(o, { country: o.quote.country, state: o.quote.state }, 'job:requote');
        throw new PriceChangedError('The price was more than a day old, so it has been checked again. Please look it over before paying.');
      }

      const attempt = this.deps.db.nextCheckoutAttempt(o.id);
      const key = `checkout:${o.id}:${o.quote.version}:${attempt}`;
      let session: CheckoutSession;
      try {
        session = await stripe.createCheckout(checkoutParams(o, o.quote, { base, taxEnabled: this.deps.taxEnabled, now }), key);
      } catch (err) {
        const detail = err instanceof StripeApiError ? { status: err.status, code: err.code, message: err.message.slice(0, 300) } : { message: String(err).slice(0, 300) };
        this.deps.log.error({ orderId: o.id, ...detail }, 'Stripe Checkout creation failed');
        throw new OrderError("The payment page couldn't be opened. Please try again in a moment.", 502);
      }
      if (!session.url) throw new OrderError("The payment page couldn't be opened. Please try again in a moment.", 502);
      const ref: CheckoutRef = { sessionId: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000).toISOString(), quoteVersion: o.quote.version, attempt };
      this.deps.db.transaction(() => {
        this.deps.db.update(o.id, { checkout: ref }, now);
        this.deps.db.move(o.id, 'awaiting_payment', 'customer:checkout', { detail: session.id, now });
      });
      this.deps.log.info({ orderId: o.id, session: session.id, attempt, quoteVersion: o.quote.version }, 'checkout opened');
      return { url: session.url };
    });
  }

  /** Expires the order's open session so the old price can't be paid, then follows what Stripe says. */
  private async closeCheckout(o: Order, cause: string): Promise<Order> {
    const stripe = this.deps.stripe;
    if (!stripe || !o.checkout) return o;
    let session: CheckoutSession;
    try {
      session = await stripe.expireCheckout(o.checkout.sessionId);
    } catch {
      // Already complete or expired: Stripe refuses to expire it. Read it instead.
      try {
        session = await stripe.getCheckout(o.checkout.sessionId);
      } catch (err) {
        this.deps.log.warn({ orderId: o.id, err: String(err).slice(0, 200) }, 'Stripe did not answer about an open checkout');
        throw new OrderError('The payment service did not answer. Please try again in a moment.', 502);
      }
    }
    this.reconcile(session, cause);
    const after = this.deps.db.get(o.id)!;
    if (after.state === 'awaiting_payment') throw new OrderError('A payment for this book is still being processed, so it can’t be changed now.', 409);
    return after;
  }

  private notPayable(o: Order): string {
    if (o.payment || ['paid', 'files_generated', 'files_validated', 'submitted_to_lulu', 'in_production', 'shipped', 'delivered'].includes(o.state)) return 'This book has already been paid for.';
    if (o.state === 'draft') return 'The print files are not ready yet.';
    return 'This order can no longer be paid for. Please prepare the book again.';
  }

  /**
   * While an order waits for payment, reading it asks Stripe about its session (at most every 10 s),
   * so the return page doesn't depend on a webhook arriving first. Errors are logged, not shown.
   */
  async refresh(order: Order): Promise<Order> {
    const stripe = this.deps.stripe;
    if (!stripe || order.state !== 'awaiting_payment' || !order.checkout) return order;
    const at = this.now().getTime();
    if (at - (this.lastSync.get(order.id) ?? 0) < SYNC_EVERY_MS) return order;
    this.lastSync.set(order.id, at);
    if (this.lastSync.size > 10_000) this.lastSync.clear();
    try {
      const sessionId = order.checkout.sessionId;
      const session = await stripe.getCheckout(sessionId);
      await this.locked(order.id, async () => this.reconcile(session, 'stripe:sync'));
    } catch (err) {
      this.deps.log.warn({ orderId: order.id, err: String(err).slice(0, 200) }, 'Stripe sync failed');
    }
    return this.deps.db.get(order.id)!;
  }

  /**
   * A verified webhook event (PLAN §1.5 step 6). Each event ID is handled once, in the same database
   * transaction as the order change it causes; a replay changes nothing. Returns the outcome, or
   * `duplicate`.
   */
  handleEvent(event: StripeEvent): string {
    const handled = (STRIPE_EVENTS as readonly string[]).includes(event.type);
    const session = handled ? (event.data.object as CheckoutSession) : null;
    const orderId = session ? (session.metadata?.['order_id'] ?? session.client_reference_id ?? null) : null;
    const outcome = this.deps.db.onceForStripeEvent(
      { id: event.id, type: event.type, orderId },
      () => {
        if (!session) return 'ignored';
        if (event.type === 'checkout.session.async_payment_failed') return this.paymentFailed(session, `stripe:${event.id}`);
        return this.reconcile(session, `stripe:${event.id}`);
      },
      this.now(),
    );
    this.deps.log.info({ event: event.id, type: event.type, orderId, outcome: outcome ?? 'duplicate' }, 'stripe event');
    return outcome ?? 'duplicate';
  }

  /** Brings an order in line with one of its Checkout Sessions, whoever reported it. Synchronous, so it fits in one transaction. */
  private reconcile(session: CheckoutSession, cause: string): string {
    const id = session.metadata?.['order_id'] ?? session.client_reference_id;
    const o = id ? this.deps.db.get(id) : undefined;
    if (!o) return 'unknown order';
    const current = o.checkout?.sessionId === session.id;
    const now = this.now();

    if (session.status === 'complete' && (session.payment_status === 'paid' || session.payment_status === 'no_payment_required')) {
      if (o.payment?.sessionId === session.id) return 'already paid';
      if (o.state === 'awaiting_payment' && current) {
        const payment = paymentFromSession(session, o.quote, now);
        this.deps.db.transaction(() => {
          this.deps.db.update(o.id, { payment }, now);
          this.deps.db.move(o.id, 'paid', cause, { detail: session.id, now });
        });
        this.deps.log.info({ orderId: o.id, session: session.id, amountTotal: payment.amountTotal, shippingLevel: payment.shippingLevel }, 'order paid');
        return 'paid';
      }
      // Money taken for a session the order no longer expects. A human must refund it (admin, M6).
      this.deps.log.error({ orderId: o.id, session: session.id, state: o.state }, 'payment for a session the order does not expect');
      return 'unexpected payment';
    }
    if (session.status === 'complete') return 'payment pending';
    if (session.status === 'expired') {
      if (o.state !== 'awaiting_payment' || !current) return 'stale session';
      this.deps.db.move(o.id, 'quoted', cause, { detail: 'checkout expired', now });
      return 'expired';
    }
    return 'open';
  }

  /** A delayed payment method (e.g. a bank debit) failed: the customer can try again from the proof. */
  private paymentFailed(session: CheckoutSession, cause: string): string {
    const id = session.metadata?.['order_id'] ?? session.client_reference_id;
    const o = id ? this.deps.db.get(id) : undefined;
    if (!o) return 'unknown order';
    if (o.state !== 'awaiting_payment' || o.checkout?.sessionId !== session.id) return 'stale session';
    this.deps.db.move(o.id, 'quoted', cause, { detail: 'async payment failed', now: this.now() });
    return 'payment failed';
  }
}
