import { createHash } from 'node:crypto';
import { renderEmail, TEMPLATES, type Template } from '../email/templates.ts';
import type { Mailer } from '../email/mailer.ts';
import { PermanentJobError, type JobResult } from '../jobs/runner.ts';
import { LuluError, redactUrls, type LuluClient, type PrintJob } from '../lulu/client.ts';
import type { JobRow, LuluJobRef, Order, OrderDb } from '../orders/db.ts';
import { canTransition, stateForLuluStatus, type OrderState } from '../orders/machine.ts';
import { hashPrintFile, LULU_FETCH_TTL_S, printKey, validateWithLulu, validationProblem } from '../orders/service.ts';
import { StripeApiError, type StripeGateway } from '../payments/stripe.ts';
import type { ObjectStore } from '../storage/store.ts';
import { AddressError, luluAddress } from './address.ts';
import type { Fault } from './faults.ts';


/** The line-item title Lulu requires; the book's own title is journal content and stays out (PLAN §6). */
export const PRINT_JOB_TITLE = 'Logbook journal';

/** States in which an order has a Lulu job worth following. */
const TRACKED: OrderState[] = ['submitted_to_lulu', 'in_production', 'shipped'];
/** Lulu job states in which nothing will be printed, so a new job may be made. */
const DEAD_JOB = new Set(['CANCELED', 'REJECTED', 'ERROR']);
/** Lulu job states that can still be cancelled (the spec's transitions, M4 §1). */
const CANCELLABLE = new Set(['CREATED', 'UNPAID', 'PAYMENT_IN_PROGRESS', 'PRODUCTION_DELAYED', 'PRODUCTION_READY']);
/** Stop following a shipped book after this long: not every carrier reports delivery. */
const SHIPPED_FOLLOW_MS = 30 * 24 * 60 * 60 * 1000;
const MINUTE = 60_000;

/** Can't be fixed by trying again. `refund`: nothing a person can do either, so the money goes back. */
export class Unfixable extends Error {
  constructor(
    message: string,
    readonly refund: boolean,
  ) {
    super(message);
    this.name = 'Unfixable';
  }
}

export interface FulfilmentDeps {
  db: OrderDb;
  store: ObjectStore;
  lulu?: LuluClient;
  stripe?: StripeGateway;
  mailer: Mailer;
  /** Lulu's `contact_email` for questions about a job. */
  contactEmail: string;
  /** Where alerts go; without it they're only logged. */
  ownerEmail?: string;
  faults?: ReadonlySet<Fault>;
  /** Longest wait between two looks at a Lulu job (6 hours, PLAN §1.5 step 8). */
  trackEveryMs?: number;
  /** Wakes the job runner. */
  kick?: () => void;
  log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
  now?: () => Date;
}

