import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Product } from '@logbook/core';
import { transition, type OrderEvent, type OrderState } from './machine.ts';

/** A file the client promised to upload: its path in the bundle, size and SHA-256. */
export interface ExpectedUpload {
  path: string;
  bytes: number;
  sha256: string;
  contentType: string;
}

/** A shipping choice as offered in Checkout, with what Lulu charges us for it. */
export interface StoredShipping {
  level: string;
  name: string;
  daysMin: number | null;
  daysMax: number | null;
  priceCents: number;
  luluCents: number;
}

/**
 * The price for one destination (PLAN §1.5 step 4). Checkout charges exactly this, never numbers
 * from the client; `version` goes up with every re-quote and is part of the Checkout idempotency key.
 * The Lulu costs are kept so every price can be reproduced from them (M3 §4).
 */
export interface StoredQuote {
  version: number;
  at: string;
  country: string;
  state?: string;
  bookCents: number;
  costCents: number;
  shipping: StoredShipping[];
}

/** The Stripe Checkout Session opened for this order (the latest one). */
export interface CheckoutRef {
  sessionId: string;
  url: string;
  expiresAt: string;
  quoteVersion: number;
  /** Which Checkout attempt for this order made the session (part of its idempotency key, D55). */
  attempt: number;
}

/** What Stripe reported once the order was paid. The address and phone are for the printer (PLAN §6). */
export interface Payment {
  sessionId: string;
  paymentIntent: string | null;
  amountTotal: number;
  amountShipping: number;
  amountTax: number;
  currency: string;
  /** Lulu's shipping level for the option the customer chose. */
  shippingLevel: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  address: { line1: string | null; line2: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null } | null;
  /** BR, CL and MX only (D26). */
  recipientTaxId: string | null;
  paidAt: string;
}

/** Size and hashes of one print file, recorded when it was rendered (the file the customer approves). */
export interface PrintFileHash {
  bytes: number;
  sha256: string;
  /** Lulu checks this against what it downloads (D66). */
  md5: string;
}

export interface PrintFiles {
  interior: PrintFileHash;
  cover: PrintFileHash;
  /** When they were made: Checkout refuses files close to the 7-day deletion (D71). */
  at: string;
}

/** The Lulu print job for a paid order, as last read from Lulu (PLAN §1.5 step 8). No content. */
export interface LuluJobRef {
  id: number;
  status: string;
  message: string | null;
  changedAt: string | null;
  lineItemStatus: string | null;
  tracking: { id: string | null; urls: string[]; carrier: string | null } | null;
  arrival: { min: string | null; max: string | null } | null;
  /** When we sent it to Lulu (or found it there). */
  submittedAt: string;
  /** When we last read it. */
  checkedAt: string;
}

export interface Refund {
  id: string;
  amount: number;
  currency: string;
  status: string;
  at: string;
}

/** What Lulu said about the print files, or why they weren't sent. */
export type LuluCheck =
  | { checked: true; interior: { id: number; status: string | null; pageCount?: number | null; errors?: string[] | null }; cover: { id: number; status: string | null; errors?: string[] | null } }
  | { checked: false; reason: string };

/**
 * One order. Holds configuration, counts, prices and statuses only: never journal text (PLAN §6).
 * The book's words live in the uploaded bundle and the PDFs in storage, which expire.
 */
