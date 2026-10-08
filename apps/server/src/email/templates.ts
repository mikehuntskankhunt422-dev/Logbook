import { productLabel } from '@logbook/core';
import type { Order } from '../orders/db.ts';

/**
 * The emails Logbook sends (PLAN §1.5 steps 8–9). Each names the order and product, never the
 * book's title or anything else from the journal (PLAN §6).
 *
 * - `problem` (customer): something went wrong after payment and a person is looking at it.
 * - `shipped` (customer): with the carrier's tracking links.
 * - `refunded` (customer): the payment went back in full.
 * - `alert` (you): an order needs attention, and why.
 */
export type Template = 'problem' | 'shipped' | 'refunded' | 'alert';
export const TEMPLATES: readonly Template[] = ['problem', 'shipped', 'refunded', 'alert'];

const money = (cents: number, currency: string) => `${currency.toUpperCase() === 'USD' ? 'US$' : `${currency.toUpperCase()} `}${(cents / 100).toFixed(2)}`;

function describe(o: Order): string {
  return `${productLabel(o.product)}${o.pages ? `, ${o.pages} pages` : ''}`;
}

export function renderEmail(template: Template, o: Order): { subject: string; text: string } {
  const ref = `Order ${o.id}: ${describe(o)}.`;
  switch (template) {
    case 'problem':
      return {
        subject: 'A problem with your Logbook order',
        text: [
          'Hello,',
          '',
          'Something went wrong while sending your book to the printer. A person is looking into it and will email you. You don’t need to do anything.',
          '',
          ref,
          '',
          'Logbook',
        ].join('\n'),
      };
    case 'shipped': {
      const t = o.luluJob?.tracking;
      const links = t?.urls.length ? t.urls.map((u) => `  ${u}`) : ['  (The carrier hasn’t given a tracking link for this delivery.)'];
      return {
        subject: 'Your Logbook book is on its way',
        text: [
          'Hello,',
          '',
          `Your book has been printed and handed to ${t?.carrier ? t.carrier : 'the carrier'}.`,
          ...(o.luluJob?.arrival?.max ? [`It should arrive by ${o.luluJob.arrival.max.slice(0, 10)}.`] : []),
          '',
          'Tracking:',
          ...links,
          '',
          ref,
          '',
          'Logbook',
        ].join('\n'),
      };
    }
    case 'refunded':
      return {
        subject: 'Your Logbook order has been refunded',
        text: [
          'Hello,',
          '',
          `We couldn’t print your book, so we’ve refunded your payment in full${o.refund ? ` (${money(o.refund.amount, o.refund.currency)})` : ''}. Your bank usually shows it within 5–10 working days.`,
          '',
          'Your journal is still on your device: you can prepare the book again from Logbook whenever you like.',
          '',
          ref,
          '',
          'Logbook',
        ].join('\n'),
      };
    case 'alert':
      return {
        subject: `Logbook: order ${o.id} needs attention`,
        text: [
          `Order ${o.id} is ${o.state.replace(/_/g, ' ')}.`,
          '',
          `Reason: ${o.error ?? '(none recorded)'}`,
          `Product: ${describe(o)}`,
          ...(o.luluJob ? [`Lulu print job: ${o.luluJob.id} (${o.luluJob.status})`] : []),
          ...(o.payment?.paymentIntent ? [`Stripe payment: ${o.payment.paymentIntent}`] : []),
          ...(o.refund ? [`Refund: ${o.refund.id} (${o.refund.status})`] : []),
        ].join('\n'),
      };
  }
}
