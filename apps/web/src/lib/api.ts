import { podPackageId, type CoverDimensions, type Product } from '@logbook/core';

/** The Logbook API: same origin unless the build sets VITE_API_URL (D15: website and API are hosted apart). */
const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');

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
