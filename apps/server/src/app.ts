import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import { loggerOptions } from './log.ts';

/**
 * The API. M2 only has a health check; the cover-dimensions proxy (D39) arrives with the Lulu client
 * in slice D, and rendering is reached through uploads in slice E. Until then the renderer runs from
 * scripts and tests only, so nothing deployed accepts journal content (PLAN §6).
 */
export function buildApp(config: Config, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger === false ? false : loggerOptions });

  app.get('/api/health', async () => ({ ok: true, mode: config.mode, lulu: Boolean(config.lulu) }));

  return app;
}
