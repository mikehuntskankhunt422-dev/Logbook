import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LOCAL_STORAGE_ROUTE, LocalStore } from '../storage/local.ts';
import type { ObjectStore } from '../storage/store.ts';
import { createOrderSchema, OrderError, type OrderService } from './service.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when order storage is configured. */
    orders?: OrderService;
  }
}

const CONTENT_TYPES: Record<string, string> = { json: 'application/json', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

/** New orders per client address per hour: each one hands out upload URLs into our storage (D53). */
export const ORDERS_PER_HOUR = 10;

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
export function registerOrderRoutes(app: FastifyInstance, service: OrderService | undefined, store: ObjectStore | undefined, webOrigins: string[], limit = new HourlyLimit(ORDERS_PER_HOUR)): void {
  app.decorate('orders', service);

  // CORS for the website when it's hosted apart from the API (D15). Only listed origins.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/orders')) return;
    const origin = req.headers.origin;
    if (!origin || !webOrigins.includes(origin)) return;
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      return reply.code(204).header('Access-Control-Allow-Methods', 'GET, POST').header('Access-Control-Allow-Headers', 'authorization, content-type').header('Access-Control-Max-Age', '600').send();
    }
  });

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
      return await service.view(service.authorize(req.params.id, bearer(req)));
    } catch (err) {
      return fail(reply, err);
    }
  });

  if (store instanceof LocalStore) registerLocalStorage(app, store);
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
