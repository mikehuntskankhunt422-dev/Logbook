import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { productLabel, SHIP_COUNTRIES, type BookOrderRef } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { href } from '../app/router.ts';
import { ApiError, checkoutOrder, getOrder, quoteOrder, type OrderView, type ShippingChoice } from '../lib/api.ts';
import { formatUsd } from '../lib/money.ts';

const ProofViewer = lazy(() => import('./ProofViewer.tsx').then((m) => ({ default: m.ProofViewer })));

const PREPARING: Record<string, string> = {
  'awaiting upload': 'Waiting for the upload to finish…',
  queued: 'Waiting for the print service…',
  checking: 'Checking that everything arrived intact…',
  rendering: 'Laying out and printing your pages…',
  validating: 'The printer is checking the files…',
  pricing: 'Pricing your book…',
};
const PAID_STATES = ['paid', 'files_generated', 'files_validated', 'submitted_to_lulu', 'in_production', 'shipped', 'delivered'];
/** After coming back from Stripe, how long to keep asking whether the payment has been confirmed. */
const CONFIRM_POLLS = 40;

const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');

/** Countries Checkout can ship to, by name in the reader's language. */
function useCountries(): { code: string; name: string }[] {
  return useMemo(() => {
    const names = new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' });
    return SHIP_COUNTRIES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));
  }, []);
}

/** The reader's country from their browser language (en-AU → AU), if Checkout ships there. */
function guessCountry(): string {
  const region = /[-_]([A-Z]{2})\b/.exec(navigator.language)?.[1];
  return region && SHIP_COUNTRIES.includes(region) ? region : '';
}

function days(s: ShippingChoice): string {
  if (s.daysMin && s.daysMax) return s.daysMin === s.daysMax ? `${s.daysMin} business days` : `${s.daysMin}–${s.daysMax} business days`;
  return '';
}

/**
 * One print order (PLAN §1.5 steps 4–6): the proof, where it goes and what it costs, the required
 * check, then Stripe's payment page. Stripe sends the customer back here, paid or not.
 */
export function OrderPage({ id, cancelled }: { id: string; cancelled: boolean }) {
  const { journal } = useJournal();
  const [ref, setRef] = useState<BookOrderRef | null | undefined>(undefined);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void journal.getBookOrder(id).then((r) => alive && setRef(r ?? null));
    return () => {
      alive = false;
    };
  }, [journal, id]);

  useEffect(() => {
    if (!ref) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const load = async () => {
      try {
        const view = await getOrder(ref.id, ref.token);
        if (!alive) return;
        setOrder(view);
        setLoadError(null);
        // Keep asking while the print files are being made, or while a payment is being confirmed.
        const confirming = view.state === 'awaiting_payment' && !cancelled && polls++ < CONFIRM_POLLS;
        if (view.state === 'draft' || confirming) timer = setTimeout(() => void load(), view.state === 'draft' ? 1500 : 3000);
      } catch (err) {
        if (alive) setLoadError(message(err));
      }
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ref, cancelled]);

  return (
    <div className="order-page">
      <p>
        <a href={href({ name: 'book' })}>← Back to your book</a>
      </p>
      <h1>Your book order</h1>
      {ref === undefined && <p className="muted">Opening your order…</p>}
      {ref === null && (
        <p className="notice">This order isn't saved in this browser. Orders can be opened only from the browser that prepared them.</p>
      )}
      {loadError && (
        <p className="notice notice-warn" role="alert">
          {loadError}
        </p>
      )}
      {ref && order && <OrderBody order={order} orderRef={ref} cancelled={cancelled} onChange={setOrder} />}
    </div>
  );
}

function OrderBody({ order, orderRef, cancelled, onChange }: { order: OrderView; orderRef: BookOrderRef; cancelled: boolean; onChange: (o: OrderView) => void }) {
  if (order.state === 'draft') {
    return (
      <p className="hint" role="status" aria-live="polite">
        {PREPARING[order.stage ?? ''] ?? 'Making your print files…'}
      </p>
    );
  }
  if (order.state === 'failed') {
    return (
      <p className="notice notice-warn" role="alert">
        {order.error ?? 'The print files could not be made.'} Nothing was charged. Go back to your book to try again.
      </p>
    );
  }
  if (PAID_STATES.includes(order.state)) return <Paid order={order} />;
  if (order.state === 'needs_attention') return <p className="notice notice-warn">Something went wrong after your payment. We've been told and will sort it out with you by email.</p>;
  if (order.state === 'refunded') return <p className="notice">This order was cancelled and your payment refunded.</p>;
  return <ProofAndPay order={order} orderRef={orderRef} cancelled={cancelled} onChange={onChange} />;
}

