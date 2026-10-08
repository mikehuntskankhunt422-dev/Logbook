import Stripe from 'stripe';

export type CheckoutSession = Stripe.Checkout.Session;
export type CheckoutParams = Stripe.Checkout.SessionCreateParams;
export type StripeEvent = Stripe.Event;

/** A webhook whose signature didn't match, or was too old. */
export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeSignatureError';
  }
}

/** Stripe refused a request or couldn't be reached. `code` is Stripe's error code when it gave one. */
export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'StripeApiError';
  }
}

/** The handful of Stripe calls Logbook makes (M3 slice E). */
export class StripeGateway {
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string | undefined,
    opts: { fetch?: typeof globalThis.fetch } = {},
  ) {
    this.stripe = new Stripe(secretKey, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      ...(opts.fetch ? { httpClient: Stripe.createFetchHttpClient(opts.fetch) } : {}),
    });
  }

  get canVerifyWebhooks(): boolean {
    return Boolean(this.webhookSecret);
  }

  createCheckout(params: CheckoutParams, idempotencyKey: string): Promise<CheckoutSession> {
    return this.call(() => this.stripe.checkout.sessions.create(params, { idempotencyKey }));
  }

  getCheckout(id: string): Promise<CheckoutSession> {
    return this.call(() => this.stripe.checkout.sessions.retrieve(id));
  }

  /** Expires an open session so it can't be paid any more. Stripe refuses once it's complete. */
  expireCheckout(id: string): Promise<CheckoutSession> {
    return this.call(() => this.stripe.checkout.sessions.expire(id));
  }

  /** Checks the `Stripe-Signature` header against the raw body (5 minutes' tolerance) and parses the event. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): StripeEvent {
    if (!this.webhookSecret) throw new StripeSignatureError('No webhook signing secret is configured.');
    if (!signature) throw new StripeSignatureError('The Stripe-Signature header is missing.');
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err) {
      throw new StripeSignatureError(err instanceof Error ? err.message : 'Invalid signature.');
    }
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) throw new StripeApiError(err.message, err.statusCode, err.code);
      throw err;
    }
  }
}
