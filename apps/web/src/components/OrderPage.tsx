import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { productLabel, SHIP_COUNTRIES, type BookOrderRef } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { href } from '../app/router.ts';
import { ApiError, checkoutDonePage, checkoutOrder, getOrder, quoteOrder, type OrderView, type ShippingChoice } from '../lib/api.ts';
import { isDesktop } from '../lib/platform.ts';
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
/** Where a paid book is (PLAN §1.5 steps 7–8), in the customer's words. */
const PROGRESS: { label: string; states: string[] }[] = [
  { label: 'Sending it to the printer', states: ['paid', 'files_generated', 'files_validated'] },
  { label: 'With the printer', states: ['submitted_to_lulu'] },
  { label: 'Being printed', states: ['in_production'] },
  { label: 'On its way', states: ['shipped'] },
  { label: 'Delivered', states: ['delivered'] },
];
/** After coming back from Stripe, how long to keep asking whether the payment has been confirmed. */
const CONFIRM_POLLS = 40;
/**
 * The desktop app can't tell when the customer is done in their browser, so it keeps asking, less
 * often after the first two minutes, until the payment page is paid or expires (60 minutes, D56).
 */
const DESKTOP_CONFIRM_SLOW_MS = 10_000;
/** Proof links last an hour (PROOF_TTL_S); the page fetches fresh ones before they run out. */
const LINK_REFRESH_MS = 50 * 60 * 1000;
/** Typing in the closed country list changes it per keystroke; price only once it settles. */
const QUOTE_DELAY_MS = 600;

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
  /** Bumped to load again now: "Try again", or the page coming back from the back/forward cache. */
  const [visit, setVisit] = useState(0);
  // Seen waiting for payment in this visit, so "paid" can be announced when it arrives.
  const [sawWaiting, setSawWaiting] = useState(false);
  if (order?.state === 'awaiting_payment' && !sawWaiting) setSawWaiting(true);

  useEffect(() => {
    let alive = true;
    void journal.getBookOrder(id).then((r) => alive && setRef(r ?? null));
    return () => {
      alive = false;
    };
  }, [journal, id]);

  // Back from Stripe with the browser's Back button can restore this page as it was left
  // ("Opening the payment page…"); start it afresh and re-read the order.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setVisit((v) => v + 1);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  useEffect(() => {
    if (!ref) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    let failures = 0;
    let loadedAt = 0;
    const later = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), ms);
    };
    const load = async () => {
      try {
        const view = await getOrder(ref.id, ref.token);
        if (!alive) return;
        failures = 0;
        loadedAt = Date.now();
        setOrder(view);
        setLoadError(null);
        // Keep asking while the print files are being made, or while a payment is being confirmed;
        // otherwise come back for fresh proof links before these expire.
        const confirming = view.state === 'awaiting_payment' && !cancelled && (isDesktop || polls < CONFIRM_POLLS);
        if (confirming) polls++;
        if (view.state === 'draft' || confirming) later(view.state === 'draft' ? 1500 : polls > CONFIRM_POLLS ? DESKTOP_CONFIRM_SLOW_MS : 3000);
        else if (view.proof) later(LINK_REFRESH_MS);
      } catch (err) {
        if (!alive) return;
        setLoadError(message(err));
        // A dropped connection or a restarting server mustn't strand the page; a missing order will stay missing.
        if (!(err instanceof ApiError) || err.status === 0 || err.status === 429 || err.status >= 500) later(Math.min(30_000, 2000 * 2 ** Math.min(++failures, 4)));
      }
    };
    // A tab left in the background may have missed the refresh (timers are throttled there).
    const onVisible = () => document.visibilityState === 'visible' && loadedAt && Date.now() - loadedAt > LINK_REFRESH_MS && void load();
    document.addEventListener('visibilitychange', onVisible);
    // Desktop: coming back to the window from the browser's payment page is the moment to look.
    const onFocus = () => loadedAt && void load();
    if (isDesktop) window.addEventListener('focus', onFocus);
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [ref, cancelled, visit]);

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
        <div className="notice notice-warn row" role="alert">
          <span>{loadError}</span>
          <button type="button" className="btn btn-small" onClick={() => setVisit((v) => v + 1)}>
            Try again
          </button>
        </div>
      )}
      {ref && order && (
        <OrderBody key={visit} order={order} orderRef={ref} cancelled={cancelled} announcePaid={sawWaiting} onChange={setOrder} reload={() => setVisit((v) => v + 1)} />
      )}
    </div>
  );
}

