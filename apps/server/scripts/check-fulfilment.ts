/**
 * Fulfilment end to end in the Lulu sandbox and Stripe test mode (M4, "Done when"):
 *
 *   npm run lulu:e2e -w @logbook/server                              # the 40-page and 200-page samples
 *   npm run lulu:e2e -w @logbook/server -- --sample 40-page          # one of them
 *   npm run lulu:e2e -w @logbook/server -- --fault lulu-reject       # Lulu rejects the job: refunded
 *   npm run lulu:e2e -w @logbook/server -- --fault files-missing     # the files are gone: refunded
 *   npm run lulu:e2e -w @logbook/server -- --follow 90               # follow Lulu's jobs for 90 minutes
 *   npm run lulu:e2e -w @logbook/server -- --cancel                  # cancel the sandbox jobs afterwards
 *
 * For each sample (6 × 9 in premium colour paperback, matte): the book is rendered as the server
 * renders customers' books, its print files go to the bucket with their hashes, as "Prepare my book"
 * leaves them, and it's quoted to Australia from Lulu's live costs. Checkout opens; headless Chromium
 * pays with 4242 4242 4242 4242 on Stripe's hosted page; Stripe's real `checkout.session.completed`
 * event (from the Events API, signed here: there's no public webhook URL) goes through the webhook
 * handler, which marks the order paid and queues fulfilment. Then the real job runner confirms the
 * files, has the Lulu sandbox validate them, creates the print job, and follows it, asking Lulu every
 * 20 seconds (in production webhooks and the 6-hourly poll do this).
 *
 * Without a fault, each order must reach `submitted_to_lulu` with a Lulu job that holds exactly our
 * files (Lulu's MD5s equal ours). With `--fault`, it must end `refunded`, with Stripe's refund.
 *
 * Needs STRIPE_TEST_SECRET_KEY (sk_test_), LULU_SANDBOX_CLIENT_KEY/SECRET and a bucket Lulu can reach
 * (S3_* or R2_*). Results go to samples/out/lulu-e2e/.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import Stripe from 'stripe';
import { loadConfig } from '../src/config.ts';
import { noMailer } from '../src/email/mailer.ts';
import type { Fault } from '../src/fulfilment/faults.ts';
import { Fulfilment } from '../src/fulfilment/service.ts';
import { JobRunner } from '../src/jobs/runner.ts';
import { LuluClient } from '../src/lulu/client.ts';
import { CheckoutService } from '../src/orders/checkout.ts';
import { OrderDb, type Order } from '../src/orders/db.ts';
import { hashPrintFile, printKey } from '../src/orders/service.ts';
import { StripeGateway } from '../src/payments/stripe.ts';
import { Quoter } from '../src/pricing/quote.ts';
import { closeBrowser } from '../src/render/browser.ts';
import { buildSampleBook, SAMPLE_PRODUCTS } from '../src/samples/build.ts';
import { S3Store } from '../src/storage/s3.ts';
import { payOnStripe } from './stripe-page.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SAMPLES = ['40-page', '200-page'] as const;
type Sample = (typeof SAMPLES)[number];
const only = arg('sample') as Sample | undefined;
if (only && !SAMPLES.includes(only)) throw new Error(`--sample must be one of ${SAMPLES.join(', ')}`);
const fault = arg('fault') as Fault | undefined;
if (fault && fault !== 'lulu-reject' && fault !== 'files-missing') throw new Error('--fault must be lulu-reject or files-missing (lulu-down takes two hours of retries; the unit tests cover it).');
const followMinutes = Number(arg('follow') ?? 3);
const cancelAfter = process.argv.includes('--cancel');
const PRODUCT_ID = '6x9-pb-matte';
const COUNTRY = 'AU';

const config = loadConfig();
if (config.mode !== 'test' || !config.stripe?.secretKey.startsWith('sk_test_')) throw new Error('Set STRIPE_TEST_SECRET_KEY (a sk_test_ key).');
if (!config.lulu) throw new Error('Set LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET.');
if (config.storage?.kind !== 's3') throw new Error('Set a bucket (S3_* or R2_*): the Lulu sandbox has to download the print files.');

const out = fileURLToPath(new URL('../../../samples/out/lulu-e2e/', import.meta.url));
await mkdir(out, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const LOCAL_SECRET = 'whsec_local_lulu_e2e';
const SITE = 'http://localhost:4173/';
const secretKey = config.stripe.secretKey;

const log = {
  info: (o: object, m: string) => console.error(`${stamp()} ${m} ${JSON.stringify(o)}`),
  warn: (o: object, m: string) => console.error(`${stamp()} ! ${m} ${JSON.stringify(o)}`),
  error: (o: object, m: string) => console.error(`${stamp()} ✗ ${m} ${JSON.stringify(o)}`),
};
const db = new OrderDb(join(await mkdtemp(join(tmpdir(), 'logbook-lulu-e2e-')), 'orders.sqlite'));
const store = new S3Store(config.storage);
const lulu = new LuluClient(config.lulu);
const stripe = new StripeGateway(secretKey, LOCAL_SECRET);
const api = new Stripe(secretKey);
const checkout = new CheckoutService({ db, store, quoter: new Quoter(lulu), stripe, taxEnabled: config.stripe.taxEnabled, webOrigins: [], allowLoopbackReturn: true, log });
const fulfilment = new Fulfilment({
  db,
  store,
  lulu,
  stripe,
  mailer: noMailer,
  contactEmail: config.fulfilment.contactEmail,
  ownerEmail: config.fulfilment.ownerEmail,
  faults: new Set(fault ? [fault] : []),
  log,
});
const runner = new JobRunner({ db, handle: fulfilment.handle, onDead: fulfilment.onDead, log });

/** A rendered sample in the bucket, quoted, as "Prepare my book" leaves an order. */
async function prepared(sample: Sample): Promise<Order> {
  const build = await buildSampleBook(sample, PRODUCT_ID, join(out, sample), { coverDims: (pod, pages) => lulu.coverDimensions(pod, pages) });
  const [interior, cover] = await Promise.all([readFile(build.files.interior), readFile(build.files.cover)]);
  const id = `ord_e2e_${sample.replace('-page', 'p')}_${randomBytes(4).toString('hex')}`;
  db.create({ id, tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'), podPackageId: build.podPackageId, product: SAMPLE_PRODUCTS[PRODUCT_ID], uploads: [] });
  await store.put(printKey(id, 'interior'), interior, 'application/pdf');
  await store.put(printKey(id, 'cover'), cover, 'application/pdf');
  const printFiles = { interior: hashPrintFile(interior), cover: hashPrintFile(cover), at: new Date().toISOString() };
  db.update(id, { pages: build.interior.plan.pages, coverApproximate: build.coverApproximate, printFiles, stage: null });
  db.move(id, 'quoted', 'job:prepare');
  log.info({ orderId: id, pages: build.interior.plan.pages, interiorBytes: interior.byteLength, coverApproximate: build.coverApproximate }, 'prepared');
  return db.get(id)!;
}

/** Stripe's real event for a session, signed here and handed to the webhook handler. */
async function deliver(sessionId: string, type: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const list = await api.events.list({ type, limit: 20 });
    const event = list.data.find((e) => (e.data.object as { id?: string }).id === sessionId);
    if (event) {
      const payload = JSON.stringify(event);
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: LOCAL_SECRET });
      return checkout.handleEvent(stripe.verifyWebhook(Buffer.from(payload), header));
    }
    await sleep(2000);
  }
  throw new Error(`No ${type} event for ${sessionId}`);
}