function Proof({ order }: { order: OrderView }) {
  const lulu = order.lulu;
  return (
    <section aria-labelledby="proof-h">
      <h2 id="proof-h">1. Check your proof</h2>
      <p>
        <strong>{order.pages} pages</strong>, {productLabel(order.product)}. These are the exact files the printer will use.
      </p>
      {order.proof ? (
        <ul className="row proof-links">
          <li>
            <a className="btn btn-small" href={order.proof.interior} target="_blank" rel="noopener">
              Open the pages (PDF)
            </a>
          </li>
          <li>
            <a className="btn btn-small" href={order.proof.cover} target="_blank" rel="noopener">
              Open the cover (PDF)
            </a>
          </li>
        </ul>
      ) : (
        <p className="notice">The print files have been deleted (they're kept for 7 days). Prepare the book again to order it.</p>
      )}
      {order.proof && (
        <Suspense fallback={<p className="hint">Opening the proof…</p>}>
          <ProofViewer orderId={order.id} interior={order.proof.interior} cover={order.proof.cover} />
        </Suspense>
      )}
      <p className="hint">
        {lulu?.checked ? 'The printer has checked both files and accepted them.' : `Not checked by the printer yet (${lulu?.reason ?? 'unknown'}).`}
        {order.coverApproximate && ' The cover uses an approximate spine width.'}
      </p>
    </section>
  );
}

function ProofAndPay({ order, orderRef, cancelled, onChange }: { order: OrderView; orderRef: BookOrderRef; cancelled: boolean; onChange: (o: OrderView) => void }) {
  const countries = useCountries();
  const [country, setCountry] = useState(order.quote?.country ?? guessCountry());
  // Follow the order's quote when it changes underneath this page (e.g. re-read after a return from Stripe).
  const [quotedCountry, setQuotedCountry] = useState(order.quote?.country);
  if (order.quote?.country !== quotedCountry) {
    setQuotedCountry(order.quote?.country);
    if (order.quote) setCountry(order.quote.country);
  }
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<'quote' | 'pay' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const price = async (code: string) => {
    if (!code) return;
    setBusy('quote');
    setProblem(null);
    try {
      onChange(await quoteOrder(orderRef.id, orderRef.token, code));
    } catch (err) {
      setProblem(message(err));
    } finally {
      setBusy(null);
    }
  };

  // Price the guessed country straight away, so the page opens with real numbers.
  useEffect(() => {
    if (!order.quote && country) void price(country);
    // Only on first show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pay = async () => {
    if (!order.quote) return;
    setBusy('pay');
    setProblem(null);
    try {
      const { url } = await checkoutOrder(orderRef.id, orderRef.token, { quoteVersion: order.quote.version, returnUrl: `${location.origin}${location.pathname}`, checked });
      location.assign(url);
    } catch (err) {
      setBusy(null);
      setProblem(message(err));
      // The price may have moved (409): show the current one.
      if (err instanceof ApiError && err.status === 409) onChange(await getOrder(orderRef.id, orderRef.token).catch(() => order));
    }
  };

  const quote = order.quote?.country === country ? order.quote : null;
  const cheapest = quote?.shipping.reduce((m, s) => Math.min(m, s.priceCents), Number.POSITIVE_INFINITY);
  const duties = quote?.shipping.some((s) => /\bDDU\b/i.test(s.name));
  const waiting = order.state === 'awaiting_payment';

  return (
    <>
      {waiting && (
        <p className="notice" role="status">
          {cancelled
            ? 'You left the payment page, so nothing was charged. You can pay whenever you’re ready.'
            : 'Waiting for Stripe to confirm your payment… If you haven’t paid yet, continue to payment below.'}
        </p>
      )}
      <Proof order={order} />

      <section aria-labelledby="ship-h">
        <h2 id="ship-h">2. Where should it go?</h2>
        <div className="field">
          <label htmlFor="ship-country">Country</label>
          <select
            id="ship-country"
            value={country}
            disabled={busy !== null}
            onChange={(e) => {
              setCountry(e.target.value);
              void price(e.target.value);
            }}
          >
            <option value="">Choose a country…</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <p className="hint" role="status" aria-live="polite">
          {busy === 'quote' && 'Asking the printer for prices…'}
        </p>
        {quote && (
          <div className="order-price">
            <dl>
              <dt>Book</dt>
              <dd>{formatUsd(quote.bookCents)}</dd>
              <dt>Shipping</dt>
              <dd>
                <ul className="shipping-choices">
                  {quote.shipping.map((s) => (
                    <li key={s.level}>
                      {s.name}
                      {days(s) && <span className="muted"> · {days(s)}</span>} · {formatUsd(s.priceCents)}
                    </li>
                  ))}
                </ul>
                <span className="hint">You choose one on the payment page.</span>
              </dd>
              <dt>Tax</dt>
              <dd className="hint">Any tax is worked out from your address on the payment page, before you pay.</dd>
            </dl>
            <p className="order-total">
              Total from <strong>{formatUsd(quote.bookCents + (cheapest ?? 0))}</strong>
            </p>
            {duties && <p className="notice">Import duties and taxes aren't included for this destination and may be collected on delivery.</p>}
          </div>
        )}
      </section>

      <section aria-labelledby="pay-h">
        <h2 id="pay-h">3. Pay</h2>
        <p className="hint">
          Please make sure you have the right to print everything in this book: the words, the photos and anything you've copied in. The printer may refuse a book whose content is unlawful.
        </p>
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          I've checked the pages and the cover, and I'm happy for them to be printed as they are.
        </label>
        {problem && (
          <p className="notice notice-warn" role="alert">
            {problem}
          </p>
        )}
        <p>
          <button type="button" className="btn btn-primary" disabled={!quote || !checked || busy !== null || !order.proof} onClick={() => void pay()}>
            {busy === 'pay' ? 'Opening the payment page…' : 'Continue to payment'}
          </button>
        </p>
        <p className="hint">Payment is taken by Stripe on its own page. Logbook never sees your card.</p>
      </section>
    </>
  );
}

function Paid({ order }: { order: OrderView }) {
  const paid = order.paid;
  return (
    <section aria-labelledby="paid-h">
      <h2 id="paid-h">Thank you, it's paid</h2>
      {paid && (
        <p>
          You paid <strong>{formatUsd(paid.amountTotalCents)}</strong>
          {paid.amountShippingCents > 0 && `, including ${formatUsd(paid.amountShippingCents)} shipping`}
          {paid.amountTaxCents > 0 && ` and ${formatUsd(paid.amountTaxCents)} tax`}.
        </p>
      )}
      <p>
        {order.pages} pages, {productLabel(order.product)}.
      </p>
      <p className="notice">Sending orders to the printer isn't switched on yet, so this book won't be printed. That comes next.</p>
    </section>
  );
}
