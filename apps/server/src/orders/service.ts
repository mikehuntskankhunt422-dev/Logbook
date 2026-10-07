import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { bundleFileSchema, podPackageId, printBundleSchema, printMediaPlan, productSchema, selectEntries, type MediaMeta } from '@logbook/core';
import { LuluError, type LuluClient } from '../lulu/client.ts';
import type { Quoter } from '../pricing/quote.ts';
import type { BookRender, BookSource } from '../render/book.ts';
import { TooManyPagesError } from '../render/interior.ts';
import type { ObjectStore } from '../storage/store.ts';
import type { ExpectedUpload, LuluCheck, Order, OrderDb } from './db.ts';

/** Signed upload URLs last an hour; proof links an hour; Lulu gets two hours to fetch. */
export const UPLOAD_TTL_S = 60 * 60;
export const PROOF_TTL_S = 60 * 60;
const LULU_FETCH_TTL_S = 2 * 60 * 60;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024;
/** Order files are deleted this long after the order was last touched (R2 lifecycle does the same, D16). */
export const RETENTION_DAYS = 7;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const createOrderSchema = z.object({
  product: productSchema,
  bundle: z.object({ bytes: z.number().int().positive().max(MAX_FILE_BYTES), sha256 }),
  files: z.array(z.object({ path: bundleFileSchema.shape.path, bytes: z.number().int().positive().max(MAX_FILE_BYTES), sha256 })).max(20000),
});
export type CreateOrder = z.infer<typeof createOrderSchema>;

/** A problem with what the client sent, or with the book itself: the order fails and nothing is charged. */
export class OrderError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

export interface OrderView {
  id: string;
  state: Order['state'];
  stage: string | null;
  pages: number | null;
  coverApproximate: boolean | null;
  currency: 'usd';
  bookCents: number | null;
  lulu: LuluCheck | null;
  error: string | null;
  /** Links to the print files while they exist (an hour each time the order is read). */
  proof: { interior: string; cover: string } | null;
}

export interface OrderDeps {
  db: OrderDb;
  store: ObjectStore;
  lulu?: LuluClient;
  quoter?: Quoter;
  render(src: BookSource): Promise<BookRender>;
  /** Scratch space; each order gets its own folder, removed afterwards. */
  workRoot: string;
  log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
  now?: () => Date;
}

const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const uploadKey = (id: string, path: string) => `orders/${id}/upload/${path}`;
const printKey = (id: string, file: 'interior' | 'cover') => `orders/${id}/print/${file}.pdf`;

/**
 * Orders from upload to quote (PLAN §1.5 steps 2–3). The client uploads straight to storage with
 * signed URLs; the server checks every file against the hashes it was promised, renders, asks Lulu
 * to validate, and prices from Lulu's live cost. Content never reaches the database or the logs.
 */
export class OrderService {
  private chain: Promise<void> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly deps: OrderDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async create(input: CreateOrder): Promise<{ orderId: string; token: string; expiresInSeconds: number; uploads: (ExpectedUpload & { url: string; method: 'PUT'; headers: Record<string, string> })[] }> {
    const paths = new Set(input.files.map((f) => f.path));
    if (paths.size !== input.files.length) throw new OrderError('Each file may be listed once.');
    const total = input.bundle.bytes + input.files.reduce((n, f) => n + f.bytes, 0);
    if (total > MAX_TOTAL_BYTES) throw new OrderError('This book is too large to upload in one go.', 413);

    const id = `ord_${randomBytes(12).toString('base64url')}`;
    const token = randomBytes(32).toString('base64url');
    const uploads: ExpectedUpload[] = [
      { path: 'bundle.json', bytes: input.bundle.bytes, sha256: input.bundle.sha256, contentType: 'application/json' },
      ...input.files.map((f) => ({ ...f, contentType: CONTENT_TYPES[f.path.split('.').pop()!]! })),
    ];
    this.deps.db.create({ id, tokenHash: hash(token), podPackageId: podPackageId(input.product), product: input.product, uploads }, this.now());
    const signed = await Promise.all(uploads.map(async (u) => ({ ...u, ...(await this.deps.store.signPut(uploadKey(id, u.path), { contentType: u.contentType, expiresInSeconds: UPLOAD_TTL_S })) })));
    this.deps.log.info({ orderId: id, files: uploads.length, bytes: total }, 'order created');
    return { orderId: id, token, expiresInSeconds: UPLOAD_TTL_S, uploads: signed };
  }

