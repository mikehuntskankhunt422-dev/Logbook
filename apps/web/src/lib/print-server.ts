import { buildBookBundle, type BookOptions, type Journal } from '@logbook/core';

/**
 * The render server. Set VITE_API_URL at build time; on localhost it defaults to the dev server
 * (`npm run server`). Elsewhere, without VITE_API_URL, making print files is switched off.
 */
export const PRINT_API: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8787' : '');

export interface PrintFiles {
  zip: Blob;
  pages: number;
  /** `estimate` when the server has no Lulu credentials: fine for checking, never for ordering. */
  coverSource: string;
}

/** Packs the book and asks the server for interior and cover PDFs (a zip with a report). */
export async function makePrintFiles(journal: Journal, options: BookOptions, signal?: AbortSignal): Promise<PrintFiles> {
  if (!PRINT_API) throw new Error('No print server is configured for this site yet.');
  const bundle = await buildBookBundle(journal, options);
  let res: Response;
  try {
    res = await fetch(`${PRINT_API}/render`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: bundle, signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error("Couldn't reach the print server. Check your connection and try again.", { cause: err });
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The print server couldn't make this book (HTTP ${res.status}).`);
  }
  return { zip: await res.blob(), pages: Number(res.headers.get('x-logbook-pages')), coverSource: res.headers.get('x-logbook-cover-source') ?? '' };
}
