/**
 * Runs Checkout end to end in Stripe test mode (M3 slice E, "Done when"):
 *
 *   npm run stripe:check -w @logbook/server                    # all three cards
 *   npm run stripe:check -w @logbook/server -- --card success  # or decline, 3ds
 *   npm run stripe:check -w @logbook/server -- --listen        # real webhook deliveries (Stripe CLI)
 *   npm run stripe:check -w @logbook/server -- --open          # just print a Checkout URL to pay by hand
 *
 * For each card: an order for a 200-page 6 × 9 in premium colour paperback is quoted to Australia
 * from the Lulu sandbox's live costs, Checkout is opened, and a headless Chromium pays on Stripe's
 * hosted page. Then the order must move the way production moves it:
 *
 * - By default `CheckoutService` runs in this process, and Stripe's real `checkout.session.*` event
 *   is fetched from the Events API, signed here with a local secret and handed to the webhook handler.
 * - With `--listen`, the real API runs (`src/main.ts`, local storage, a temporary database) and the
 *   Stripe CLI's `stripe listen` delivers Stripe's webhooks to it. The script talks to the API over
 *   HTTP and never reads the order through it (that would ask Stripe directly, D57), so only a
 *   webhook can move the order; it watches the database instead. Set STRIPE_CLI to the `stripe`
 *   binary if it isn't on PATH.
 *
 * Declined: the order must stay `awaiting_payment` with the page still open; expiring the page must
 * return it to `quoted`. Nothing touches a real bucket.
 *
 * Needs STRIPE_TEST_SECRET_KEY (sk_test_ only) and the LULU_SANDBOX_* variables. Screenshots go to
 * samples/out/stripe-check/.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Frame, type Page } from 'playwright';
import Stripe from 'stripe';
import { podPackageId, type Product } from '@logbook/core';
import { loadConfig } from '../src/config.ts';
import { LuluClient } from '../src/lulu/client.ts';
import { CheckoutService } from '../src/orders/checkout.ts';
import { OrderDb, type Order } from '../src/orders/db.ts';
import type { OrderState } from '../src/orders/machine.ts';
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
const listen = process.argv.includes('--listen');
const country = arg('country') ?? 'AU';

const config = loadConfig();
if (config.mode !== 'test' || !config.stripe?.secretKey.startsWith('sk_test_')) throw new Error('Set STRIPE_TEST_SECRET_KEY (a sk_test_ key).');
if (!config.lulu) throw new Error('Set LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET.');
const secretKey = config.stripe.secretKey;
const LOCAL_SECRET = 'whsec_local_stripe_check';
const stripe = new StripeGateway(secretKey, LOCAL_SECRET);
const api = new Stripe(secretKey);
const out = fileURLToPath(new URL('../../../samples/out/stripe-check/', import.meta.url));
await mkdir(out, { recursive: true });
const log = { info: () => {}, warn: (o: object, m: string) => console.warn(m, o), error: (o: object, m: string) => console.error(m, o) };
const PRODUCT: Product = { trim: '6x9', interior: 'color', binding: 'paperback', finish: 'matte' };
const SITE = 'http://localhost:4173/';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A prepared order (print files made and checked), as "Prepare my book" leaves it. */
function newOrder(db: OrderDb, id: string, token: string) {
  db.create({ id, tokenHash: createHash('sha256').update(token).digest('hex'), podPackageId: podPackageId(PRODUCT), product: PRODUCT, uploads: [] });
  db.update(id, { pages: 200, stage: null });
  db.move(id, 'quoted', 'job:prepare');
}

/** How a run quotes, opens Checkout and gets Stripe's verdict to the order. */
interface Driver {
  db: OrderDb;
  quote(id: string, token: string): Promise<Order>;
  checkout(id: string, token: string, quoteVersion: number): Promise<string>;
  /** Waits until the order reaches `state` through Stripe's `type` event; returns how it got there. */
  settle(id: string, session: string, type: string, state: OrderState): Promise<string>;
  close(): Promise<void>;
}

