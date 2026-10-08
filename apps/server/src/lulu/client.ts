import { z } from 'zod';
import type { CoverDimensions } from '@logbook/core';

/**
 * Lulu Print API client (M2 slice D). Shapes follow the OpenAPI spec (ASSUMPTIONS L1) and what the
 * sandbox actually returned on 2026-10-07: numbers arrive as strings, validation jobs start with
 * `status: null`, and errors come back as a list of messages or a field → messages object.
 */
export interface LuluCredentials {
  apiUrl: string;
  tokenUrl: string;
  clientKey: string;
  clientSecret: string;
}

export class LuluError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Lulu's error body. Holds only API messages (field names, package IDs), never journal content. */
    readonly detail: unknown,
  ) {
    super(message);
    this.name = 'LuluError';
  }
}

const num = z.union([z.string(), z.number()]).transform((v) => Number(v));

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number() });

const coverDimensionsSchema = z.object({ width: num, height: num, unit: z.enum(['pt', 'mm', 'inch']) });

/**
 * Validation job states. The spec lists `VALIDATING → VALIDATED` (interiors), `NORMALIZING →
 * NORMALIZED` (interiors with a package ID, and covers) and `ERROR`, but the sandbox also sends
 * covers through `VALIDATING`, so any state is accepted and every "…ING" state counts as running.
 * Jobs start with `null`.
 */
const validationStatus = z.string().nullable();
export function validationRunning(status: string | null): boolean {
  return status === null || status.endsWith('ING');
}

export const interiorValidationSchema = z.object({
  id: z.number(),
  status: validationStatus,
  page_count: z.number().nullable().optional(),
  errors: z.array(z.string()).nullable().optional(),
  valid_pod_package_ids: z.array(z.string()).nullable().optional(),
});
export type InteriorValidation = z.infer<typeof interiorValidationSchema>;

export const coverValidationSchema = z.object({
  id: z.number(),
  status: validationStatus,
  errors: z.array(z.string()).nullable().optional(),
});
export type CoverValidation = z.infer<typeof coverValidationSchema>;

const money = num;
const costSchema = z.object({ total_cost_excl_tax: money, total_cost_incl_tax: money, total_tax: money.optional() });
export const costCalculationSchema = z.object({
  line_item_costs: z.array(
    z.object({
      quantity: z.number(),
      cost_excl_discounts: money,
      total_cost_excl_tax: money,
      total_cost_incl_tax: money,
      unit_tier_cost: money.nullable().optional(),
    }),
  ),
  shipping_cost: costSchema,
  fulfillment_cost: costSchema.optional(),
  fees: z.array(z.object({ fee_type: z.string().optional(), total_cost_excl_tax: money.optional(), total_cost_incl_tax: money.optional() }).loose()).optional(),
  total_tax: money,
  total_cost_excl_tax: money,
  total_cost_incl_tax: money,
  currency: z.string(),
});
export type CostCalculation = z.infer<typeof costCalculationSchema>;

/** One of Lulu's `/shipping-options/` answers (costs arrive as numbers here, unlike elsewhere). */
export const shippingOptionSchema = z.object({
  level: z.string(),
  carrier_service_name: z.string(),
  cost_excl_tax: num,
  currency: z.string(),
  total_days_min: z.number().nullable().optional(),
  total_days_max: z.number().nullable().optional(),
  is_active: z.boolean().optional(),
});
export type ShippingOption = z.infer<typeof shippingOptionSchema>;

export interface CostRequest {
  lineItems: { podPackageId: string; pageCount: number; quantity: number }[];
  shippingAddress: { street1: string; city: string; countryCode: string; postcode: string; phoneNumber: string; stateCode?: string };
  shippingOption: 'MAIL' | 'PRIORITY_MAIL' | 'GROUND_HD' | 'GROUND_BUS' | 'GROUND' | 'EXPEDITED' | 'EXPRESS';
}

export interface LuluClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Per-request timeout. */
  timeoutMs?: number;
}

/** Tokens are renewed this long before Lulu says they expire. */
const TOKEN_MARGIN_MS = 60_000;

