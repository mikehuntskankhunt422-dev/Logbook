/**
 * Sends one test alert email through Resend (M4 §6, slice F):
 *
 *   npm run email:check -w @logbook/server
 *
 * A made-up order in a temporary database is moved to `needs_attention`, and the real job runner
 * runs its `alert` email job, so the email goes out exactly as a real alert would: the `alert`
 * template, to OWNER_EMAIL, from EMAIL_FROM, with an idempotency key. Then it asks Resend what
 * happened to the email (a sending-only key can't read emails back; the script says so). Nothing
 * touches Lulu, Stripe or the bucket.
 *
 * Needs RESEND_API_KEY, EMAIL_FROM and OWNER_EMAIL.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { ResendMailer, type Mailer } from '../src/email/mailer.ts';
import { Fulfilment } from '../src/fulfilment/service.ts';
import { JobRunner } from '../src/jobs/runner.ts';
import { OrderDb } from '../src/orders/db.ts';
import { SAMPLE_PRODUCTS } from '../src/samples/products.ts';
import { LocalStore } from '../src/storage/local.ts';

const config = loadConfig();
const { resend, ownerEmail, contactEmail } = config.fulfilment;
if (!resend) throw new Error('Set RESEND_API_KEY and EMAIL_FROM.');
if (!ownerEmail) throw new Error('Set OWNER_EMAIL: alerts go there.');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = {
  info: (o: object, m: string) => console.error(`${stamp()} ${m} ${JSON.stringify(o)}`),
  warn: (o: object, m: string) => console.error(`${stamp()} ! ${m} ${JSON.stringify(o)}`),
  error: (o: object, m: string) => console.error(`${stamp()} ✗ ${m} ${JSON.stringify(o)}`),
};

const dir = await mkdtemp(join(tmpdir(), 'logbook-email-check-'));
const db = new OrderDb(join(dir, 'orders.sqlite'));
const id = `ord_emailcheck_${randomBytes(4).toString('hex')}`;
db.create({ id, tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'), podPackageId: '0600X0900.FC.PRE.PB.080CW444.MXX', product: SAMPLE_PRODUCTS['6x9-pb-matte'], uploads: [] });
db.update(id, { pages: 48 });
for (const to of ['quoted', 'awaiting_payment', 'paid', 'needs_attention'] as const) db.move(id, to, 'script:email-check');
db.update(id, { error: 'Test alert from npm run email:check. There is no such order; nothing to do.' });
db.enqueueJob(id, 'email', { key: 'alert:1', mode: 'once' });

// The real Resend mailer, watched for the email's ID.
const resendMailer = new ResendMailer(resend.apiKey, resend.from);
let emailId: string | null = null;
const mailer: Mailer = {
  enabled: true,
  send: async (m) => {
    const sent = await resendMailer.send(m);
    emailId = sent.id;
    return sent;
  },
};
const fulfilment = new Fulfilment({ db, store: new LocalStore(join(dir, 'storage')), mailer, contactEmail, ownerEmail, log });
await new JobRunner({ db, handle: fulfilment.handle, onDead: fulfilment.onDead, log }).runDue();
const job = db.jobs(id).find((j) => j.kind === 'email');
db.close();
if (job?.state !== 'done' || !emailId) {
  console.error(`✗ The alert wasn't sent: ${job?.lastError ?? 'the email job did not run'}`);
  process.exit(1);
}
console.log(`✓ Resend accepted the alert for ${id}: email ${emailId}, from ${resend.from} to ${ownerEmail}`);

// Resend's view of it: "sent" until the receiving mail server answers, then "delivered" or "bounced".
const PENDING = new Set(['queued', 'scheduled', 'sent']);
for (let i = 0; i < 12; i++) {
  const res = await fetch(`https://api.resend.com/emails/${emailId}`, { headers: { Authorization: `Bearer ${resend.apiKey}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    console.log(`Resend didn't say what happened to it (HTTP ${res.status}: ${(await res.text()).slice(0, 200)}); check the inbox or Resend's dashboard.`);
    break;
  }
  const email = (await res.json()) as { last_event?: string; created_at?: string };
  if (!PENDING.has(email.last_event ?? '') || i === 11) {
    console.log(`Resend: ${email.last_event ?? 'no status'} (created ${email.created_at ?? '?'})`);
    if (email.last_event === 'bounced' || email.last_event === 'failed') process.exit(1);
    break;
  }
  await sleep(5000);
}
