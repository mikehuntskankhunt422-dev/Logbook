import { podPackageId, type CoverDimensions, type Product } from '@logbook/core';

/** The Logbook API: same origin unless the build sets VITE_API_URL (D15: website and API are hosted apart). */
const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');

/**
 * Lulu's exact cover size from the API (D39), or null when offline or the API can't say, in which
 * case the caller uses the offline estimate. Only the package ID and page count are sent.
 */
export async function fetchCoverDimensions(product: Product, pages: number, timeoutMs = 5000): Promise<CoverDimensions | null> {
  if (!navigator.onLine) return null;
  try {
    const query = new URLSearchParams({ pod_package_id: podPackageId(product), pages: String(pages) });
    const res = await fetch(`${API}/api/cover-dimensions?${query}`, { signal: AbortSignal.timeout(timeoutMs) });
    // A static host without the API answers with the app's index.html.
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null;
    const d = (await res.json()) as Partial<CoverDimensions>;
    if (typeof d.width !== 'number' || typeof d.height !== 'number' || (d.unit !== 'pt' && d.unit !== 'mm' && d.unit !== 'inch')) return null;
    return { width: d.width, height: d.height, unit: d.unit };
  } catch {
    return null;
  }
}
