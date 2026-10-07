import Fastify, { type FastifyInstance } from 'fastify';
import { allProducts, pageLimits, podPackageId } from '@logbook/core';
import type { Config } from './config.ts';
import { loggerOptions } from './log.ts';
import { LuluClient, LuluError } from './lulu/client.ts';

/** The package IDs Logbook sells, with their page limits. Nothing else is passed on to Lulu. */
const PACKAGES = new Map(allProducts().map((p) => [podPackageId(p), pageLimits(p)]));

/**
 * The API. M2 has a health check and the cover-dimensions proxy (D39); rendering is reached through
 * uploads in slice E. Until then the renderer runs from scripts and tests only, so nothing deployed
 * accepts journal content (PLAN §6).
 */
export function buildApp(config: Config, opts: { logger?: boolean; lulu?: LuluClient } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger === false ? false : loggerOptions });
  const lulu = opts.lulu ?? (config.lulu ? new LuluClient(config.lulu) : undefined);

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
    const limits = PACKAGES.get(id);
    if (!limits) return reply.code(400).send({ error: 'Unknown pod_package_id.' });
    if (!Number.isInteger(pages) || pages % 2 !== 0 || pages < limits.min || pages > limits.max) {
      return reply.code(400).send({ error: `pages must be an even number from ${limits.min} to ${limits.max}.` });
    }
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

  return app;
}
