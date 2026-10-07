import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import { loggerOptions } from './log.ts';
import { LuluClient, LuluError } from './lulu/client.ts';
import { checkBook, Quoter } from './pricing/quote.ts';

/**
 * The API: a health check, the cover-dimensions proxy (D39) and price quotes (M3). All three are
 * content-free. Rendering is reached through uploads (M2 slice E, now first in M3); until then the
 * renderer runs from scripts and tests only, so nothing deployed accepts journal content (PLAN §6).
 */
export function buildApp(config: Config, opts: { logger?: boolean; lulu?: LuluClient } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger === false ? false : loggerOptions });
  const lulu = opts.lulu ?? (config.lulu ? new LuluClient(config.lulu) : undefined);
  const quoter = lulu && new Quoter(lulu);

  app.get('/api/health', async () => ({ ok: true, mode: config.mode, lulu: Boolean(config.lulu) }));

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
      return quote;
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
