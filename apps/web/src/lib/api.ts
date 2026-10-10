import { podPackageId, type CoverDimensions, type Product } from '@logbook/core';

/** The Logbook API: same origin unless the build sets VITE_API_URL (D15; always for the desktop app, D79). */
const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');

/**
 * Where Stripe sends a desktop customer after paying (D79): a short page on the API saying to go
 * back to Logbook, since a browser can't open the app's window. The app notices the payment itself.
 */
export function checkoutDonePage(): string {
  return `${API || location.origin}/api/checkout/done`;
}

/**
 * A GET to the API, or null when offline or the API can't answer: every caller has an offline
 * fallback. Only the package ID, page count and similar settings are ever sent, never content.
 */
async function apiGet(path: string, params: Record<string, string>, timeoutMs = 5000): Promise<unknown> {
  if (!navigator.onLine) return null;
  try {
    const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(timeoutMs) });
    // A static host without the API answers with the app's index.html.
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Lulu's exact cover size (D39), or null; the caller then uses the offline estimate. */
export async function fetchCoverDimensions(product: Product, pages: number): Promise<CoverDimensions | null> {
  const d = (await apiGet('/api/cover-dimensions', { pod_package_id: podPackageId(product), pages: String(pages) })) as Partial<CoverDimensions> | null;
  if (typeof d?.width !== 'number' || typeof d.height !== 'number' || (d.unit !== 'pt' && d.unit !== 'mm' && d.unit !== 'inch')) return null;
  return { width: d.width, height: d.height, unit: d.unit };
}

/** The book's price estimate in US cents from Lulu's live cost (M3), or null. */
export async function fetchBookPrice(product: Product, pages: number): Promise<number | null> {
  const q = (await apiGet('/api/quote', { pod_package_id: podPackageId(product), pages: String(pages) })) as { bookCents?: unknown; currency?: unknown } | null;
  return typeof q?.bookCents === 'number' && q.currency === 'usd' ? q.bookCents : null;
}

// ── Orders (M3 slice C): only a manifest goes to the API; files go straight to storage. ─────────

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiJson<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Couldn't reach Logbook's print service. Check your connection and try again.", 0);
  }
  const body = res.headers.get('content-type')?.includes('application/json') ? ((await res.json()) as { error?: string }) : null;
  if (!res.ok || !body) throw new ApiError(body?.error ?? "Logbook's print service isn't available here yet.", res.status);
  return body as T;
}

export interface OrderUpload {
  path: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface OrderView {
  id: string;
  state: string;
  product: Product;
  stage: string | null;
  pages: number | null;
  coverApproximate: boolean | null;
  currency: 'usd';
  bookCents: number | null;
  lulu: { checked: true; interior: { status: string | null }; cover: { status: string | null } } | { checked: false; reason: string } | null;
  error: string | null;
  proof: { interior: string; cover: string } | null;
  /** The price for the chosen destination; Checkout charges exactly this. */
  quote: OrderQuote | null;
  /** Stripe's page while the order waits for payment. */
  checkoutUrl: string | null;
  paid: { amountTotalCents: number; amountShippingCents: number; amountTaxCents: number; currency: string; shippingLevel: string | null; paidAt: string } | null;
  /** Once the printer has the book: the carrier's tracking and the printer's delivery estimate. */
  delivery: { carrier: string | null; trackingUrls: string[]; arrivalMin: string | null; arrivalMax: string | null } | null;
  /** The refund, if the book couldn't be printed. */
  refunded: { amountCents: number; currency: string; at: string } | null;
}

export interface ShippingChoice {
  level: string;
  name: string;
  daysMin: number | null;
  daysMax: number | null;
  priceCents: number;
}

export interface OrderQuote {
  version: number;
  at: string;
  country: string;
  bookCents: number;
  shipping: ShippingChoice[];
}

export function createOrder(manifest: { product: Product; bundle: { bytes: number; sha256: string }; files: { path: string; bytes: number; sha256: string }[] }) {
  return apiJson<{ orderId: string; token: string; expiresInSeconds: number; uploads: OrderUpload[] }>('/api/orders', { method: 'POST', body: JSON.stringify(manifest) });
}

/** PUTs one file to its signed URL (storage, not the API), reporting bytes sent. */
export function uploadFile(upload: OrderUpload, bytes: Uint8Array<ArrayBuffer>, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload.url);
    for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? (onProgress(bytes.length), resolve()) : reject(new ApiError(`An upload failed (HTTP ${xhr.status}).`, xhr.status)));
    xhr.onerror = () => reject(new ApiError('An upload failed. Check your connection and try again.', 0));
    xhr.send(new Blob([bytes]));
  });
}

export function submitOrder(id: string, token: string) {
  return apiJson<OrderView>(`/api/orders/${encodeURIComponent(id)}/submit`, { method: 'POST', token });
}

export function getOrder(id: string, token: string) {
  return apiJson<OrderView>(`/api/orders/${encodeURIComponent(id)}`, { token });
}

/** Prices the order for a destination country (only the country is sent). */
export function quoteOrder(id: string, token: string, country: string) {
  return apiJson<OrderView>(`/api/orders/${encodeURIComponent(id)}/quote`, { method: 'POST', token, body: JSON.stringify({ country }) });
}

/**
 * Stripe's payment page for the quote this page showed. The server charges its stored quote and
 * answers 409 if that's no longer `quoteVersion`. Stripe returns the customer to `returnUrl`.
 */
export function checkoutOrder(id: string, token: string, input: { quoteVersion: number; returnUrl: string; checked: boolean }) {
  return apiJson<{ url: string }>(`/api/orders/${encodeURIComponent(id)}/checkout`, { method: 'POST', token, body: JSON.stringify(input) });
}
