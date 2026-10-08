import Fastify, { type FastifyInstance } from 'fastify';
import { strToU8, zipSync } from 'fflate';
import { BookBundleError, PageCountError, readBookBundle } from '@logbook/core';
import { CoverDimensionsUnavailable, type CoverDimensionsSource } from './lulu.ts';
import { renderBook } from './render/book.ts';
import type { Renderer } from './render/renderer.ts';

export interface AppOptions {
  renderer: Renderer;
  covers: CoverDimensionsSource;
  /** Browser origins allowed to call the API (the web app). */
  webOrigins: readonly string[];
  /** Largest bundle accepted, in bytes. */
  bodyLimit?: number;
  /** Renders allowed at once; more wait in line. Each one is a Chromium tab working flat out. */
  maxConcurrentRenders?: number;
  logger?: boolean;
}

/**
 * HTTP API. Logging is limited to Fastify's request line and status: book content, file names and
 * titles never reach the logs (PLAN §6).
 */
export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: opts.bodyLimit ?? 512 * 1024 * 1024 });
  const gate = new Gate(opts.maxConcurrentRenders ?? 1);
  const origins = new Set(opts.webOrigins);

  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'origin');
      reply.header('access-control-expose-headers', 'x-logbook-pages, x-logbook-cover-source');
    }
    if (req.method === 'OPTIONS') {
      reply.header('access-control-allow-methods', 'GET, POST');
      reply.header('access-control-allow-headers', 'content-type');
      reply.header('access-control-max-age', '600');
      return reply.code(204).send();
    }
  });

  app.get('/health', async () => ({ ok: true, coverDimensions: opts.covers.kind }));

  /**
   * POST /render (application/zip book bundle) → application/zip with interior.pdf, cover.pdf and
   * report.json (page plan, package ID, cover size and source, print warnings).
   */
  app.post('/render', async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'Send the book bundle as application/zip' });
    try {
      const bundle = readBookBundle(new Uint8Array(req.body));
      if (bundle.entries.length === 0) return reply.code(422).send({ error: 'This book has no entries' });
      const out = await gate.run(() => renderBook(opts.renderer, bundle, opts.covers));
      const report = {
        podPackageId: out.podPackageId,
        plan: out.plan,
        cover: {
          widthIn: out.cover.dims.widthIn,
          heightIn: out.cover.dims.heightIn,
          source: out.cover.dims.source,
          spineIn: out.cover.geometry.spineIn,
          provisional: out.cover.geometry.provisional,
        },
        warnings: out.warnings,
        timingsMs: out.timingsMs,
      };
      const zip = zipSync({
        'interior.pdf': [out.interiorPdf, { level: 0 }],
        'cover.pdf': [out.coverPdf, { level: 0 }],
        'report.json': strToU8(JSON.stringify(report, null, 2)),
      });
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', 'attachment; filename="book-pdfs.zip"')
        .header('x-logbook-pages', String(out.plan.totalPages))
        .header('x-logbook-cover-source', out.cover.dims.source)
        .send(Buffer.from(zip));
    } catch (err) {
      if (err instanceof BookBundleError) return reply.code(400).send({ error: err.message });
      if (err instanceof PageCountError) return reply.code(422).send({ error: err.message, pageCount: err.pageCount, maxPages: err.maxPages, suggestedVolumes: err.suggestedVolumes });
      if (err instanceof CoverDimensionsUnavailable) return reply.code(422).send({ error: err.message });
      throw err;
    }
  });

  return app;
}

/** A tiny counting semaphore. */
class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = Math.max(1, limit);
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
