/**
 * The order state machine (PLAN §1.6). Every status change goes through `transition`, which refuses
 * anything not in the table; the caller stores the returned event as an `order_events` row.
 *
 *   draft → quoted → awaiting_payment → paid → files_generated → files_validated → submitted_to_lulu
 *         → in_production → shipped → delivered
 *   failed: before payment, nothing charged · needs_attention: after payment, a human is needed
 *   refunded: terminal
 */
export const ORDER_STATES = [
  'draft',
  'quoted',
  'awaiting_payment',
  'paid',
  'files_generated',
  'files_validated',
  'submitted_to_lulu',
  'in_production',
  'shipped',
  'delivered',
  'failed',
  'needs_attention',
  'refunded',
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/** Steps after payment that can go wrong and be retried from needs_attention. */
const RETRYABLE: OrderState[] = ['paid', 'files_generated', 'files_validated'];

export const TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  // Upload done → rendered, validated and priced; or the files couldn't be made (nothing charged).
  draft: ['quoted', 'failed'],
  // Checkout opened; a re-quote replaces the quote; or the order is abandoned before payment.
  quoted: ['awaiting_payment', 'quoted', 'failed'],
  // Paid; or the session expired or an async payment failed, so the customer can try again.
  awaiting_payment: ['paid', 'quoted'],
  paid: ['files_generated', 'needs_attention'],
  files_generated: ['files_validated', 'needs_attention'],
  files_validated: ['submitted_to_lulu', 'needs_attention'],
  // Lulu webhooks can be missed, so later statuses may arrive first; CANCELED or REJECTED → needs_attention.
  submitted_to_lulu: ['in_production', 'shipped', 'delivered', 'needs_attention'],
  in_production: ['shipped', 'delivered', 'needs_attention'],
  shipped: ['delivered'],
  delivered: [],
  failed: [],
  // Admin retry returns to the step that failed; otherwise refund.
  needs_attention: [...RETRYABLE, 'refunded'],
  refunded: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: OrderState,
    readonly to: OrderState,
  ) {
    super(`An order can't go from ${from} to ${to}.`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface OrderEvent {
  from: OrderState;
  to: OrderState;
  /** What caused it: `stripe:evt_…`, `lulu:webhook`, `admin:retry`, `job:render`, … */
  cause: string;
  at: string;
  /** Short, content-free detail (an error code, a Lulu status). Never journal content. */
  detail?: string;
}

/** Checks a status change and describes it for `order_events`; throws on anything not in the table. */
export function transition(from: OrderState, to: OrderState, cause: string, opts: { detail?: string; now?: Date } = {}): OrderEvent {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
  return { from, to, cause, at: (opts.now ?? new Date()).toISOString(), ...(opts.detail ? { detail: opts.detail } : {}) };
}

/** Lulu print-job statuses (ASSUMPTIONS L1) mapped to ours; `undefined` means no change. */
export function stateForLuluStatus(status: string): OrderState | undefined {
  switch (status) {
    case 'IN_PRODUCTION':
      return 'in_production';
    case 'SHIPPED':
      return 'shipped';
    case 'DELIVERED':
      return 'delivered';
    case 'CANCELED':
    case 'REJECTED':
      return 'needs_attention';
    // CREATED, UNPAID, PAYMENT_IN_PROGRESS, PRODUCTION_DELAYED, PRODUCTION_READY: still submitted.
    default:
      return undefined;
  }
}
