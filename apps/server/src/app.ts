import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import { noMailer, ResendMailer, type Mailer } from './email/mailer.ts';
import { registerLuluWebhook } from './fulfilment/routes.ts';
import { Fulfilment } from './fulfilment/service.ts';
import { JobRunner } from './jobs/runner.ts';
import { loggerOptions } from './log.ts';
import { LuluClient, LuluError } from './lulu/client.ts';
import { CheckoutService } from './orders/checkout.ts';
import { OrderDb } from './orders/db.ts';
import { registerOrderRoutes } from './orders/routes.ts';
import { OrderService } from './orders/service.ts';
import { StripeGateway } from './payments/stripe.ts';
import { checkBook, publicQuote, Quoter } from './pricing/quote.ts';
import { renderBook, type BookRender, type BookSource } from './render/book.ts';
import { LocalStore } from './storage/local.ts';
import { S3Store } from './storage/s3.ts';
import type { ObjectStore } from './storage/store.ts';

export interface AppOptions {
  logger?: boolean;
  lulu?: LuluClient;
  /** Overrides for tests. */
  store?: ObjectStore;
  db?: OrderDb;
  render?: (src: BookSource) => Promise<BookRender>;
  stripe?: StripeGateway;
  mailer?: Mailer;
  /** Run due jobs on a timer once ready (default). Tests turn it off and call `app.jobs.runDue()`. */
  startJobs?: boolean;
  now?: () => Date;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when orders are: runs fulfilment, tracking, refunds and emails (M4). */
    jobs?: JobRunner;
    fulfilment?: Fulfilment;
  }
}

function storeFor(config: Config): ObjectStore | undefined {
  const s = config.storage;
  if (!s) return undefined;
  if (s.kind === 's3') return new S3Store(s);
  mkdirSync(s.dir, { recursive: true });
  return new LocalStore(s.dir);
}

/**
 * The API: a health check, cover sizes (D39) and price estimates (D49), which are content-free; and,
 * when storage is configured, orders (M3): upload by signed URLs, print files, a quote per
 * destination, Stripe Checkout and Stripe's webhook. Journal content only ever reaches storage, never
 * the database or the logs (PLAN §6).
 */