/** In this process: Stripe's real event from the Events API, signed here, through the webhook handler. */
async function localDriver(): Promise<Driver> {
  const db = new OrderDb(join(await mkdtemp(join(tmpdir(), 'logbook-stripe-')), 'orders.sqlite'));
  const service = new CheckoutService({ db, quoter: new Quoter(new LuluClient(config.lulu!)), stripe, taxEnabled: config.stripe!.taxEnabled, webOrigins: [], allowLoopbackReturn: true, log });
  return {
    db,
    quote: (id) => service.requote(db.get(id)!, { country }),
    checkout: async (id, _token, quoteVersion) => (await service.checkout(db.get(id)!, { quoteVersion, returnUrl: SITE, checked: true })).url,
    async settle(_id, session, type) {
      for (let i = 0; i < 20; i++) {
        const list = await api.events.list({ type, limit: 20 });
        const event = list.data.find((e) => (e.data.object as { id?: string }).id === session);
        if (event) {
          const payload = JSON.stringify(event);
          const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: LOCAL_SECRET });
          return `event ${service.handleEvent(stripe.verifyWebhook(Buffer.from(payload), header))}`;
        }
        await sleep(1500);
      }
      return `no ${type} event found`;
    },
    close: async () => db.close(),
  };
}

/** Starts a process and resolves once `ready` matches its output (stdout or stderr). */
function start(cmd: string, args: string[], env: NodeJS.ProcessEnv, ready: RegExp, label: string, children: ChildProcess[]): Promise<{ child: ChildProcess; match: RegExpMatchArray }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let seen = '';
    // stripe listen connects over a websocket to stripecli-ws-*.stripe.com; a blocked host shows up as no "Ready!".
    const timer = setTimeout(() => reject(new Error(`${label} did not get ready within a minute (is stripecli-ws-*.stripe.com reachable?)`)), 60_000);
    const on = (chunk: Buffer) => {
      seen += chunk.toString();
      const match = seen.match(ready);
      if (match) {
        clearTimeout(timer);
        resolve({ child, match });
      }
    };
    child.stdout!.on('data', on);
    child.stderr!.on('data', on);
    child.on('exit', (code) => reject(new Error(`${label} exited (${code}): ${seen.slice(-500)}`)));
  });
}