export interface Order {
  id: string;
  tokenHash: string;
  state: OrderState;
  /** Progress within a state while the server works on it: queued, checking, rendering, validating, pricing. */
  stage: string | null;
  podPackageId: string;
  product: Product;
  uploads: ExpectedUpload[];
  pages: number | null;
  coverApproximate: boolean | null;
  bookCents: number | null;
  lulu: LuluCheck | null;
  quote: StoredQuote | null;
  checkout: CheckoutRef | null;
  payment: Payment | null;
  /** Content-free reason for failed or needs_attention. */
  error: string | null;
  printFiles: PrintFiles | null;
  luluJob: LuluJobRef | null;
  refund: Refund | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, string | number | null>;

/** Schema changes, in order; `pragma user_version` records how many have run. */
const MIGRATIONS = [
  `
create table if not exists orders (
  id text primary key,
  token_hash text not null,
  state text not null,
  stage text,
  pod_package_id text not null,
  product text not null,
  uploads text not null,
  pages integer,
  cover_approximate integer,
  book_cents integer,
  lulu text,
  error text,
  created_at text not null,
  updated_at text not null
);
create table if not exists order_events (
  id integer primary key autoincrement,
  order_id text not null references orders(id),
  from_state text not null,
  to_state text not null,
  cause text not null,
  detail text,
  at text not null
);
create index if not exists order_events_order on order_events(order_id);
`,
  // M3 slices D and E: the stored quote, Checkout and payment; Stripe event IDs, each processed once.
  `
alter table orders add column quote text;
alter table orders add column checkout text;
alter table orders add column payment text;
create table stripe_events (
  id text primary key,
  type text not null,
  order_id text,
  outcome text not null,
  received_at text not null
);
`,
  // Checkout attempts are counted before Stripe is asked, so an idempotency key is never reused (D55).
  `
alter table orders add column checkout_attempts integer not null default 0;
`,
  // M4: print-file hashes, the Lulu print job, the refund; and jobs with retries and backoff (D68).
  `
alter table orders add column print_files text;
alter table orders add column lulu_job_id integer;
alter table orders add column lulu_job text;
alter table orders add column refund text;
create index orders_lulu_job on orders(lulu_job_id);
create table jobs (
  id integer primary key autoincrement,
  order_id text not null references orders(id),
  kind text not null,
  key text not null default '',
  state text not null,
  run_at text not null,
  attempts integer not null default 0,
  last_error text,
  version integer not null default 0,
  created_at text not null,
  updated_at text not null,
  unique (order_id, kind, key)
);
create index jobs_due on jobs(state, run_at);
`,
];

/** Work done after payment, with retries (D68): fulfilment, tracking, refunds and emails. */
export type JobKind = 'fulfil' | 'track' | 'refund' | 'email';

export interface JobRow {
  id: number;
  orderId: string;
  kind: JobKind;
  /** Tells apart jobs of one kind for one order, e.g. which email. */
  key: string;
  state: 'queued' | 'done' | 'dead';
  runAt: string;
  attempts: number;
  lastError: string | null;
  /** Goes up when the job is queued again, so a run that finishes afterwards can't undo that. */
  version: number;
}

export interface StripeEventRow {
  id: string;
  type: string;
  orderId: string | null;
  outcome: string;
  receivedAt: string;
}

/**
 * Orders in SQLite through Node's built-in `node:sqlite` (D52). One file, one process (D13, D14).
 * Every state change goes through the machine and writes an `order_events` row in one transaction.
 */
export class OrderDb {
  private readonly db: DatabaseSync;
  private depth = 0;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
    this.migrate();
  }

