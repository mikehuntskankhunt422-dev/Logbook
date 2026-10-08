import type { FastifyServerOptions } from 'fastify';

/**
 * Field names that can carry journal content (PLAN §6). The logger redacts them wherever they
 * appear, and test/log-safety.test.ts fails the build if a log call in src/ mentions one.
 */
export const CONTENT_FIELDS = ['title', 'subtitle', 'author', 'backText', 'caption', 'text', 'doc', 'blocks', 'entries', 'tags', 'name', 'url'] as const;

export const loggerOptions: FastifyServerOptions['logger'] = {
  level: process.env['LOG_LEVEL'] ?? 'info',
  // Paths only: query strings can hold signed-URL signatures (D51) and order details.
  serializers: {
    req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }),
  },
  redact: {
    paths: ['req.body', 'res.body', ...CONTENT_FIELDS.flatMap((f) => [f, `*.${f}`, `*.*.${f}`])],
    censor: '[content]',
  },
};