/** The real API with Stripe's webhooks delivered by `stripe listen`. */
async function listenDriver(): Promise<Driver> {
  const cli = process.env['STRIPE_CLI'] || 'stripe';
  const work = await mkdtemp(join(tmpdir(), 'logbook-stripe-listen-'));
  const port = 4299;
  // The key goes to the CLI through its environment, not its command line, where `ps` would show it.
  const cliEnv = { ...process.env, STRIPE_API_KEY: secretKey };
  const base = `http://127.0.0.1:${port}`;
  const secret = await new Promise<string>((resolve, reject) => {
    const p = spawn(cli, ['listen', '--print-secret'], { env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    p.stdout.on('data', (c: Buffer) => (text += c.toString()));
    p.on('exit', () => {
      const s = /whsec_[A-Za-z0-9]+/.exec(text)?.[0];
      if (s) resolve(s);
      else reject(new Error('stripe listen --print-secret gave no secret'));
    });
  });
  const env = {
    ...process.env,
    APP_MODE: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    LOCAL_STORAGE: 'on',
    LOCAL_STORAGE_DIR: join(work, 'storage'),
    DATABASE_PATH: join(work, 'orders.sqlite'),
    STRIPE_TEST_WEBHOOK_SECRET: secret,
    LOG_LEVEL: 'warn',
    ...Object.fromEntries(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].map((v) => [v, ''])),
  };
  const server = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', fileURLToPath(new URL('../src/main.ts', import.meta.url))], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr!.on('data', (c: Buffer) => process.stderr.write(`[api] ${c.toString()}`));
  // Whatever happens next, the API and stripe listen stop with this script.
  const children: ChildProcess[] = [server];
  process.once('exit', () => children.forEach((c) => c.kill()));
  for (let i = 0; ; i++) {
    const ok = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
    if (ok) break;
    if (i > 60) throw new Error('The API did not start.');
    await sleep(500);
  }
  const health = (await (await fetch(`${base}/api/health`)).json()) as { payments?: { webhooks?: boolean } };
  if (!health.payments?.webhooks) throw new Error('The API can’t verify webhooks.');
  const events = 'checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired';
  const forward = await start(cli, ['listen', '--events', events, '--forward-to', `${base}/api/stripe/webhook`], cliEnv, /Ready!/, 'stripe listen', children);
  const db = new OrderDb(env.DATABASE_PATH);
  const call = async <T>(path: string, token: string, body: unknown): Promise<T> => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(`${path}: ${res.status} ${json.error}`);
    return json;
  };
  return {
    db,
    async quote(id, token) {
      await call(`/api/orders/${id}/quote`, token, { country });
      return db.get(id)!;
    },
    checkout: async (id, token, quoteVersion) => (await call<{ url: string }>(`/api/orders/${id}/checkout`, token, { quoteVersion, returnUrl: SITE, checked: true })).url,
    async settle(id, session, type, state) {
      for (let i = 0; i < 60; i++) {
        const row = db.stripeEvents(id).find((e) => e.type === type);
        const o = db.get(id)!;
        if (row && o.state === state) return `webhook ${row.id.slice(0, 8)}… delivered by stripe listen → ${row.outcome}`;
        await sleep(1000);
      }
      return `no ${type} webhook for ${session} within a minute`;
    },
    async close() {
      db.close();
      forward.child.kill();
      server.kill();
    },
  };
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

/**
 * Stripe's 3-D Secure test page (testmode-acs.stripe.com) sits in nested iframes; its "Complete"
 * button authenticates. Clicked until the challenge goes away, since an early click can be lost.
 */
async function completeThreeDs(page: Page) {
  const deadline = Date.now() + 60_000;
  let clicked = 0;
  while (Date.now() < deadline) {
    const acs = (page.frames() as Frame[]).find((f) => f.url().includes('testmode-acs.stripe.com'));
    if (!acs) {
      if (clicked) return;
      await page.waitForTimeout(500);
      continue;
    }
    const button = acs.getByRole('button', { name: /complete/i });
    if (await button.isVisible().catch(() => false)) {
      await page.waitForTimeout(1000);
      await button.click().catch(() => undefined);
      clicked++;
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(500);
    }
  }
  throw new Error(clicked ? 'The 3-D Secure challenge stayed open after clicking Complete.' : 'No 3-D Secure challenge appeared.');
}

async function run(card: Card, driver: Driver, browser: Browser | null) {
  const { db } = driver;
  const id = `ord_check_${card}_${randomBytes(4).toString('hex')}`;
  const token = randomBytes(24).toString('base64url');
  newOrder(db, id, token);
  const quoted = await driver.quote(id, token);
  const url = await driver.checkout(id, token, quoted.quote!.version);
  const sessionId = db.get(id)!.checkout!.sessionId;
  const result: Record<string, unknown> = { card, order: id, session: sessionId, quote: { book: quoted.quote!.bookCents, shipping: quoted.quote!.shipping.map((s) => `${s.level} ${s.priceCents}`) } };
  if (!browser) {
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
    if (card === 'decline') {
      await page.getByText(/declined/i).first().waitFor({ timeout: 30_000 });
      result.page = (await page.getByText(/declined/i).first().textContent())?.trim();
    } else {
      await page.waitForURL(/localhost:4173/, { timeout: 60_000 });
      result.returnedTo = page.url();
    }
  } catch (err) {
    await page.screenshot({ path: join(out, `${card}-failed.png`), fullPage: true });
    console.error('frames:', page.frames().map((f) => f.url().slice(0, 120)));
    throw err;
  }
  await page.screenshot({ path: join(out, `${card}.png`), fullPage: true });
  await page.close();

  const session: CheckoutSession = await stripe.getCheckout(sessionId);
  result.stripe = { status: session.status, payment_status: session.payment_status, amount_total: session.amount_total };
  if (card === 'decline') {
    result.afterDecline = db.get(id)!.state;
    // The customer gives up: the page expires and the order goes back to its quote.
    await stripe.expireCheckout(sessionId);
    result.webhook = await driver.settle(id, sessionId, 'checkout.session.expired', 'quoted');
  } else {
    result.webhook = await driver.settle(id, sessionId, 'checkout.session.completed', 'paid');
    if (!listen) result.replay = await driver.settle(id, sessionId, 'checkout.session.completed', 'paid');
    const p = db.get(id)!.payment;
    result.payment = p && { amountTotal: p.amountTotal, amountShipping: p.amountShipping, amountTax: p.amountTax, shippingLevel: p.shippingLevel, country: p.address?.country, state: p.address?.state, hasPhone: Boolean(p.phone), hasEmail: Boolean(p.email) };
  }
  result.state = db.get(id)!.state;
  result.events = db.events(id).map((e) => `${e.from}→${e.to} (${e.cause.replace(/evt_\w+/, 'evt_…')})`);
  return result;
}

const driver = listen ? await listenDriver().catch((err: unknown) => {
  console.error(String(err));
  process.exit(1);
}) : await localDriver();
const browser = openOnly ? null : await chromium.launch({ executablePath: config.chromiumPath });
try {
  for (const card of only ? [only] : (Object.keys(CARDS) as Card[])) {
    try {
      console.log(JSON.stringify(await run(card, driver, browser), null, 2));
    } catch (err) {
      console.log(JSON.stringify({ card, error: String(err).slice(0, 500) }, null, 2));
    }
  }
} finally {
  await browser?.close();
  await driver.close();
}
