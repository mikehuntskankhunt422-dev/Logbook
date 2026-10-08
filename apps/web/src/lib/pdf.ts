import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let lib: Promise<PdfJs> | null = null;

/**
 * pdf.js and its worker, loaded only when a proof is shown (they're large and only ordering needs
 * them). The legacy build: the modern one needs `Map.prototype.getOrInsertComputed`, which
 * Chromium 141 and many readers' browsers don't have yet; the legacy build polyfills it.
 */
function pdfjs(): Promise<PdfJs> {
  lib ??= Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]).then(([m, worker]) => {
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  });
  return lib;
}

/**
 * Opens a proof PDF from its signed link. A plain GET (no range requests), so a bucket on another
 * origin needs only GET in its CORS rules, no preflight. Reports bytes received as they arrive.
 */
export async function openPdf(url: string, opts: { signal?: AbortSignal; onProgress?: (received: number, total: number | null) => void } = {}): Promise<PDFDocumentProxy> {
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    opts.onProgress?.(received, total);
  }
  const data = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    data.set(c, at);
    at += c.length;
  }
  const m = await pdfjs();
  const doc = await m.getDocument({ data }).promise;
  // Finished after the viewer went away: free its worker rather than keep the PDF in memory.
  if (opts.signal?.aborted) {
    void doc.loadingTask.destroy();
    throw new DOMException('Aborted', 'AbortError');
  }
  return doc;
}

/** Draws page `n` (1-based) `cssWidth` CSS pixels wide, sharp on high-density screens. */
export async function drawPage(doc: PDFDocumentProxy, n: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<RenderTask> {
  const page = await doc.getPage(n);
  const unit = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: (cssWidth / unit.width) * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  // The height follows the canvas's own proportions, so a narrower box can't squash the page.
  canvas.style.height = 'auto';
  return page.render({ canvas, viewport });
}