const BEFORE_LULU = new Set(['paid', 'files_generated', 'files_validated']);
const SETTLED = new Set(['refunded', 'delivered', 'failed']);

async function run(sample: Sample, browser: Browser) {
  const started = Date.now();
  const order = await prepared(sample);
  const id = order.id;
  const quoted = await checkout.requote(order, { country: COUNTRY });
  const { url } = await checkout.checkout(quoted, { quoteVersion: quoted.quote!.version, returnUrl: SITE, checked: true });
  const sessionId = db.get(id)!.checkout!.sessionId;

  const page = await browser.newPage();
  await page.route('http://localhost:4173/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>Back on Logbook</p>' }));
  await page.goto(url);
  try {
    await payOnStripe(page, 'success');
    await page.waitForURL(/localhost:4173/, { timeout: 60_000 });
  } catch (err) {
    await page.screenshot({ path: join(out, `${sample}-payment-failed.png`), fullPage: true });
    throw err;
  }
  await page.close();
  const paid = await deliver(sessionId, 'checkout.session.completed');
  log.info({ orderId: id, outcome: paid }, 'Stripe event handled');

  // The fulfilment jobs, as the server's runner would run them.
  const timeline: { at: string; state: string; lulu?: string }[] = [];
  const note = () => {
    const o = db.get(id)!;
    const last = timeline.at(-1);
    const lulu = o.luluJob ? `${o.luluJob.status}/${o.luluJob.lineItemStatus}` : undefined;
    if (!last || last.state !== o.state || last.lulu !== lulu) timeline.push({ at: new Date().toISOString(), state: o.state, ...(lulu ? { lulu } : {}) });
    return o;
  };
  note();
  const deadline = Date.now() + 20 * 60_000;
  while (BEFORE_LULU.has(note().state) && Date.now() < deadline) {
    await runner.runDue();
    if (BEFORE_LULU.has(note().state)) await sleep(5000);
  }

  // Follow the Lulu job: what webhooks and polls do in production, every 20 s here.
  const followUntil = Date.now() + followMinutes * 60_000;
  while (Date.now() < followUntil && !SETTLED.has(note().state)) {
    const o = db.get(id)!;
    if (o.luluJob && ['submitted_to_lulu', 'in_production', 'shipped'].includes(o.state)) db.enqueueJob(id, 'track', { mode: 'restart' });
    await runner.runDue();
    note();
    if (!SETTLED.has(db.get(id)!.state)) await sleep(20_000);
  }
  // A refund queued by the last look runs now.
  await runner.runDue();
  const final = note();

  const result: Record<string, unknown> = {
    sample,
    order: id,
    pages: final.pages,
    fault: fault ?? null,
    seconds: Math.round((Date.now() - started) / 1000),
    paid: final.payment && { amountTotal: final.payment.amountTotal, shippingLevel: final.payment.shippingLevel, country: final.payment.address?.country },
    state: final.state,
    error: final.error,
    events: db.events(id).map((e) => `${e.from}→${e.to} (${e.cause.replace(/evt_\w+/, 'evt_…')}${e.detail ? `: ${e.detail}` : ''})`),
    timeline,
    luluJob: final.luluJob && { id: final.luluJob.id, status: final.luluJob.status, lineItem: final.luluJob.lineItemStatus, message: final.luluJob.message },
    refund: final.refund,
    jobs: db.jobs(id).map((j) => `${j.kind}${j.key ? `:${j.key}` : ''} ${j.state}${j.attempts ? ` (${j.attempts} failed)` : ''}`),
  };
  const problems: string[] = [];
  const expect = (ok: boolean, what: string) => ok || problems.push(`expected: ${what}`);
  if (!fault) {
    expect(['submitted_to_lulu', 'in_production', 'shipped', 'delivered'].includes(final.state), 'the order reached Lulu');
    expect(['paid', 'files_generated', 'files_validated', 'submitted_to_lulu'].every((s) => db.events(id).some((e) => e.to === s)), 'it went through every fulfilment state');
    if (final.luluJob) {
      const job = await lulu.getPrintJob(final.luluJob.id);
      const pn = job.line_items[0]?.printable_normalization;
      result.luluFiles = { interior: pn?.interior?.source_md5sum, cover: pn?.cover?.source_md5sum, pages: pn?.interior?.page_count };
      expect(!['REJECTED', 'CANCELED', 'ERROR'].includes(job.status.name), 'Lulu accepted the job');
      expect(pn?.interior?.source_md5sum === final.printFiles!.interior.md5 && pn?.cover?.source_md5sum === final.printFiles!.cover.md5, 'Lulu holds exactly the approved files (MD5)');
      expect(pn?.interior?.page_count === final.pages, "Lulu's page count is ours");
    }
  } else {
    expect(final.state === 'refunded', 'the order was refunded');
    const intent = final.payment?.paymentIntent;
    if (intent) {
      const refunds = await api.refunds.list({ payment_intent: intent });
      result.stripeRefunds = refunds.data.map((r) => ({ id: r.id, amount: r.amount, status: r.status }));
      expect(refunds.data.some((r) => r.amount === final.payment!.amountTotal && (r.status === 'succeeded' || r.status === 'pending')), 'Stripe refunded the full amount');
    }
    if (fault === 'lulu-reject') expect(final.luluJob?.status === 'REJECTED', 'Lulu rejected the job');
    if (fault === 'files-missing') expect(!final.luluJob, 'nothing was sent to Lulu');
  }
  result.problems = problems;
  return result;
}

