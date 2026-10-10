import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { StripeSignatureError } from '../payments/stripe.ts';
import { LOCAL_STORAGE_ROUTE, LocalStore } from '../storage/local.ts';
import type { ObjectStore } from '../storage/store.ts';
import { CHECKOUT_DONE_PATH, type CheckoutService } from './checkout.ts';
import { createOrderSchema, OrderError, type OrderService } from './service.ts';

const quoteSchema = z.object({ country: z.string().regex(/^[A-Z]{2}$/), state: z.string().regex(/^[A-Z0-9]{1,3}$/).optional() });
const checkoutSchema = z.object({ quoteVersion: z.number().int().positive(), returnUrl: z.string().max(2000), checked: z.boolean() });

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when order storage is configured. */
    orders?: OrderService;
  }
}

const CONTENT_TYPES: Record<string, string> = { json: 'application/json', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

/** New orders per client address per hour: each one hands out upload URLs into our storage (D53). */
export const ORDERS_PER_HOUR = 10;
/** Re-quotes and checkouts per order per hour: each can ask Lulu for prices or open a Stripe session. */
export const PAYMENT_STEPS_PER_HOUR = 60;

/** A sliding one-hour window per key, in memory (one process, D13). */
export class HourlyLimit {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}
  take(key: string): boolean {
    const cutoff = this.now() - 60 * 60 * 1000;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => t > cutoff)) this.hits.delete(k);
    return true;
  }
}
const bearer = (req: FastifyRequest) => /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof OrderError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

/**
 * The order API (M3 slice C, PLAN §1.5 steps 2–3). It receives only a manifest (sizes and hashes)
 * and hands out signed upload URLs; content goes straight to storage. Reading an order needs the
 * secret token returned when it was created.
 */
/**
 * The desktop app's window (D77, D79): Tauri serves it from `tauri://localhost` on macOS and Linux
 * and `http://tauri.localhost` on Windows. Its requests carry the same order token as the website's.
 */
export const DESKTOP_APP_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];

/**
 * Where Stripe sends a desktop customer (D79). A browser can't bring the app's window back, so
 * this only says what happened and to return to Logbook, which notices the payment by itself. The
 * page holds no order details; the order ID stays in the address's #fragment, which never reaches us.
 */
