/**
 * Runs Checkout end to end in Stripe test mode (M3 slice E, "Done when"):
 *
 *   npm run stripe:check -w @logbook/server                    # all three cards
 *   npm run stripe:check -w @logbook/server -- --card success  # or decline, 3ds
 *   npm run stripe:check -w @logbook/server -- --open          # just print a Checkout URL to pay by hand
 *
 * For each card: an order for a 200-page 6 × 9 in premium colour paperback is quoted to Australia
 * from the Lulu sandbox's live costs, Checkout is opened through `CheckoutService`, and a headless
 * Chromium pays on Stripe's hosted page. Then the order is moved the way production moves it:
 * Stripe's real `checkout.session.*` event is fetched from the Events API, signed here with a local
 * secret (there's no public webhook URL in this environment) and handed to the webhook handler.
 * Declined: the order must stay `awaiting_payment` with the page still open; expiring the page must
 * return it to `quoted`. Nothing touches a real bucket: the order lives in a temporary database.
 *
 * Needs STRIPE_TEST_SECRET_KEY (sk_test_ only) and the LULU_SANDBOX_* variables. Screenshots go to
 * samples/out/stripe-check/.
 */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Frame, type Page } from 'playwright';
import Stripe from 'stripe';
import { podPackageId, type Product } from '@logbook/core';
import { loadConfig } from '../src/config.ts';
import { LuluClient } from '../src/lulu/client.ts';
import { CheckoutService } from '../src/orders/checkout.ts';
import { OrderDb } from '../src/orders/db.ts';
import { StripeGateway, type CheckoutSession } from '../src/payments/stripe.ts';
import { Quoter } from '../src/pricing/quote.ts';

const CARDS = {
  success: '4242 4242 4242 4242',
  decline: '4000 0000 0000 0002',
  '3ds': '4000 0027 6000 3184',
} as const;
type Card = keyof typeof CARDS;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = arg('card') as Card | undefined;
const openOnly = process.argv.includes('--open');
const country = arg('country') ?? 'AU';

const config = loadConfig();
if (config.mode !== 'test' || !config.stripe?.secretKey.startsWith('sk_test_')) throw new Error('Set STRIPE_TEST_SECRET_KEY (a sk_test_ key).');
if (!config.lulu) throw new Error('Set LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET.');
const LOCAL_SECRET = 'whsec_local_stripe_check';
const stripe = new StripeGateway(config.stripe.secretKey, LOCAL_SECRET);
const api = new Stripe(config.stripe.secretKey);
const quoter = new Quoter(new LuluClient(config.lulu));
const out = fileURLToPath(new URL('../../../samples/out/stripe-check/', import.meta.url));
await mkdir(out, { recursive: true });
const log = { info: () => {}, warn: (o: object, m: string) => console.warn(m, o), error: (o: object, m: string) => console.error(m, o) };
const PRODUCT: Product = { trim: '6x9', interior: 'color', binding: 'paperback', finish: 'matte' };
const SITE = 'http://localhost:4173/';

/** A prepared order (print files made and checked), as "Prepare my book" leaves it. */
async function newOrder(db: OrderDb, id: string) {
  db.create({ id, tokenHash: 'n/a', podPackageId: podPackageId(PRODUCT), product: PRODUCT, uploads: [] });
  db.update(id, { pages: 200, stage: null });
  db.move(id, 'quoted', 'job:prepare');
}

/** Stripe's real event for this session, signed as Stripe would sign it, through the webhook handler. */
async function deliver(service: CheckoutService, session: string, type: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = await api.events.list({ type, limit: 20 });
    const event = list.data.find((e) => (e.data.object as { id?: string }).id === session);
    if (event) {
      const payload = JSON.stringify(event);
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: LOCAL_SECRET });
      return service.handleEvent(stripe.verifyWebhook(Buffer.from(payload), header));
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return `no ${type} event found`;
}

async function fill(page: Page, selector: string, value: string) {
  const el = page.locator(selector).first();
  if (await el.count()) await el.fill(value);
}