const browser = await chromium.launch({ executablePath: config.chromiumPath });
const results: Record<string, unknown>[] = [];
try {
  for (const sample of only ? [only] : SAMPLES) {
    try {
      results.push(await run(sample, browser));
    } catch (err) {
      results.push({ sample, error: String(err).slice(0, 500), problems: ['the run failed'] });
    }
    console.log(JSON.stringify(results.at(-1), null, 2));
  }
} finally {
  await browser.close();
  await closeBrowser();
  for (const r of results) {
    const o = typeof r['order'] === 'string' ? db.get(r['order']) : undefined;
    if (cancelAfter && o?.luluJob && !['REJECTED', 'CANCELED'].includes(o.luluJob.status)) await lulu.cancelPrintJob(o.luluJob.id).catch((e: unknown) => log.warn({ err: String(e) }, 'cancel failed'));
    // The bucket's lifecycle rule would delete these in 7 days; no need to wait.
    if (o) await store.deletePrefix(`orders/${o.id}/`).catch(() => undefined);
  }
  db.close();
}
await writeFile(join(out, `results${fault ? `-${fault}` : ''}.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => (r['problems'] as string[]).length);
console.log(failed.length ? `✗ Not as expected: ${failed.map((r) => r['sample']).join(', ')}` : `✓ Every sample ended as expected${fault ? ` (fault: ${fault})` : ''}`);
process.exitCode = failed.length ? 1 : 0;