export function buildApp(config: Config, opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger === false ? false : loggerOptions });
  const lulu = opts.lulu ?? (config.lulu ? new LuluClient(config.lulu) : undefined);
  const quoter = lulu && new Quoter(lulu);
  const store = opts.store ?? storeFor(config);
  const db = store ? (opts.db ?? new OrderDb(config.databasePath)) : undefined;
  const orders =
    store && db
      ? new OrderService({ db, store, lulu, quoter, render: opts.render ?? renderBook, workRoot: tmpdir(), log: app.log, now: opts.now })
      : undefined;
  const stripe = opts.stripe ?? (config.stripe ? new StripeGateway(config.stripe.secretKey, config.stripe.webhookSecret) : undefined);
  const f = config.fulfilment;
  const mailer = opts.mailer ?? (f.resend ? new ResendMailer(f.resend.apiKey, f.resend.from) : noMailer);
  if (mailer.enabled && !mailer.reachesCustomers) app.log.info("customer emails off: EMAIL_FROM is Resend's test sender; alerts still go to OWNER_EMAIL (D76)");
  const fulfilment =
    store && db
      ? new Fulfilment({ db, store, lulu, stripe, mailer, contactEmail: f.contactEmail, ownerEmail: f.ownerEmail, faults: new Set(f.faults), trackEveryMs: f.trackEveryMs, kick: () => jobs?.kick(), log: app.log, now: opts.now })
      : undefined;
  // `kick` above runs after this line, so it finds the runner.
  const jobs = fulfilment && db ? new JobRunner({ db, handle: fulfilment.handle, onDead: fulfilment.onDead, log: app.log, now: opts.now }) : undefined;
  app.decorate('jobs', jobs);
  app.decorate('fulfilment', fulfilment);
  const checkout =
    orders && db
      ? new CheckoutService({
          db,
          store,
          quoter,
          stripe,
          taxEnabled: config.stripe?.taxEnabled ?? false,
          webOrigins: config.webOrigins,
          allowLoopbackReturn: config.mode === 'test',
          publicOrigin: config.publicOrigin,
          log: app.log,
          now: opts.now,
          onPaid: () => jobs?.kick(),
        })
      : undefined;
  registerOrderRoutes(app, orders, store, config.webOrigins, undefined, checkout);
  if (fulfilment && config.lulu) registerLuluWebhook(app, fulfilment, config.lulu.clientSecret);
  if (orders && db) {
    let sweep: NodeJS.Timeout | undefined;
    app.addHook('onReady', async () => {
      orders.resume();
      if (opts.startJobs !== false) jobs?.start();
      // R2's lifecycle rule also deletes old files; the local store relies on this.
      sweep = setInterval(() => void orders.sweep().catch(() => undefined), 60 * 60 * 1000).unref();
    });
    app.addHook('onClose', async () => {
      clearInterval(sweep);
      await orders.idle();
      await jobs?.stop();
      if (!opts.db) db.close();
    });
  }

  app.get('/api/health', async () => ({
    ok: true,
    mode: config.mode,
    lulu: Boolean(config.lulu),
    storage: store ? (store instanceof S3Store ? store.config.provider : store.kind) : null,
    payments: stripe ? { webhooks: stripe.canVerifyWebhooks, tax: config.stripe?.taxEnabled ?? false } : null,
    fulfilment: fulfilment ? { emails: mailer.enabled, alerts: Boolean(f.ownerEmail), faults: f.faults } : null,
  }));

  /**
   * Lulu's cover size for the builder's preview (D39). Takes only a package ID and a page count,
   * both checked against what Logbook sells, so the cache (in the client) is bounded and no request
   * reaches Lulu that we wouldn't make ourselves. Content-free, so any origin may ask.
   */
  app.get<{ Querystring: { pod_package_id?: string; pages?: string } }>('/api/cover-dimensions', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    const id = req.query.pod_package_id ?? '';
    const pages = Number(req.query.pages);
    const invalid = checkBook(id, pages);
    if (invalid) return reply.code(400).send({ error: invalid });
    if (!lulu) return reply.code(503).send({ error: 'Lulu is not configured.' });
    try {
      const dims = await lulu.coverDimensions(id, pages);
      reply.header('Cache-Control', 'public, max-age=86400');
      return dims;
    } catch (err) {
      req.log.warn({ status: err instanceof LuluError ? err.status : undefined, pod: id, pages }, 'Lulu cover-dimensions failed');
      return reply.code(502).send({ error: 'Lulu did not answer.' });
    }
  });

  /**
   * A price estimate (PLAN §1.5 step 1, D25): the book from Lulu's live cost, and with `country`
   * (and optional `state`) up to three shipping choices. A GET for the same reasons as
   * cover-dimensions: content-free, cacheable, no CORS preflight. Checkout never trusts these
   * numbers; it re-quotes on the server.
   */
  app.get<{ Querystring: { pod_package_id?: string; pages?: string; country?: string; state?: string } }>('/api/quote', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    const { pod_package_id: id = '', country, state } = req.query;
    const pages = Number(req.query.pages);
    const invalid = checkBook(id, pages);
    if (invalid) return reply.code(400).send({ error: invalid });
    if (country !== undefined && !/^[A-Z]{2}$/.test(country)) return reply.code(400).send({ error: 'country must be an ISO 3166-1 alpha-2 code.' });
    if (state !== undefined && !/^[A-Z0-9]{1,3}$/.test(state)) return reply.code(400).send({ error: 'state must be a short region code.' });
    if (!quoter) return reply.code(503).send({ error: 'Lulu is not configured.' });
    try {
      const quote = await quoter.quote(id, pages, country ? { country, state } : undefined);
      reply.header('Cache-Control', 'public, max-age=600');
      return publicQuote(quote);
    } catch (err) {
      const status = err instanceof LuluError ? err.status : undefined;
      req.log.warn({ status, pod: id, pages, country }, 'Lulu quote failed');
      // Lulu rejects destinations it doesn't ship to with a 400.
      if (status === 400 && country) return reply.code(422).send({ error: 'Lulu has no shipping to that destination.' });
      return reply.code(502).send({ error: 'Lulu did not answer.' });
    }
  });

  return app;
}