  private migrate(): void {
    const { user_version: done } = this.db.prepare('pragma user_version').get() as { user_version: number };
    // Databases from before migrations were numbered already have the first one's tables.
    const legacy = done === 0 && this.db.prepare("select 1 from sqlite_master where type = 'table' and name = 'orders'").get() !== undefined;
    for (let i = legacy ? 1 : done; i < MIGRATIONS.length; i++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[i]!);
        this.db.exec(`pragma user_version = ${i + 1}`);
      });
    }
  }

  /**
   * Runs `fn` atomically; nested calls join the outer transaction through a savepoint. The depth is
   * counted down exactly once whatever fails, so a failed commit can't wedge later transactions.
   */
  transaction<T>(fn: () => T): T {
    const outer = this.depth === 0;
    const sp = `sp${this.depth}`;
    this.db.exec(outer ? 'begin immediate' : `savepoint ${sp}`);
    this.depth++;
    try {
      const result = fn();
      this.db.exec(outer ? 'commit' : `release ${sp}`);
      return result;
    } catch (err) {
      try {
        if (!outer) this.db.exec(`rollback to ${sp}; release ${sp}`);
        else if (this.db.isTransaction) this.db.exec('rollback');
      } catch {
        // The original error says what went wrong; a failed rollback leaves SQLite to roll back.
      }
      throw err;
    } finally {
      this.depth--;
    }
  }

  close(): void {
    this.db.close();
  }

  create(o: Pick<Order, 'id' | 'tokenHash' | 'podPackageId' | 'product' | 'uploads'>, now = new Date()): Order {
    const at = now.toISOString();
    this.db
      .prepare('insert into orders (id, token_hash, state, stage, pod_package_id, product, uploads, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(o.id, o.tokenHash, 'draft', 'awaiting upload', o.podPackageId, JSON.stringify(o.product), JSON.stringify(o.uploads), at, at);
    return this.get(o.id)!;
  }

  get(id: string): Order | undefined {
    const row = this.db.prepare('select * from orders where id = ?').get(id) as Row | undefined;
    return row && toOrder(row);
  }

  /** Updates fields other than the state (use `move` for that). */
  update(id: string, patch: Partial<Pick<Order, 'stage' | 'pages' | 'coverApproximate' | 'bookCents' | 'lulu' | 'quote' | 'checkout' | 'payment' | 'error' | 'printFiles' | 'luluJob' | 'refund'>>, now = new Date()): void {
    const cols: string[] = [];
    const vals: (string | number | null)[] = [];
    const set = (col: string, v: string | number | null) => {
      cols.push(`${col} = ?`);
      vals.push(v);
    };
    if ('stage' in patch) set('stage', patch.stage ?? null);
    if ('pages' in patch) set('pages', patch.pages ?? null);
    if ('coverApproximate' in patch) set('cover_approximate', patch.coverApproximate === null || patch.coverApproximate === undefined ? null : patch.coverApproximate ? 1 : 0);
    if ('bookCents' in patch) set('book_cents', patch.bookCents ?? null);
    if ('lulu' in patch) set('lulu', patch.lulu ? JSON.stringify(patch.lulu) : null);
    if ('quote' in patch) set('quote', patch.quote ? JSON.stringify(patch.quote) : null);
    if ('checkout' in patch) set('checkout', patch.checkout ? JSON.stringify(patch.checkout) : null);
    if ('payment' in patch) set('payment', patch.payment ? JSON.stringify(patch.payment) : null);
    if ('error' in patch) set('error', patch.error ?? null);
    if ('printFiles' in patch) set('print_files', patch.printFiles ? JSON.stringify(patch.printFiles) : null);
    if ('luluJob' in patch) {
      set('lulu_job', patch.luluJob ? JSON.stringify(patch.luluJob) : null);
      set('lulu_job_id', patch.luluJob?.id ?? null);
    }
    if ('refund' in patch) set('refund', patch.refund ? JSON.stringify(patch.refund) : null);
    set('updated_at', now.toISOString());
    this.db.prepare(`update orders set ${cols.join(', ')} where id = ?`).run(...vals, id);
  }

  /** Moves an order to `to` through the state machine and records the event, atomically. */
  move(id: string, to: OrderState, cause: string, opts: { detail?: string; now?: Date } = {}): OrderEvent {
    return this.transaction(() => {
      const row = this.db.prepare('select state from orders where id = ?').get(id) as { state: OrderState } | undefined;
      if (!row) throw new Error(`No order ${id}`);
      const event = transition(row.state, to, cause, opts);
      this.db.prepare('update orders set state = ?, updated_at = ? where id = ?').run(to, event.at, id);
      this.db.prepare('insert into order_events (order_id, from_state, to_state, cause, detail, at) values (?, ?, ?, ?, ?, ?)').run(id, event.from, event.to, event.cause, event.detail ?? null, event.at);
      return event;
    });
  }

  /**
   * Counts a new Checkout attempt for the order and returns its number. Called before Stripe is
   * asked, so a session that was created but never stored (a timeout, a restart) never shares its
   * idempotency key with the next attempt, whose parameters differ (D55).
   */
  nextCheckoutAttempt(id: string): number {
    const row = this.db.prepare('update orders set checkout_attempts = checkout_attempts + 1 where id = ? returning checkout_attempts').get(id) as { checkout_attempts: number } | undefined;
    if (!row) throw new Error(`No order ${id}`);
    return row.checkout_attempts;
  }

  /**
   * Records a Stripe event ID and runs `apply` in the same transaction, once per ID: a replayed
   * event returns `undefined` and changes nothing. `apply` returns a short, content-free outcome.
   */
  onceForStripeEvent(e: { id: string; type: string; orderId: string | null }, apply: () => string, now = new Date()): string | undefined {
    return this.transaction(() => {
      const inserted = this.db.prepare('insert or ignore into stripe_events (id, type, order_id, outcome, received_at) values (?, ?, ?, ?, ?)').run(e.id, e.type, e.orderId, 'processing', now.toISOString());
      if (inserted.changes === 0) return undefined;
      const outcome = apply();
      this.db.prepare('update stripe_events set outcome = ? where id = ?').run(outcome, e.id);
      return outcome;
    });
  }

  stripeEvents(orderId?: string): StripeEventRow[] {
    const rows = (orderId ? this.db.prepare('select * from stripe_events where order_id = ? order by rowid').all(orderId) : this.db.prepare('select * from stripe_events order by rowid').all()) as Row[];
    return rows.map((r) => ({ id: String(r['id']), type: String(r['type']), orderId: (r['order_id'] as string | null) ?? null, outcome: String(r['outcome']), receivedAt: String(r['received_at']) }));
  }

  events(id: string): OrderEvent[] {
    return (this.db.prepare('select from_state, to_state, cause, detail, at from order_events where order_id = ? order by id').all(id) as Row[]).map((r) => ({
      from: r['from_state'] as OrderState,
      to: r['to_state'] as OrderState,
      cause: String(r['cause']),
      at: String(r['at']),
      ...(r['detail'] ? { detail: String(r['detail']) } : {}),
    }));
  }

  /** The order a Lulu print job belongs to. */
  byLuluJob(luluJobId: number): Order | undefined {
    const row = this.db.prepare('select * from orders where lulu_job_id = ?').get(luluJobId) as Row | undefined;
    return row && toOrder(row);
  }

  /**
   * Queues a job. `once`: a job that ever existed for (order, kind, key) is left alone, so an email
   * goes out once. `restart`: it's queued again from scratch at `runAt` (a retry, a webhook asking
   * for a fresh look).
   */
  enqueueJob(orderId: string, kind: JobKind, opts: { key?: string; runAt?: Date; mode?: 'once' | 'restart'; now?: Date } = {}): void {
    const now = (opts.now ?? new Date()).toISOString();
    const runAt = (opts.runAt ?? opts.now ?? new Date()).toISOString();
    const conflict =
      opts.mode === 'restart' ? "do update set state = 'queued', run_at = excluded.run_at, attempts = 0, last_error = null, version = version + 1, updated_at = excluded.updated_at" : 'do nothing';
    this.db
      .prepare(`insert into jobs (order_id, kind, key, state, run_at, created_at, updated_at) values (?, ?, ?, 'queued', ?, ?, ?) on conflict (order_id, kind, key) ${conflict}`)
      .run(orderId, kind, opts.key ?? '', runAt, now, now);
  }

  /** Queued jobs due by `now`, oldest first. */
  dueJobs(now: Date, limit = 10): JobRow[] {
    return (this.db.prepare("select * from jobs where state = 'queued' and run_at <= ? order by run_at, id limit ?").all(now.toISOString(), limit) as Row[]).map(toJob);
  }

  /** When the next queued job is due, if any. */
  nextJobAt(): Date | undefined {
    const row = this.db.prepare("select min(run_at) as at from jobs where state = 'queued'").get() as { at: string | null };
    return row.at ? new Date(row.at) : undefined;
  }

  job(id: number): JobRow | undefined {
    const row = this.db.prepare('select * from jobs where id = ?').get(id) as Row | undefined;
    return row && toJob(row);
  }

  jobs(orderId: string): JobRow[] {
    return (this.db.prepare('select * from jobs where order_id = ? order by id').all(orderId) as Row[]).map(toJob);
  }

  /**
   * Records a run of `job`: done or dead (no more tries), or queued again at `runAt` (`failed` counts
   * an attempt). Does nothing if the job was queued again while it ran (its version moved on).
   */
  settleJob(job: Pick<JobRow, 'id' | 'version'>, result: { state: 'done' | 'dead'; error?: string } | { state: 'queued'; runAt: Date; error?: string; failed: boolean }, now = new Date()): boolean {
    const error = result.error?.slice(0, 500) ?? null;
    const res =
      result.state === 'queued'
        ? this.db
            .prepare('update jobs set run_at = ?, attempts = case when ? then attempts + 1 else 0 end, last_error = ?, updated_at = ? where id = ? and version = ?')
            .run(result.runAt.toISOString(), result.failed ? 1 : 0, error, now.toISOString(), job.id, job.version)
        : this.db
            .prepare('update jobs set state = ?, attempts = attempts + ?, last_error = ?, updated_at = ? where id = ? and version = ?')
            .run(result.state, result.state === 'dead' ? 1 : 0, error, now.toISOString(), job.id, job.version);
    return res.changes > 0;
  }

  /** Drafts the server was working on, e.g. when it restarted mid-render. */
  unfinished(): Order[] {
    return (this.db.prepare("select * from orders where state = 'draft' and stage not in ('awaiting upload') order by created_at").all() as Row[]).map(toOrder);
  }

  /** Orders last touched before `before`, for the storage sweep. */
  idleSince(before: Date): Order[] {
    return (this.db.prepare('select * from orders where updated_at < ? order by updated_at').all(before.toISOString()) as Row[]).map(toOrder);
  }
}

