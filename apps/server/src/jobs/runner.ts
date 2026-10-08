import { redactUrls } from '../lulu/client.ts';
import type { JobRow, OrderDb } from '../orders/db.ts';

/** Trying again won't help (files gone, Lulu refused them): the job is dead at once. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/** A run's result: finished, or come back at `again` (tracking polls itself this way). */
export type JobResult = { done: true } | { again: Date };

/** Attempts before a job is dead: 1 + 2 + 4 + … + 60 minutes between them, about two hours (D68). */
export const MAX_ATTEMPTS = 8;

/** Wait before the next try, after `failures` failed runs: 1, 2, 4 … minutes, at most an hour. */
export function backoffMs(failures: number): number {
  return Math.min(60, 2 ** Math.max(0, failures - 1)) * 60_000;
}

export interface JobRunnerDeps {
  db: OrderDb;
  handle(job: JobRow): Promise<JobResult>;
  /** Called once when a job dies (out of attempts, or a `PermanentJobError`). */
  onDead(job: JobRow, err: unknown): Promise<void> | void;
  log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
  now?: () => Date;
}

/** Most jobs one wake-up runs, so a job that keeps asking to run "now" can't spin forever. */
const BATCH = 100;

/**
 * Runs due jobs from the `jobs` table, one at a time (one process, D13): fulfilment, tracking,
 * refunds and emails. A failed run is retried with backoff; the table survives restarts, so a job
 * queued in the same transaction as a payment is never lost.
 */
export class JobRunner {
  private running: Promise<void> | null = null;
  private scheduled = false;
  private again = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly now: () => Date;

  constructor(private readonly deps: JobRunnerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Looks for due jobs every `everyMs`, and now. */
  start(everyMs = 5_000): void {
    this.timer ??= setInterval(() => this.kick(), everyMs).unref();
    this.kick();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.idle();
  }

  /**
   * Runs due jobs soon: on the next turn of the event loop, so a caller inside a database
   * transaction has committed by then. If a run is under way, it looks again when it's done.
   */
  kick(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (this.running) {
        this.again = true;
        return;
      }
      this.running = this.drain().finally(() => (this.running = null));
    });
  }

  /** Resolves when no run is under way or about to start. */
  async idle(): Promise<void> {
    while (this.scheduled || this.running) {
      if (this.running) await this.running;
      else await new Promise((r) => setImmediate(r));
    }
  }

  private async drain(): Promise<void> {
    let ran = 0;
    do {
      this.again = false;
      for (let n = await this.runDue(); n > 0 && ran < BATCH; n = await this.runDue()) ran += n;
    } while (this.again && ran < BATCH);
  }

  /** Runs the jobs due now, once each; returns how many ran. */
  async runDue(): Promise<number> {
    const due = this.deps.db.dueJobs(this.now());
    for (const job of due) await this.runOne(job);
    return due.length;
  }

  private async runOne(job: JobRow): Promise<void> {
    const { db, log } = this.deps;
    try {
      const result = await this.deps.handle(job);
      db.settleJob(job, 'again' in result ? { state: 'queued', runAt: result.again, failed: false } : { state: 'done' }, this.now());
    } catch (err) {
      const message = redactUrls(err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300);
      const failures = job.attempts + 1;
      if (err instanceof PermanentJobError || failures >= MAX_ATTEMPTS) {
        log.error({ orderId: job.orderId, kind: job.kind, key: job.key, attempts: failures, err: message }, 'job dead');
        if (db.settleJob(job, { state: 'dead', error: message }, this.now())) {
          try {
            await this.deps.onDead(job, err);
          } catch (e) {
            log.error({ orderId: job.orderId, kind: job.kind, err: String(e).slice(0, 300) }, 'handling a dead job failed');
          }
        }
      } else {
        const runAt = new Date(this.now().getTime() + backoffMs(failures));
        log.warn({ orderId: job.orderId, kind: job.kind, key: job.key, attempts: failures, retryAt: runAt.toISOString(), err: message }, 'job failed, will retry');
        db.settleJob(job, { state: 'queued', runAt, error: message, failed: true }, this.now());
      }
    }
  }
}