  /** The order, if `token` is its secret. Unknown id and wrong token look the same. */
  authorize(id: string, token: string | undefined): Order {
    const order = this.deps.db.get(id);
    const ok = order && token && timingSafeEqual(Buffer.from(order.tokenHash), Buffer.from(hash(token)));
    if (!ok) throw new OrderError('No such order.', 404);
    return order;
  }

  /** Called when the client has uploaded everything: checks sizes, then queues the work. */
  async submit(id: string, token: string | undefined): Promise<OrderView> {
    const order = this.authorize(id, token);
    if (order.state !== 'draft' || order.stage !== 'awaiting upload') return this.view(order);
    const missing: string[] = [];
    for (const u of order.uploads) if ((await this.deps.store.size(uploadKey(id, u.path))) !== u.bytes) missing.push(u.path);
    if (missing.length) throw new OrderError(`${missing.length} of ${order.uploads.length} files are missing or incomplete: ${missing.slice(0, 5).join(', ')}`, 409);
    this.deps.db.update(id, { stage: 'queued' }, this.now());
    this.enqueue(id);
    return this.view(this.deps.db.get(id)!);
  }

  async view(order: Order): Promise<OrderView> {
    const hasPrint = order.pages !== null && order.state !== 'failed';
    return {
      id: order.id,
      state: order.state,
      stage: order.stage,
      pages: order.pages,
      coverApproximate: order.coverApproximate,
      currency: 'usd',
      bookCents: order.bookCents,
      lulu: order.lulu,
      error: order.error,
      proof: hasPrint
        ? {
            interior: await this.deps.store.signGet(printKey(order.id, 'interior'), PROOF_TTL_S, { downloadName: 'logbook-interior.pdf' }),
            cover: await this.deps.store.signGet(printKey(order.id, 'cover'), PROOF_TTL_S, { downloadName: 'logbook-cover.pdf' }),
          }
        : null,
    };
  }

  /** Picks up drafts that were queued or in progress when the server stopped. */
  resume(): void {
    for (const o of this.deps.db.unfinished()) this.enqueue(o.id);
  }

  /** Resolves when every queued order has been processed (tests and shutdown). */
  idle(): Promise<void> {
    return this.chain;
  }

  private enqueue(id: string): void {
    // One book at a time: rendering is CPU- and memory-heavy (D13).
    this.chain = this.chain.then(() => this.process(id)).catch((err: unknown) => this.deps.log.error({ orderId: id, err: String(err).slice(0, 300) }, 'order processing crashed'));
  }

  private stage(id: string, stage: string): void {
    this.deps.db.update(id, { stage }, this.now());
    this.deps.log.info({ orderId: id, stage }, 'order stage');
  }

