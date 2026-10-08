/** One email. Bodies are plain text and never carry journal content (PLAN §6). */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Repeating a send with the same key doesn't send it twice. */
  idempotencyKey: string;
  /** Which template, for the provider's dashboard. */
  tag: string;
}

export interface Mailer {
  /** False when no provider is configured: emails are recorded as not sent. */
  readonly enabled: boolean;
  /** False when only alerts to you can be delivered: customer emails are recorded as not sent (D76). */
  readonly reachesCustomers: boolean;
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

export class MailerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MailerError';
  }
}

/** No provider configured (development, or before the Resend key arrives, M4 §6). */
export const noMailer: Mailer = { enabled: false, reachesCustomers: false, send: async () => ({ id: null }) };

/**
 * Resend's shared test sender (`onboarding@resend.dev`, or any `@resend.dev` address) delivers only
 * to the Resend account's own address, so with it Logbook emails you and not customers (D76).
 */
export function isResendTestSender(from: string): boolean {
  return /@resend\.dev>?\s*$/i.test(from);
}

/**
 * Resend's HTTP API (D17): `POST https://api.resend.com/emails` with a bearer key and an
 * `Idempotency-Key`. Checked against Resend with `npm run email:check` (ASSUMPTIONS, Resend).
 */
export class ResendMailer implements Mailer {
  readonly enabled = true;
  readonly reachesCustomers: boolean;
  private readonly fetch: typeof fetch;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    opts: { fetch?: typeof fetch } = {},
  ) {
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.reachesCustomers = !isResendTestSender(from);
  }

  async send(m: EmailMessage): Promise<{ id: string | null }> {
    const res = await this.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, tags: [{ name: 'template', value: m.tag }] }),
      signal: AbortSignal.timeout(20_000),
    });
    // Resend's error bodies hold a name and a message, never the email; still, keep them short.
    if (!res.ok) throw new MailerError(`Resend refused the email (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`, res.status);
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: body.id ?? null };
  }
}
