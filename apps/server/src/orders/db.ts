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
  /** Content-free reason for failed or needs_attention. */
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, string | number | null>;

const SCHEMA = `
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
`;

/**
 * Orders in SQLite through Node's built-in `node:sqlite` (D52). One file, one process (D13, D14).
 * Every state change goes through the machine and writes an `order_events` row in one transaction.
 */
export class OrderDb {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
    this.db.exec(SCHEMA);
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
  update(id: string, patch: Partial<Pick<Order, 'stage' | 'pages' | 'coverApproximate' | 'bookCents' | 'lulu' | 'error'>>, now = new Date()): void {
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
    if ('error' in patch) set('error', patch.error ?? null);
    set('updated_at', now.toISOString());
    this.db.prepare(`update orders set ${cols.join(', ')} where id = ?`).run(...vals, id);
  }

  /** Moves an order to `to` through the state machine and records the event, atomically. */
  move(id: string, to: OrderState, cause: string, opts: { detail?: string; now?: Date } = {}): OrderEvent {
    this.db.exec('begin immediate');
    try {
      const row = this.db.prepare('select state from orders where id = ?').get(id) as { state: OrderState } | undefined;
      if (!row) throw new Error(`No order ${id}`);
      const event = transition(row.state, to, cause, opts);
      this.db.prepare('update orders set state = ?, updated_at = ? where id = ?').run(to, event.at, id);
      this.db.prepare('insert into order_events (order_id, from_state, to_state, cause, detail, at) values (?, ?, ?, ?, ?, ?)').run(id, event.from, event.to, event.cause, event.detail ?? null, event.at);
      this.db.exec('commit');
      return event;
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
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
    error: (r['error'] as string | null) ?? null,
    createdAt: String(r['created_at']),
    updatedAt: String(r['updated_at']),
  };
}