const CHECKOUT_DONE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Back to Logbook</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 17px/1.5 system-ui, sans-serif; background: #fbf7f1; color: #1f1b16; }
  main { max-width: 30rem; padding: 2rem 1.25rem; text-align: center; }
  h1 { font-size: 1.5rem; margin: 0.5rem 0 1rem; }
  p { margin: 0 0 1rem; }
  @media (prefers-color-scheme: dark) { body { background: #15130f; color: #f3ede4; } }
</style>
</head>
<body>
<main>
  <div aria-hidden="true" style="font-size:2.6rem">📓</div>
  <h1 id="title">You can go back to Logbook now</h1>
  <p id="said">If you paid, Logbook shows your order as paid within a few seconds. If you left without paying, nothing was charged, and you can pay from Logbook whenever you're ready.</p>
  <p>You can close this tab.</p>
</main>
<script>
  // Stripe adds ?cancelled=1 after the order's #fragment when the customer leaves without paying.
  if (/[?&]cancelled=1/.test(location.hash)) {
    document.getElementById('title').textContent = 'Nothing was charged';
    document.getElementById('said').textContent = "You left the payment page. Go back to Logbook to pay whenever you're ready.";
  } else if (location.hash) {
    document.getElementById('title').textContent = 'Thank you! Go back to Logbook';
    document.getElementById('said').textContent = 'Logbook shows your order as paid within a few seconds, then follows your book to the printer and to your door.';
  }
</script>
</body>
</html>
`;

export function registerOrderRoutes(
  app: FastifyInstance,
  service: OrderService | undefined,
  store: ObjectStore | undefined,
  webOrigins: string[],
  limit = new HourlyLimit(ORDERS_PER_HOUR),
  checkout?: CheckoutService,
): void {
  app.decorate('orders', service);
  const steps = new HourlyLimit(PAYMENT_STEPS_PER_HOUR);
  const tooMany = (reply: FastifyReply) => reply.code(429).header('Retry-After', '3600').send({ error: 'Too many changes to this order in the last hour. Please try again later.' });

  // CORS for the website when it's hosted apart from the API (D15), and for the desktop app (D79). Only listed origins.
  const corsOrigins = new Set([...webOrigins, ...DESKTOP_APP_ORIGINS]);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/orders')) return;
    const origin = req.headers.origin;
    if (!origin || !corsOrigins.has(origin)) return;
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      return reply.code(204).header('Access-Control-Allow-Methods', 'GET, POST').header('Access-Control-Allow-Headers', 'authorization, content-type').header('Access-Control-Max-Age', '600').send();
    }
  });

  app.get(CHECKOUT_DONE_PATH, async (_req, reply) =>
    reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'public, max-age=3600').header('Referrer-Policy', 'no-referrer').send(CHECKOUT_DONE_HTML),
  );

  app.post('/api/orders', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    if (!service) return reply.code(503).send({ error: 'Ordering is not available on this server yet.' });
    if (!limit.take(req.ip)) return reply.code(429).header('Retry-After', '3600').send({ error: 'Too many books prepared from here in the last hour. Please try again later.' });
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'The order request is not valid.', issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
    try {
      return reply.code(201).send(await service.create(parsed.data));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>('/api/orders/:id/submit', async (req, reply) => {
    if (!service) return reply.code(503).send({ error: 'Ordering is not available on this server yet.' });
    try {
      return reply.code(202).send(await service.submit(req.params.id, bearer(req)));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>('/api/orders/:id', async (req, reply) => {
    if (!service) return reply.code(503).send({ error: 'Ordering is not available on this server yet.' });
    try {
      reply.header('Cache-Control', 'no-store');
      const order = service.authorize(req.params.id, bearer(req));
      return await service.view(checkout ? await checkout.refresh(order) : order);
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Prices the book for a destination country (PLAN §1.5 step 4). */
  app.post<{ Params: { id: string } }>('/api/orders/:id/quote', async (req, reply) => {
    if (!service || !checkout) return reply.code(503).send({ error: 'Ordering is not available on this server yet.' });
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Choose a country from the list.' });
    try {
      reply.header('Cache-Control', 'no-store');
      const order = service.authorize(req.params.id, bearer(req));
      if (!steps.take(order.id)) return tooMany(reply);
      return await service.view(await checkout.requote(order, parsed.data));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Opens Stripe Checkout for the quote the customer saw (PLAN §1.5 step 5). */
  app.post<{ Params: { id: string } }>('/api/orders/:id/checkout', async (req, reply) => {
    if (!service || !checkout) return reply.code(503).send({ error: 'Ordering is not available on this server yet.' });
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'The payment request is not valid.' });
    try {
      reply.header('Cache-Control', 'no-store');
      const order = service.authorize(req.params.id, bearer(req));
      if (!steps.take(order.id)) return tooMany(reply);
      return await checkout.checkout(order, parsed.data);
    } catch (err) {
      return fail(reply, err);
    }
  });

  if (checkout?.enabled) registerStripeWebhook(app, checkout);

  if (store instanceof LocalStore) registerLocalStorage(app, store);
}

/**
 * Stripe's webhook (PLAN §1.5 step 6). The signature is checked on the raw bytes, so this route
 * keeps the body as a buffer. A 400 tells Stripe the request wasn't ours; a 500 makes it retry, and
 * because a failed event isn't recorded, the retry is processed in full.
 */
function registerStripeWebhook(app: FastifyInstance, checkout: CheckoutService): void {
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
    scope.post('/api/stripe/webhook', async (req, reply) => {
      const signature = req.headers['stripe-signature'];
      let event;
      try {
        event = checkout.verifyWebhook(req.body as Buffer, typeof signature === 'string' ? signature : undefined);
      } catch (err) {
        if (err instanceof StripeSignatureError) {
          req.log.warn({ reason: err.message.slice(0, 200) }, 'Stripe webhook refused');
          return reply.code(400).send({ error: 'Invalid signature.' });
        }
        throw err;
      }
      return { received: true, outcome: checkout.handleEvent(event) };
    });
  });
}

/** Serves the local store's signed URLs (development and tests only, D51). */
function registerLocalStorage(app: FastifyInstance, store: LocalStore): void {
  void app.register(async (scope) => {
    // Uploads are raw bytes of any type.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 60 * 1024 * 1024 }, (_req, body, done) => done(null, body));

    scope.put<{ Params: { '*': string }; Querystring: { expires?: string; sig?: string } }>(`${LOCAL_STORAGE_ROUTE}/*`, async (req, reply) => {
      const key = store.verify('PUT', req.params['*'], req.query, req.headers['content-type'] ?? '');
      if (!key) return reply.code(403).send({ error: 'This upload link is invalid or has expired.' });
      await store.put(key, new Uint8Array(req.body as Buffer));
      return reply.code(200).send();
    });

    scope.get<{ Params: { '*': string }; Querystring: { expires?: string; sig?: string; name?: string } }>(`${LOCAL_STORAGE_ROUTE}/*`, async (req, reply) => {
      const key = store.verify('GET', req.params['*'], req.query);
      if (!key) return reply.code(403).send({ error: 'This link is invalid or has expired.' });
      const bytes = await store.get(key);
      if (!bytes) return reply.code(404).send({ error: 'Not found.' });
      reply.header('Content-Type', CONTENT_TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream').header('Cache-Control', 'private, no-store');
      if (req.query.name) reply.header('Content-Disposition', `inline; filename="${req.query.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
      return reply.send(Buffer.from(bytes));
    });
  });
}