/** What Lulu's job says, kept on the order (content-free). Signed links in Lulu's messages are cut short. */
export function luluJobRef(job: PrintJob, at: Date, submittedAt: string): LuluJobRef {
  const li = job.line_items[0];
  const urls = (li?.tracking_urls ?? []).filter((u) => /^https?:\/\//.test(u));
  return {
    id: job.id,
    status: job.status.name,
    message: job.status.message ? redactUrls(job.status.message).slice(0, 300) : null,
    changedAt: job.status.changed ?? null,
    lineItemStatus: li?.status.name ?? null,
    tracking: li && (li.tracking_id || urls.length || li.carrier_name) ? { id: li.tracking_id || null, urls, carrier: li.carrier_name ?? null } : null,
    arrival: job.estimated_shipping_dates ? { min: job.estimated_shipping_dates.arrival_min ?? null, max: job.estimated_shipping_dates.arrival_max ?? null } : null,
    submittedAt,
    checkedAt: at.toISOString(),
  };
}

/** Lulu's reason for refusing a line item, without the signed links it quotes. */
function rejection(job: PrintJob): string {
  const messages = job.line_items.map((li) => JSON.stringify(li.status.messages ?? {})).join(' ');
  return redactUrls(messages.replace(/[{}[\]"]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 300);
}

/**
 * Everything after payment (PLAN §1.5 steps 7–9), as jobs run by `JobRunner`:
 *
 * - `fulfil`: paid → files_generated (the approved files, by hash) → files_validated (Lulu checks
 *   them again) → submitted_to_lulu (the print job, made once, D67).
 * - `track`: reads the Lulu job and moves the order; polls itself, and webhooks wake it (D69).
 * - `refund`: a full Stripe refund for a book that can't be printed.
 * - `email`: one email per (order, template).
 */
export class Fulfilment {
  private readonly now: () => Date;
  private readonly faults: ReadonlySet<Fault>;

  constructor(private readonly deps: FulfilmentDeps) {
    this.now = deps.now ?? (() => new Date());
    this.faults = deps.faults ?? new Set();
  }

  handle = async (job: JobRow): Promise<JobResult> => {
    switch (job.kind) {
      case 'fulfil':
        return this.fulfil(job.orderId);
      case 'track':
        return this.track(job.orderId);
      case 'refund':
        return this.refund(job.orderId);
      case 'email':
        return this.email(job.orderId, job.key);
    }
  };

  /** A job ran out of tries (or can never succeed). */
  onDead = (job: JobRow, err: unknown): void => {
    const short = err instanceof Error ? err.message : String(err);
    if (job.kind === 'fulfil') this.needsAttention(job.orderId, `Sending the book to the printer failed: ${short}`, { refund: false, cause: 'job:fulfil', detail: 'retries exhausted' });
    else if (job.kind === 'refund') {
      const o = this.deps.db.get(job.orderId);
      this.deps.db.transaction(() => {
        this.deps.db.update(job.orderId, { error: `The automatic refund failed: ${short}`.slice(0, 400) }, this.now());
        if (o) this.alert(o.id);
      });
      this.deps.kick?.();
    }
  };

  /** A verified Lulu webhook (D69): look at the job again now. Returns what happened, for the log. */
  onWebhook(luluJobId: number, externalId: string | null | undefined): string {
    const order = this.deps.db.byLuluJob(luluJobId) ?? (externalId ? this.deps.db.get(externalId) : undefined);
    if (!order || order.luluJob?.id !== luluJobId) return 'unknown job';
    if (!TRACKED.includes(order.state)) return 'not tracked';
    this.deps.db.enqueueJob(order.id, 'track', { mode: 'restart', now: this.now() });
    this.deps.kick?.();
    return 'queued';
  }

  private fault(f: Fault): boolean {
    return this.faults.has(f);
  }

  // ── fulfil ────────────────────────────────────────────────────────────────

  private async fulfil(id: string): Promise<JobResult> {
    try {
      let o = this.deps.db.get(id);
      if (o?.state === 'paid') o = await this.confirmFiles(o);
      if (o?.state === 'files_generated') o = await this.revalidate(o);
      if (o?.state === 'files_validated') await this.submit(o);
    } catch (err) {
      if (err instanceof Unfixable) {
        this.needsAttention(id, err.message, { refund: err.refund, cause: 'job:fulfil', detail: err.refund ? 'refund' : 'person' });
        return { done: true };
      }
      throw err;
    }
    return { done: true };
  }

  private move(o: Order, to: OrderState, cause: string, detail?: string): Order {
    this.deps.db.move(o.id, to, cause, { detail, now: this.now() });
    return this.deps.db.get(o.id)!;
  }

  /** paid → files_generated: the files in storage are the ones rendered for the proof (PLAN §1.5 step 7). */
  private async confirmFiles(o: Order): Promise<Order> {
    const [interior, cover] = this.fault('files-missing')
      ? [null, null]
      : await Promise.all([this.deps.store.get(printKey(o.id, 'interior')), this.deps.store.get(printKey(o.id, 'cover'))]);
    if (!interior || !cover) throw new Unfixable('The print files were deleted before the book could be printed.', true);
    const found = { interior: hashPrintFile(interior), cover: hashPrintFile(cover) };
    if (o.printFiles) {
      if (found.interior.sha256 !== o.printFiles.interior.sha256 || found.cover.sha256 !== o.printFiles.cover.sha256) {
        throw new Unfixable('The print files are not the ones the customer approved.', true);
      }
    } else {
      // Rendered before hashes were recorded (M4 migration): these are the files the proof showed.
      this.deps.db.update(o.id, { printFiles: { ...found, at: o.createdAt } }, this.now());
    }
    return this.move(o, 'files_generated', 'job:fulfil', 'checksums match');
  }

  private luluOrThrow(): LuluClient {
    if (!this.deps.lulu) throw new Unfixable('Lulu is not configured on this server.', false);
    if (!this.deps.store.reachableFromInternet) throw new Unfixable('The print files are in local storage, which Lulu cannot reach.', false);
    if (this.fault('lulu-down')) throw new LuluError('Lulu is unreachable (LOGBOOK_FAULTS=lulu-down)', 503, null);
    return this.deps.lulu;
  }

  /** files_generated → files_validated: Lulu checks the files again (D10); a refusal now is final. */
  private async revalidate(o: Order): Promise<Order> {
    const lulu = this.luluOrThrow();
    if (!o.pages) throw new Unfixable('The order has no page count.', false);
    const check = await validateWithLulu(lulu, this.deps.store, o.id, o.podPackageId, o.pages);
    this.deps.db.update(o.id, { lulu: check }, this.now());
    const problem = validationProblem(check, o.pages);
    // Lulu couldn't download a file we just found in storage: a hiccup, not a bad file; try again.
    const fetchFailed = [...(check.interior.errors ?? []), ...(check.cover.errors ?? [])].some((e) => /failed to fetch/i.test(e));
    if (problem && fetchFailed) throw new Error(redactUrls(problem));
    if (problem) throw new Unfixable(problem, true);
    return this.move(o, 'files_validated', 'job:fulfil', `lulu ${check.interior.id}/${check.cover.id}`);
  }

  /** files_validated → submitted_to_lulu: finds the order's print job, or creates it (D66, D67). */
  private async submit(o: Order): Promise<void> {
    const lulu = this.luluOrThrow();
    const p = o.payment;
    if (!p) throw new Unfixable('The order has no payment details.', false);
    if (!p.shippingLevel) throw new Unfixable('The payment has no shipping level.', false);
    if (!o.printFiles) throw new Unfixable('The order has no print-file hashes.', false);
    let address;
    try {
      address = luluAddress(p);
    } catch (err) {
      if (err instanceof AddressError) throw new Unfixable(err.message, false);
      throw err;
    }

    // A job made by an earlier run whose answer was lost is adopted, not made twice.
    let job = (await lulu.findPrintJobs(o.id)).find((j) => !DEAD_JOB.has(j.status.name));
    if (!job) {
      const wrong = this.fault('lulu-reject') ? '0'.repeat(32) : undefined;
      try {
        job = await lulu.createPrintJob({
          externalId: o.id,
          title: PRINT_JOB_TITLE,
          podPackageId: o.podPackageId,
          interior: { url: await this.deps.store.signGet(printKey(o.id, 'interior'), LULU_FETCH_TTL_S), md5: wrong ?? o.printFiles.interior.md5 },
          cover: { url: await this.deps.store.signGet(printKey(o.id, 'cover'), LULU_FETCH_TTL_S), md5: o.printFiles.cover.md5 },
          shippingLevel: p.shippingLevel,
          address,
          contactEmail: this.deps.contactEmail,
        });
      } catch (err) {
        // A 400 is Lulu refusing the request (usually the address): a person has to look.
        if (err instanceof LuluError && err.status === 400) throw new Unfixable(`Lulu refused the print job: ${redactUrls(JSON.stringify(err.detail)).slice(0, 300)}`, false);
        throw err;
      }
      const status = job.status.name;
      this.deps.log.info({ orderId: o.id, luluJob: job.id, status }, 'Lulu print job created');
    } else {
      const status = job.status.name;
      this.deps.log.warn({ orderId: o.id, luluJob: job.id, status }, 'Lulu print job already existed; adopted');
    }
    const now = this.now();
    this.deps.db.transaction(() => {
      this.deps.db.update(o.id, { luluJob: luluJobRef(job, now, now.toISOString()), error: null }, now);
      this.deps.db.move(o.id, 'submitted_to_lulu', 'job:fulfil', { detail: `lulu ${job.id}`, now });
      this.deps.db.enqueueJob(o.id, 'track', { mode: 'restart', runAt: new Date(now.getTime() + 2 * MINUTE), now });
    });
    // Lulu may already be further along (an adopted job).
    this.apply(o.id, job, 'job:fulfil');
  }

  // ── track ─────────────────────────────────────────────────────────────────

  /** How long until the next look: often while Lulu checks the files, then every few hours. */
  private nextLook(o: Order): Date {
    const now = this.now().getTime();
    const age = now - Date.parse(o.luluJob?.submittedAt ?? o.updatedAt);
    const delay = age < 15 * MINUTE ? 2 * MINUTE : age < 2 * 60 * MINUTE ? 15 * MINUTE : (this.deps.trackEveryMs ?? 6 * 60 * MINUTE);
    return new Date(now + Math.min(delay, this.deps.trackEveryMs ?? delay));
  }

  private async track(id: string): Promise<JobResult> {
    const o = this.deps.db.get(id);
    if (!o?.luluJob || !TRACKED.includes(o.state) || !this.deps.lulu) return { done: true };
    let job: PrintJob;
    try {
      job = await this.deps.lulu.getPrintJob(o.luluJob.id);
    } catch (err) {
      // Tracking never gives up because Lulu was briefly unreachable: it just looks again later.
      this.deps.log.warn({ orderId: id, luluJob: o.luluJob.id, err: String(err).slice(0, 200) }, 'Lulu job read failed');
      return { again: this.nextLook(o) };
    }
    this.apply(id, job, 'lulu:poll');
    const after = this.deps.db.get(id)!;
    if (!TRACKED.includes(after.state)) return { done: true };
    if (after.state === 'shipped') {
      const shipped = this.deps.db.events(id).findLast((e) => e.to === 'shipped');
      if (shipped && this.now().getTime() - Date.parse(shipped.at) > SHIPPED_FOLLOW_MS) return { done: true };
    }
    return { again: this.nextLook(after) };
  }

  /**
   * Brings the order in line with Lulu's job (PLAN §1.5 step 8): records it, and moves the order
   * when Lulu's status maps to a later state. REJECTED is refunded; CANCELED and ERROR need a person.
   */
  apply(id: string, job: PrintJob, cause: string): void {
    const now = this.now();
    this.deps.db.transaction(() => {
      const o = this.deps.db.get(id);
      if (!o || o.luluJob?.id !== job.id) return;
      this.deps.db.update(id, { luluJob: luluJobRef(job, now, o.luluJob.submittedAt) }, now);
      const target = stateForLuluStatus(job.status.name);
      if (!target || target === o.state || !canTransition(o.state, target)) return;
      if (target === 'needs_attention') {
        const s = job.status.name;
        const reason = s === 'REJECTED' ? `Lulu rejected the print job: ${rejection(job)}` : s === 'CANCELED' ? 'Lulu cancelled the print job.' : 'Lulu reported an error while printing.';
        this.needsAttentionInTx(o, reason, { refund: s === 'REJECTED', cause, detail: s });
        return;
      }
      this.deps.db.move(id, target, cause, { detail: job.status.name, now });
      if (target === 'shipped') this.deps.db.enqueueJob(id, 'email', { key: 'shipped', mode: 'once', now });
      this.deps.log.info({ orderId: id, luluJob: job.id, state: target }, 'order moved by Lulu');
    });
    this.deps.kick?.();
  }

  // ── failures and refunds ──────────────────────────────────────────────────

  private needsAttention(id: string, reason: string, opts: { refund: boolean; cause: string; detail: string }): void {
    this.deps.db.transaction(() => {
      const o = this.deps.db.get(id);
      if (o) this.needsAttentionInTx(o, reason, opts);
    });
    this.deps.kick?.();
  }

  /**
   * Moves the order to needs_attention (PLAN §1.5 step 9) with a content-free reason, alerts you,
   * and either queues the refund (which emails the customer when done) or tells the customer a
   * person is on it.
   */
  private needsAttentionInTx(o: Order, reason: string, opts: { refund: boolean; cause: string; detail: string }): void {
    const now = this.now();
    if (o.state !== 'needs_attention') {
      if (!canTransition(o.state, 'needs_attention')) return;
      this.deps.db.move(o.id, 'needs_attention', opts.cause, { detail: opts.detail, now });
    }
    this.deps.db.update(o.id, { error: reason.slice(0, 400) }, now);
    if (opts.refund) this.deps.db.enqueueJob(o.id, 'refund', { mode: 'restart', now });
    else this.deps.db.enqueueJob(o.id, 'email', { key: 'problem', mode: 'once', now });
    this.alert(o.id);
    this.deps.log.warn({ orderId: o.id, refund: opts.refund, reason: reason.slice(0, 200) }, 'order needs attention');
  }

  /** An alert to you; each call is a new incident, so a new email. */
  private alert(id: string): void {
    const sent = this.deps.db.jobs(id).filter((j) => j.kind === 'email' && j.key.startsWith('alert:')).length;
    this.deps.db.enqueueJob(id, 'email', { key: `alert:${sent + 1}`, mode: 'once', now: this.now() });
  }

  /**
   * A full refund (PLAN §1.5 step 9). First makes sure Lulu won't print the book: a job that can
   * still be cancelled is cancelled; one already in production stops the refund for a person.
   */
  private async refund(id: string): Promise<JobResult> {
    const o = this.deps.db.get(id);
    if (!o || o.state === 'refunded' || o.refund) return { done: true };
    if (o.state !== 'needs_attention') {
      this.deps.log.warn({ orderId: id, state: o.state }, 'refund skipped: order does not need attention');
      return { done: true };
    }
    const stripe = this.deps.stripe;
    const intent = o.payment?.paymentIntent;
    if (!stripe) throw new PermanentJobError('Stripe is not configured on this server.');
    if (!intent) throw new PermanentJobError('The order has no Stripe payment to refund.');
    if (o.luluJob && this.deps.lulu) {
      const job = await this.deps.lulu.getPrintJob(o.luluJob.id);
      if (CANCELLABLE.has(job.status.name)) await this.deps.lulu.cancelPrintJob(job.id);
      else if (!DEAD_JOB.has(job.status.name)) throw new PermanentJobError(`Lulu's job ${job.id} is ${job.status.name}; refund by hand if it shouldn't be printed.`);
    }
    let r;
    try {
      r = await stripe.refund(intent, `refund:${o.id}`, { order_id: o.id });
    } catch (err) {
      if (err instanceof StripeApiError && err.code === 'charge_already_refunded') throw new PermanentJobError('Stripe says this payment was already refunded (by hand?). Check the dashboard.');
      throw err;
    }
    const now = this.now();
    this.deps.db.transaction(() => {
      this.deps.db.update(id, { refund: { id: r.id, amount: r.amount, currency: r.currency, status: r.status ?? 'unknown', at: now.toISOString() } }, now);
      this.deps.db.move(id, 'refunded', 'job:refund', { detail: r.id, now });
      this.deps.db.enqueueJob(id, 'email', { key: 'refunded', mode: 'once', now });
    });
    this.deps.log.info({ orderId: id, refund: r.id, amount: r.amount, status: r.status }, 'order refunded');
    this.deps.kick?.();
    return { done: true };
  }

  // ── email ─────────────────────────────────────────────────────────────────

  private async email(id: string, key: string): Promise<JobResult> {
    const template = key.split(':')[0] as Template;
    const o = this.deps.db.get(id);
    if (!o || !TEMPLATES.includes(template)) return { done: true };
    const to = template === 'alert' ? this.deps.ownerEmail : o.payment?.email;
    if (!to) {
      this.deps.log.warn({ orderId: id, template }, 'email not sent: no recipient');
      return { done: true };
    }
    if (!this.deps.mailer.enabled) {
      this.deps.log.info({ orderId: id, template }, 'email not sent: no RESEND_API_KEY');
      return { done: true };
    }
    if (template !== 'alert' && !this.deps.mailer.reachesCustomers) {
      this.deps.log.info({ orderId: id, template }, "email not sent: EMAIL_FROM is Resend's test sender, which reaches only OWNER_EMAIL");
      return { done: true };
    }
    const { subject, text } = renderEmail(template, o);
    // The key is per order and email, hashed so the provider never sees our order IDs in it.
    const idempotencyKey = createHash('sha256').update(`email:${id}:${key}`).digest('hex').slice(0, 48);
    const sent = await this.deps.mailer.send({ to, subject, text, idempotencyKey, tag: template });
    this.deps.log.info({ orderId: id, template, emailId: sent.id }, 'email sent');
    return { done: true };
  }
}