export class LuluClient {
  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;
  private readonly dims = new Map<string, Promise<CoverDimensions>>();
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(
    private readonly creds: LuluCredentials,
    opts: LuluClientOptions = {},
  ) {
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /**
   * Cover size for a package and interior page count, bleed (and hardcover wrap) included. Asked in
   * millimetres: Lulu rounds `pt` to whole points and `inch` to 0.001″, but `mm` to 0.01 mm (0.03 pt).
   * Cached per package ID and page count; the size never changes for a given pair.
   */
  coverDimensions(podPackageId: string, pages: number): Promise<CoverDimensions> {
    const key = `${podPackageId}@${pages}`;
    let p = this.dims.get(key);
    if (!p) {
      p = this.request('POST', '/cover-dimensions/', { pod_package_id: podPackageId, interior_page_count: pages, unit: 'mm' }).then((body) => coverDimensionsSchema.parse(body));
      // A failed lookup isn't remembered.
      p.catch(() => this.dims.delete(key));
      this.dims.set(key, p);
    }
    return p;
  }

  /** Starts an interior check. With a package ID Lulu also normalizes the file for that product. */
  async validateInterior(sourceUrl: string, podPackageId?: string): Promise<InteriorValidation> {
    const body = await this.request('POST', '/validate-interior/', { source_url: sourceUrl, ...(podPackageId ? { pod_package_id: podPackageId } : {}) });
    return interiorValidationSchema.parse(body);
  }

  async getInteriorValidation(id: number): Promise<InteriorValidation> {
    return interiorValidationSchema.parse(await this.request('GET', `/validate-interior/${id}/`));
  }

  async validateCover(sourceUrl: string, podPackageId: string, interiorPageCount: number): Promise<CoverValidation> {
    const body = await this.request('POST', '/validate-cover/', { source_url: sourceUrl, pod_package_id: podPackageId, interior_page_count: interiorPageCount });
    return coverValidationSchema.parse(body);
  }

  async getCoverValidation(id: number): Promise<CoverValidation> {
    return coverValidationSchema.parse(await this.request('GET', `/validate-cover/${id}/`));
  }

  /** Polls a validation job until it leaves the queued and running states, or throws after `timeoutMs`. */
  async waitForValidation<T extends { id: number; status: string | null }>(
    first: T,
    get: (id: number) => Promise<T>,
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<T> {
    const interval = opts.intervalMs ?? 5_000;
    const deadline = this.now() + (opts.timeoutMs ?? 10 * 60_000);
    let job = first;
    while (validationRunning(job.status)) {
      if (this.now() >= deadline) throw new LuluError(`Validation ${job.id} still ${job.status ?? 'queued'} after the timeout`, 0, null);
      await this.sleep(interval);
      job = await get(job.id);
    }
    return job;
  }

  async costCalculation(req: CostRequest): Promise<CostCalculation> {
    const a = req.shippingAddress;
    const body = await this.request('POST', '/print-job-cost-calculations/', {
      line_items: req.lineItems.map((l) => ({ pod_package_id: l.podPackageId, page_count: l.pageCount, quantity: l.quantity })),
      shipping_address: { street1: a.street1, city: a.city, country_code: a.countryCode, postcode: a.postcode, phone_number: a.phoneNumber, ...(a.stateCode ? { state_code: a.stateCode } : {}) },
      shipping_option: req.shippingOption,
    });
    return costCalculationSchema.parse(body);
  }

  /** Shipping choices for a destination country (and state); no street address needed. */
  async shippingOptions(item: { podPackageId: string; pageCount: number; quantity: number }, country: string, state?: string): Promise<ShippingOption[]> {
    const body = await this.request('POST', '/shipping-options/', {
      line_items: [{ pod_package_id: item.podPackageId, page_count: item.pageCount, quantity: item.quantity }],
      shipping_address: { country, ...(state ? { state } : {}) },
      currency: 'USD',
    });
    return z.array(shippingOptionSchema).parse(body);
  }

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.now() < this.token.expiresAt) return this.token.value;
    // One token request at a time, however many calls are waiting.
    this.pendingToken ??= this.fetchToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.creds.clientKey}:${this.creds.clientSecret}`).toString('base64');
    const res = await this.fetch(this.creds.tokenUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    // The token response never goes into an error: it would carry the token.
    if (!res.ok) throw new LuluError(`Lulu token request failed (HTTP ${res.status})`, res.status, null);
    const t = tokenSchema.parse(await res.json());
    this.token = { value: t.access_token, expiresAt: this.now() + t.expires_in * 1000 - TOKEN_MARGIN_MS };
    return t.access_token;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let res = await this.send(method, path, body, await this.accessToken());
    if (res.status === 401) {
      // Revoked or expired early: one retry with a fresh token.
      this.token = null;
      res = await this.send(method, path, body, await this.accessToken(true));
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Lulu answers some failures with an HTML error page.
      parsed = text.includes('<html') ? `HTML error page (${text.length} bytes)` : text.slice(0, 500);
    }
    if (!res.ok) throw new LuluError(`Lulu ${method} ${path} failed (HTTP ${res.status}): ${JSON.stringify(parsed).slice(0, 300)}`, res.status, parsed);
    return parsed;
  }

  private send(method: string, path: string, body: unknown, token: string): Promise<Response> {
    return this.fetch(`${this.creds.apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}
