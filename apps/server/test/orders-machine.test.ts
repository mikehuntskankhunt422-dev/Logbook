import { describe, expect, it } from 'vitest';
import { canTransition, IllegalTransitionError, ORDER_STATES, stateForLuluStatus, transition, type OrderState } from '../src/orders/machine.ts';

/** Every legal edge, written out independently of the table so a change to either is caught. */
const LEGAL: [OrderState, OrderState][] = [
  ['draft', 'quoted'],
  ['draft', 'failed'],
  ['quoted', 'awaiting_payment'],
  ['quoted', 'quoted'],
  ['quoted', 'failed'],
  ['awaiting_payment', 'paid'],
  ['awaiting_payment', 'quoted'],
  ['paid', 'files_generated'],
  ['paid', 'needs_attention'],
  ['files_generated', 'files_validated'],
  ['files_generated', 'needs_attention'],
  ['files_validated', 'submitted_to_lulu'],
  ['files_validated', 'needs_attention'],
  ['submitted_to_lulu', 'in_production'],
  ['submitted_to_lulu', 'shipped'],
  ['submitted_to_lulu', 'delivered'],
  ['submitted_to_lulu', 'needs_attention'],
  ['in_production', 'shipped'],
  ['in_production', 'delivered'],
  ['in_production', 'needs_attention'],
  ['shipped', 'delivered'],
  ['needs_attention', 'paid'],
  ['needs_attention', 'files_generated'],
  ['needs_attention', 'files_validated'],
  ['needs_attention', 'refunded'],
];

describe('order state machine (PLAN §1.6)', () => {
  it('allows exactly the legal edges, for every pair of states', () => {
    const legal = new Set(LEGAL.map(([a, b]) => `${a}→${b}`));
    for (const from of ORDER_STATES)
      for (const to of ORDER_STATES) {
        const edge = `${from}→${to}`;
        expect(canTransition(from, to), edge).toBe(legal.has(edge));
        if (legal.has(edge)) expect(transition(from, to, 'test').to, edge).toBe(to);
        else expect(() => transition(from, to, 'test'), edge).toThrow(IllegalTransitionError);
      }
  });

  it('follows the happy path from draft to delivered', () => {
    const path: OrderState[] = ['draft', 'quoted', 'awaiting_payment', 'paid', 'files_generated', 'files_validated', 'submitted_to_lulu', 'in_production', 'shipped', 'delivered'];
    for (let i = 1; i < path.length; i++) expect(() => transition(path[i - 1]!, path[i]!, 'test')).not.toThrow();
  });

  it('never moves money states backwards: nothing paid returns to before payment, and terminal states stay put', () => {
    const afterPayment: OrderState[] = ['paid', 'files_generated', 'files_validated', 'submitted_to_lulu', 'in_production', 'shipped', 'delivered', 'needs_attention', 'refunded'];
    for (const from of afterPayment) for (const to of ['draft', 'quoted', 'awaiting_payment', 'failed'] as const) expect(canTransition(from, to), `${from}→${to}`).toBe(false);
    for (const from of ['delivered', 'failed', 'refunded'] as const) expect(ORDER_STATES.filter((to) => canTransition(from, to))).toEqual([]);
    // Refunds only come through a human (needs_attention), never straight from a paid state.
    expect(ORDER_STATES.filter((s) => canTransition(s, 'refunded'))).toEqual(['needs_attention']);
  });

  it('describes each change for order_events, with a cause and an optional content-free detail', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    expect(transition('awaiting_payment', 'paid', 'stripe:evt_123', { now })).toEqual({ from: 'awaiting_payment', to: 'paid', cause: 'stripe:evt_123', at: '2026-10-07T12:00:00.000Z' });
    expect(transition('submitted_to_lulu', 'needs_attention', 'lulu:webhook', { now, detail: 'REJECTED' }).detail).toBe('REJECTED');
    expect(() => transition('quoted', 'paid', 'stripe:evt_1')).toThrow("An order can't go from quoted to paid.");
  });

  it('maps Lulu print-job statuses', () => {
    expect(['CREATED', 'UNPAID', 'PAYMENT_IN_PROGRESS', 'PRODUCTION_DELAYED', 'PRODUCTION_READY'].map(stateForLuluStatus)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(['IN_PRODUCTION', 'SHIPPED', 'DELIVERED', 'CANCELED', 'REJECTED'].map(stateForLuluStatus)).toEqual(['in_production', 'shipped', 'delivered', 'needs_attention', 'needs_attention']);
    // Each mapped status is reachable from submitted_to_lulu.
    for (const s of ['IN_PRODUCTION', 'SHIPPED', 'DELIVERED', 'REJECTED']) expect(canTransition('submitted_to_lulu', stateForLuluStatus(s)!)).toBe(true);
  });
});