  private async process(id: string): Promise<void> {
    const order = this.deps.db.get(id);
    if (!order || order.state !== 'draft') return;
    const work = await mkdtemp(join(this.deps.workRoot, `${id}-`));
    try {
      this.stage(id, 'checking');
      const files = new Map<string, string>();
      const bundleBytes = await this.deps.store.get(uploadKey(id, 'bundle.json'));
      const expectedBundle = order.uploads.find((u) => u.path === 'bundle.json')!;
      if (!bundleBytes || hash(bundleBytes) !== expectedBundle.sha256) throw new OrderError('The book data did not arrive intact.');
      const parsed = printBundleSchema.safeParse(JSON.parse(Buffer.from(bundleBytes).toString('utf8')));
      if (!parsed.success) throw new OrderError('The book data is not in a format this server understands.');
      const bundle = parsed.data;
      if (podPackageId(bundle.options.product) !== order.podPackageId) throw new OrderError('The book data does not match the order.');

      const expected = new Map(order.uploads.map((u) => [u.path, u]));
      const meta = new Map<string, MediaMeta>(bundle.media.map((m) => [m.meta.id, m.meta]));
      for (const m of bundle.media) {
        if (!m.file) continue;
        const promised = expected.get(m.file.path);
        if (!promised || promised.sha256 !== m.file.sha256) throw new OrderError('The book data lists a file that was not uploaded.');
        const bytes = await this.deps.store.get(uploadKey(id, m.file.path));
        if (!bytes || hash(bytes) !== m.file.sha256) throw new OrderError(`A picture did not arrive intact (${m.file.path}).`);
        const local = join(work, 'upload', m.file.path);
        await mkdir(dirname(local), { recursive: true });
        await writeFile(local, bytes);
        files.set(m.meta.id, local);
      }
      const entries = selectEntries(bundle.entries, bundle.options.selection);
      if (!entries.length) throw new OrderError('The book has no entries.');
      const plan = printMediaPlan(entries, bundle.options, (mid) => meta.get(mid));
      const absent = plan.files.filter((mid) => !files.has(mid));
      if (absent.length) throw new OrderError(`${absent.length} pictures the book shows were not uploaded.`);

      this.stage(id, 'rendering');
      const lulu = this.deps.lulu;
      const book = await this.deps.render({
        options: bundle.options,
        entries,
        meta: (mid) => meta.get(mid),
        source: async (mid) => files.get(mid),
        audioPeaks: bundle.audioPeaks,
        printedOn: this.now().toISOString().slice(0, 10),
        coverDims: lulu ? (pod, pages) => lulu.coverDimensions(pod, pages) : undefined,
        embedThumbnails: true,
        workDir: work,
      });
      const pages = book.interior.plan.pages;
      await this.deps.store.put(printKey(id, 'interior'), book.interior.pdf, 'application/pdf');
      await this.deps.store.put(printKey(id, 'cover'), book.cover.pdf, 'application/pdf');
      // The sources have done their job: keep only the print files (PLAN §6).
      await this.deps.store.deletePrefix(`orders/${id}/upload/`);
      this.deps.db.update(id, { pages, coverApproximate: book.coverApproximate }, this.now());

      this.stage(id, 'validating');
      const check = await this.validate(id, order.podPackageId, pages);
      this.deps.db.update(id, { lulu: check }, this.now());
      if (check.checked) {
        const interiorOk = (check.interior.status === 'VALIDATED' || check.interior.status === 'NORMALIZED') && check.interior.pageCount === pages;
        if (!interiorOk || check.cover.status !== 'NORMALIZED') {
          const errors = [...(check.interior.errors ?? []), ...(check.cover.errors ?? [])].join('; ').slice(0, 400);
          throw new OrderError(`The printer could not use the print files${errors ? `: ${errors}` : '.'}`);
        }
      }

      this.stage(id, 'pricing');
      const bookCents = this.deps.quoter ? (await this.deps.quoter.quote(order.podPackageId, pages)).bookCents : null;
      this.deps.db.update(id, { bookCents, stage: null }, this.now());
      this.deps.db.move(id, 'quoted', 'job:prepare', { now: this.now() });
      this.deps.log.info({ orderId: id, pages, priced: bookCents !== null, luluChecked: check.checked }, 'order quoted');
    } catch (err) {
      const message =
        err instanceof OrderError || err instanceof TooManyPagesError
          ? err.message
          : err instanceof LuluError
            ? 'The printer did not answer. Please try again later.'
            : 'Something went wrong while preparing the book.';
      const failure = err instanceof Error ? err.name : 'unknown';
      this.deps.log.warn({ orderId: id, failure, detail: String(err).slice(0, 300) }, 'order failed');
      this.deps.db.update(id, { stage: null, error: message }, this.now());
      this.deps.db.move(id, 'failed', 'job:prepare', { detail: failure, now: this.now() });
      await this.deps.store.deletePrefix(`orders/${id}/`).catch(() => undefined);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /** Lulu's validators, when Lulu can fetch our files and we have credentials. */
  private async validate(id: string, pod: string, pages: number): Promise<LuluCheck> {
    const lulu = this.deps.lulu;
    if (!lulu) return { checked: false, reason: 'no Lulu credentials' };
    if (!this.deps.store.reachableFromInternet) return { checked: false, reason: 'local storage: Lulu cannot fetch the files' };
    const [i0, c0] = await Promise.all([
      lulu.validateInterior(await this.deps.store.signGet(printKey(id, 'interior'), LULU_FETCH_TTL_S), pod),
      lulu.validateCover(await this.deps.store.signGet(printKey(id, 'cover'), LULU_FETCH_TTL_S), pod, pages),
    ]);
    const [i, c] = await Promise.all([
      lulu.waitForValidation(i0, (vid) => lulu.getInteriorValidation(vid), { timeoutMs: 20 * 60_000 }),
      lulu.waitForValidation(c0, (vid) => lulu.getCoverValidation(vid), { timeoutMs: 20 * 60_000 }),
    ]);
    return { checked: true, interior: { id: i.id, status: i.status, pageCount: i.page_count, errors: i.errors }, cover: { id: c.id, status: c.status, errors: c.errors } };
  }

  /** Deletes the files of orders idle for longer than the retention period. */
  async sweep(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let n = 0;
    for (const o of this.deps.db.idleSince(cutoff)) n += await this.deps.store.deletePrefix(`orders/${o.id}/`);
    return n;
  }
}