interface OrderBodyProps {
  order: OrderView;
  orderRef: BookOrderRef;
  cancelled: boolean;
  onChange: (o: OrderView) => void;
  /** Loads the order afresh and follows it: after the desktop app opened Stripe in the browser. */
  reload: () => void;
}

function OrderBody({ order, orderRef, cancelled, announcePaid, onChange, reload }: OrderBodyProps & { announcePaid: boolean }) {
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
  if (PAID_STATES.includes(order.state)) return <Paid order={order} announce={announcePaid} />;
  if (order.state === 'needs_attention') return <p className="notice notice-warn">Something went wrong after your payment. We've been told and will sort it out with you by email.</p>;
  if (order.state === 'refunded') {
    return (
      <p className="notice">
        We couldn't print this book, so your payment{order.refunded ? ` of ${formatUsd(order.refunded.amountCents)}` : ''} was refunded in full. Your bank usually shows it within 5–10 working
        days. Your journal is still on this device: you can prepare the book again whenever you like.
      </p>
    );
  }
  return <ProofAndPay order={order} orderRef={orderRef} cancelled={cancelled} onChange={onChange} reload={reload} />;
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

function ProofAndPay({ order, orderRef, cancelled, onChange, reload }: OrderBodyProps) {
  const countries = useCountries();
  const [country, setCountry] = useState(order.quote?.country ?? guessCountry());
  // Follow the order's quote when it changes underneath this page (e.g. re-read after a return from Stripe).
  const [quotedCountry, setQuotedCountry] = useState(order.quote?.country);
  if (order.quote?.country !== quotedCountry) {
    setQuotedCountry(order.quote?.country);
    if (order.quote) setCountry(order.quote.country);
  }
  const [checked, setChecked] = useState(false);
  const [paying, setPaying] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quoteProblem, setQuoteProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * Prices `code` after `delay` ms. The list stays usable meanwhile (typing a country's name changes
   * it per keystroke), and only the newest request's answer is shown: the server keeps that one too.
   */
  const price = (code: string, delay = 0) => {
    clearTimeout(pending.current);
    setQuoteProblem(null);
    if (!code) return;
    pending.current = setTimeout(() => {
      const mine = ++latest.current;
      setQuoting(true);
      quoteOrder(orderRef.id, orderRef.token, code).then(
        (view) => mine === latest.current && onChange(view),
        (err: unknown) => mine === latest.current && setQuoteProblem(message(err)),
      ).finally(() => mine === latest.current && setQuoting(false));
    }, delay);
  };
  useEffect(() => () => clearTimeout(pending.current), []);

  // Price the guessed country straight away, so the page opens with real numbers.
  useEffect(() => {
    if (!order.quote && country) price(country);
    // Only on first show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pay = async () => {
    if (!order.quote) return;
    setPaying(true);
    setProblem(null);
    try {
      const returnUrl = isDesktop ? checkoutDonePage() : `${location.origin}${location.pathname}`;
      const { url } = await checkoutOrder(orderRef.id, orderRef.token, { quoteVersion: order.quote.version, returnUrl, checked });
      if (import.meta.env.VITE_PLATFORM === 'desktop') {
        // Stripe's page opens in the browser (PLAN §2); this window follows the order meanwhile.
        const { openExternal } = await import('../desktop/bridge.ts');
        await openExternal(url);
        reload();
      } else location.assign(url);
    } catch (err) {
      setPaying(false);
      setProblem(message(err));
      // The price may have moved (409): show the current one.
      if (err instanceof ApiError && err.status === 409) onChange(await getOrder(orderRef.id, orderRef.token).catch(() => order));
    }
  };

  const quote = order.quote?.country === country ? order.quote : null;
  const countryName = countries.find((c) => c.code === country)?.name ?? country;
  const cheapest = quote?.shipping.reduce((m, s) => Math.min(m, s.priceCents), Number.POSITIVE_INFINITY);
  const duties = quote?.shipping.some((s) => /\bDDU\b/i.test(s.name));
  const waiting = order.state === 'awaiting_payment';

  return (
    <>
      {waiting && (
        <p className="notice" role="status">
          {cancelled
            ? 'You left the payment page, so nothing was charged. You can pay whenever you’re ready.'
            : isDesktop
              ? 'Stripe’s payment page is open in your browser. This page updates by itself once Stripe confirms the payment. Closed it by mistake? Continue to payment below.'
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
            aria-describedby={quoteProblem ? 'quote-problem' : undefined}
            aria-invalid={quoteProblem ? true : undefined}
            onChange={(e) => {
              setCountry(e.target.value);
              price(e.target.value, QUOTE_DELAY_MS);
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
          {quoting ? 'Asking the printer for prices…' : quote && <span className="sr-only">Total from {formatUsd(quote.bookCents + (cheapest ?? 0))} to {countryName}.</span>}
        </p>
        {quoteProblem && (
          <div className="notice notice-warn row" id="quote-problem" role="alert">
            <span>{quoteProblem}</span>
            <button type="button" className="btn btn-small" onClick={() => price(country)}>
              Try again
            </button>
          </div>
        )}
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
          <button type="button" className="btn btn-primary" disabled={!quote || !checked || quoting || paying || !order.proof} onClick={() => void pay()}>
            {paying ? 'Opening the payment page…' : 'Continue to payment'}
          </button>
        </p>
        <p className="hint">Payment is taken by Stripe on its own page. Logbook never sees your card.</p>
      </section>
    </>
  );
}

function Paid({ order, announce }: { order: OrderView; announce: boolean }) {
  const paid = order.paid;
  const heading = useRef<HTMLHeadingElement>(null);
  // Arriving here from "waiting for payment": take screen-reader and keyboard users to the news.
  useEffect(() => {
    if (announce) heading.current?.focus();
  }, [announce]);
  return (
    <section aria-labelledby="paid-h">
      <h2 id="paid-h" ref={heading} tabIndex={-1}>
        Thank you, it's paid
      </h2>
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
      <Progress order={order} />
    </section>
  );
}

/** A date from the printer (`2026-10-20` or a full timestamp), in the reader's language. */
function day(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

function Progress({ order }: { order: OrderView }) {
  const at = PROGRESS.findIndex((p) => p.states.includes(order.state));
  const d = order.delivery;
  const arrival = d?.arrivalMax ? (d.arrivalMin && d.arrivalMin.slice(0, 10) !== d.arrivalMax.slice(0, 10) ? `${day(d.arrivalMin)} to ${day(d.arrivalMax)}` : day(d.arrivalMax)) : null;
  return (
    <>
      <ol className="progress" aria-label="Where your book is">
        {PROGRESS.map((p, i) => (
          <li key={p.label} className={i < at ? 'done' : i === at ? 'now' : undefined} aria-current={i === at ? 'step' : undefined}>
            {p.label}
          </li>
        ))}
      </ol>
      {arrival && order.state !== 'delivered' && <p>The printer expects it to arrive {arrival.includes(' to ') ? `between ${arrival.replace(' to ', ' and ')}` : `by ${arrival}`}.</p>}
      {d && d.trackingUrls.length > 0 && (
        <p>
          {d.carrier ? `${d.carrier} tracking: ` : 'Tracking: '}
          {d.trackingUrls.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer">
              {d.trackingUrls.length > 1 ? `parcel ${i + 1}` : 'follow your parcel'}
              {i < d.trackingUrls.length - 1 ? ', ' : ''}
            </a>
          ))}
        </p>
      )}
      {at < 3 && <p className="hint">The tracking link will appear here when it ships.</p>}
    </>
  );
}
