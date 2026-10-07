import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateRange, type BookOptions, type Entry, type MediaMeta } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { ApiError, createOrder, getOrder, submitOrder, uploadFile, type OrderView } from '../lib/api.ts';
import { buildPrintBundle, uploadSummary } from '../lib/print-bundle.ts';
import { Dialog } from './common.tsx';

const STAGES: Record<string, string> = {
  'awaiting upload': 'Uploading…',
  queued: 'Waiting for the print service…',
  checking: 'Checking that everything arrived intact…',
  rendering: 'Laying out and printing your pages…',
  validating: 'The printer is checking the files…',
  pricing: 'Pricing your book…',
};

function megabytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

type Phase = { kind: 'idle' } | { kind: 'working'; message: string } | { kind: 'done'; order: OrderView } | { kind: 'error'; message: string };

/**
 * "Prepare my book" (PLAN §1.5 step 2, M3 slice C): an explicit consent step that lists exactly
 * what leaves the device, then the upload straight to storage and the server's print files.
 */
export function PrepareBook({ options, entries, media, formatUsd }: { options: BookOptions; entries: Entry[]; media: Map<string, MediaMeta>; formatUsd: (cents: number) => string }) {
  const { journal } = useJournal();
  const [asking, setAsking] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const summary = useMemo(() => uploadSummary(entries, options, (id) => media.get(id)), [entries, options, media]);
  const range = entries.length ? formatDateRange(entries[0]!.date, entries.at(-1)!.date) : '';
  const say = (p: Phase) => alive.current && setPhase(p);

  const start = async () => {
    setAsking(false);
    try {
      say({ kind: 'working', message: 'Preparing pictures for print…' });
      const built = await buildPrintBundle(journal, entries, options, (id) => media.get(id), (n, total) => say({ kind: 'working', message: `Preparing pictures for print (${n} of ${total})…` }));
      const all = [built.bundle, ...built.files];
      const total = all.reduce((n, f) => n + f.bytes.length, 0);
      const order = await createOrder({
        product: options.product,
        bundle: { bytes: built.bundle.bytes.length, sha256: built.bundle.sha256 },
        files: built.files.map((f) => ({ path: f.path, bytes: f.bytes.length, sha256: f.sha256 })),
      });
      const byPath = new Map(all.map((f) => [f.path, f]));
      const sent = new Map<string, number>();
      const report = () => say({ kind: 'working', message: `Uploading ${megabytes([...sent.values()].reduce((a, b) => a + b, 0))} of ${megabytes(total)}…` });
      const queue = [...order.uploads];
      // Three uploads at a time, straight to storage.
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          for (let u = queue.shift(); u; u = queue.shift()) {
            const file = byPath.get(u.path)!;
            await uploadFile(u, file.bytes, (n) => {
              sent.set(u.path, n);
              report();
            });
          }
        }),
      );
      let view = await submitOrder(order.orderId, order.token);
      while (alive.current && view.state === 'draft') {
        say({ kind: 'working', message: STAGES[view.stage ?? ''] ?? 'Making your print files…' });
        await new Promise((r) => setTimeout(r, 1500));
        view = await getOrder(order.orderId, order.token);
      }
      say(view.state === 'failed' ? { kind: 'error', message: view.error ?? 'The print files could not be made.' } : { kind: 'done', order: view });
    } catch (err) {
      say({ kind: 'error', message: err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong.' });
    }
  };

  const working = phase.kind === 'working';
  return (
    <section className="prepare" aria-labelledby="prepare-h">
      <h3 id="prepare-h">Print files</h3>
      <p>When you're happy with the preview, Logbook's print service makes the exact files the printer will use, so you can check them before ordering.</p>
      <button type="button" className="btn btn-primary" onClick={() => setAsking(true)} disabled={working || !entries.length}>
        {phase.kind === 'done' ? 'Prepare again…' : 'Prepare my book…'}
      </button>
      <p className="hint" role="status" aria-live="polite">
        {phase.kind === 'working' && phase.message}
      </p>
      {phase.kind === 'error' && (
        <p className="notice notice-warn" role="alert">
          {phase.message}
        </p>
      )}
      {phase.kind === 'done' && <PrintFiles order={phase.order} formatUsd={formatUsd} />}

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Send your book to be printed?"
        actions={
          <>
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              Not now
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void start()}>
              Send and prepare
            </button>
          </>
        }
      >
        <p>To make the print files, a copy of this book leaves your device:</p>
        <ul className="consent-list">
          <li>
            <strong>
              {summary.entries} {summary.entries === 1 ? 'entry' : 'entries'}
            </strong>
            {range && ` (${range})`}: their words, dates, moods and tags
          </li>
          <li>
            <strong>
              {summary.pictures} {summary.pictures === 1 ? 'picture' : 'pictures'}
            </strong>
            , reduced to print size first{summary.maxBytes > 0 && ` (at most ${megabytes(summary.maxBytes)})`}
          </li>
          <li>The title, cover text and the other choices you made here</li>
        </ul>
        <p>
          Nothing else is sent: not your other entries{summary.cardsOnly > 0 && ', and not the files of videos, voice notes or attachments (they print as cards from their names and lengths)'}.
        </p>
        <p>It goes over an encrypted connection to Logbook's print storage. It's used only to make and print this book, and deleted within 7 days.</p>
        {journal.isEncrypted && <p className="notice">Your journal is locked with a passcode. These entries are unlocked on this device to be sent; the rest stay locked.</p>}
      </Dialog>
    </section>
  );
}

function PrintFiles({ order, formatUsd }: { order: OrderView; formatUsd: (cents: number) => string }) {
  const lulu = order.lulu;
  return (
    <div className="print-files">
      <p>
        <strong>Your print files are ready: {order.pages} pages.</strong>
        {order.bookCents !== null && ` The book costs ${formatUsd(order.bookCents)} plus shipping and any tax.`}
      </p>
      {order.proof && (
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
      )}
      <p className="hint">
        {lulu?.checked ? 'The printer has checked both files and accepted them.' : `Not checked by the printer yet (${lulu?.reason ?? 'unknown'}).`}
        {order.coverApproximate && ' The cover uses an approximate spine width.'} The links work for an hour; prepare again for new ones. Ordering is coming soon.
      </p>
    </div>
  );
}