/** Fills Stripe's hosted page. Field IDs as found on checkout.stripe.com, 2026-10-08. */
async function payOnStripe(page: Page, card: Card) {
  await page.locator('#email').fill('stripe-check@example.com');
  // With more than one payment method enabled, the card form sits behind an accordion item.
  const cardChoice = page.locator('[data-testid="card-accordion-item-button"]');
  if (await cardChoice.count()) await cardChoice.click();
  await page.locator('#cardNumber').fill(CARDS[card]);
  await page.locator('#cardExpiry').fill('12 / 34');
  await page.locator('#cardCvc').fill('123');
  await fill(page, '#billingName', 'Sam Reader');
  await fill(page, '#shippingName', 'Sam Reader');
  await fill(page, '#shippingAddressLine1', '1 King William St');
  await fill(page, '#shippingLocality', 'Adelaide');
  await fill(page, '#shippingPostalCode', '5000');
  const state = page.locator('select#shippingAdministrativeArea');
  if (await state.count()) await state.selectOption('SA');
  await fill(page, '#phoneNumber', '0400 000 000');
  // Link offers to save the details; a test run doesn't want that.
  const save = page.locator('#enableStripePass');
  if ((await save.count()) && (await save.isChecked())) await save.uncheck();
  await page.locator('button[type="submit"], .SubmitButton').first().click();
}

/** Stripe's 3-D Secure test page sits in nested iframes; its "Complete" button authenticates. */
async function completeThreeDs(page: Page) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames() as Frame[]) {
      const button = frame.locator('#test-source-authorize-3ds, button:has-text("Complete")');
      if (await button.count().catch(() => 0)) {
        await button.first().click();
        return;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('No 3-D Secure challenge appeared.');
}

async function run(card: Card, browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const db = new OrderDb(join(await mkdtemp(join(tmpdir(), 'logbook-stripe-')), 'orders.sqlite'));
  const service = new CheckoutService({ db, quoter, stripe, taxEnabled: config.stripe!.taxEnabled, webOrigins: [], allowLoopbackReturn: true, log });
  const id = `ord_check_${card}_${Date.now().toString(36)}`;
  await newOrder(db, id);
  const quoted = await service.requote(db.get(id)!, { country });
  const { url } = await service.checkout(quoted, { quoteVersion: quoted.quote!.version, returnUrl: SITE, checked: true });
  const sessionId = db.get(id)!.checkout!.sessionId;
  const result: Record<string, unknown> = { card, order: id, session: sessionId, quote: { book: quoted.quote!.bookCents, shipping: quoted.quote!.shipping.map((s) => `${s.level} ${s.priceCents}`) } };
  if (openOnly) {
    console.log(`Pay by hand: ${url}`);
    return result;
  }

  const page = await browser.newPage();
  // The website isn't running; answer the return URL so the redirect can be seen.
  await page.route('http://localhost:4173/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>Back on Logbook</p>' }));
  await page.goto(url);
  try {
    await payOnStripe(page, card);
    if (card === '3ds') await completeThreeDs(page);
  } catch (err) {
    await page.screenshot({ path: join(out, `${card}-failed.png`), fullPage: true });
    console.error('frames:', page.frames().map((f) => f.url().slice(0, 120)));
    throw err;
  }
  if (card === 'decline') {
    await page.getByText(/declined/i).first().waitFor({ timeout: 30_000 });
    result.page = (await page.getByText(/declined/i).first().textContent())?.trim();
  } else {
    await page.waitForURL(/localhost:4173/, { timeout: 60_000 });
    result.returnedTo = page.url();
  }
  await page.screenshot({ path: join(out, `${card}.png`), fullPage: true });
  await page.close();

  const session: CheckoutSession = await stripe.getCheckout(sessionId);
  result.stripe = { status: session.status, payment_status: session.payment_status, amount_total: session.amount_total };
  if (card === 'decline') {
    result.afterDecline = db.get(id)!.state;
    // The customer gives up: the page expires and the order goes back to its quote.
    await stripe.expireCheckout(sessionId);
    result.webhook = await deliver(service, sessionId, 'checkout.session.expired');
  } else {
    result.webhook = await deliver(service, sessionId, 'checkout.session.completed');
    result.replay = await deliver(service, sessionId, 'checkout.session.completed');
    const p = db.get(id)!.payment;
    result.payment = p && { amountTotal: p.amountTotal, amountShipping: p.amountShipping, amountTax: p.amountTax, shippingLevel: p.shippingLevel, country: p.address?.country, state: p.address?.state, hasPhone: Boolean(p.phone), hasEmail: Boolean(p.email) };
  }
  result.state = db.get(id)!.state;
  result.events = db.events(id).map((e) => `${e.from}→${e.to} (${e.cause.replace(/evt_\w+/, 'evt_…')})`);
  db.close();
  return result;
}

const browser = await chromium.launch({ executablePath: config.chromiumPath });
try {
  for (const card of only ? [only] : (Object.keys(CARDS) as Card[])) {
    try {
      console.log(JSON.stringify(await run(card, browser), null, 2));
    } catch (err) {
      console.log(JSON.stringify({ card, error: String(err).slice(0, 500) }, null, 2));
    }
  }
} finally {
  await browser.close();
}