function toOrder(r: Row): Order {
  return {
    id: String(r['id']),
    tokenHash: String(r['token_hash']),
    state: r['state'] as OrderState,
    stage: (r['stage'] as string | null) ?? null,
    podPackageId: String(r['pod_package_id']),
    product: JSON.parse(String(r['product'])) as Product,
    uploads: JSON.parse(String(r['uploads'])) as ExpectedUpload[],
    pages: (r['pages'] as number | null) ?? null,
    coverApproximate: r['cover_approximate'] === null || r['cover_approximate'] === undefined ? null : r['cover_approximate'] === 1,
    bookCents: (r['book_cents'] as number | null) ?? null,
    lulu: r['lulu'] ? (JSON.parse(String(r['lulu'])) as LuluCheck) : null,
    quote: r['quote'] ? (JSON.parse(String(r['quote'])) as StoredQuote) : null,
    checkout: r['checkout'] ? (JSON.parse(String(r['checkout'])) as CheckoutRef) : null,
    payment: r['payment'] ? (JSON.parse(String(r['payment'])) as Payment) : null,
    error: (r['error'] as string | null) ?? null,
    printFiles: r['print_files'] ? (JSON.parse(String(r['print_files'])) as PrintFiles) : null,
    luluJob: r['lulu_job'] ? (JSON.parse(String(r['lulu_job'])) as LuluJobRef) : null,
    refund: r['refund'] ? (JSON.parse(String(r['refund'])) as Refund) : null,
    createdAt: String(r['created_at']),
    updatedAt: String(r['updated_at']),
  };
}

function toJob(r: Row): JobRow {
  return {
    id: Number(r['id']),
    orderId: String(r['order_id']),
    kind: r['kind'] as JobKind,
    key: String(r['key']),
    state: r['state'] as JobRow['state'],
    runAt: String(r['run_at']),
    attempts: Number(r['attempts']),
    lastError: (r['last_error'] as string | null) ?? null,
    version: Number(r['version']),
  };
}
