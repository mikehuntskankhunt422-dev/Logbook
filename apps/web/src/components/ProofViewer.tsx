import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { drawPage, openPdf } from '../lib/pdf.ts';

type Which = 'pages' | 'cover';
type Loaded = { kind: 'loading'; received: number; total: number | null } | { kind: 'ready'; doc: PDFDocumentProxy } | { kind: 'failed' };

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * The real print files, shown in the page with pdf.js (PLAN §1.5 step 4): one page at a time, and
 * the cover. Each PDF is loaded once per order, even though the order's signed links change every
 * time it's read. If pdf.js can't show them, the links above still open them.
 */
export function ProofViewer({ orderId, interior, cover }: { orderId: string; interior: string; cover: string }) {
  const [which, setWhich] = useState<Which>('pages');
  const [docs, setDocs] = useState<Record<Which, Loaded | undefined>>({ pages: undefined, cover: undefined });
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [drawFailed, setDrawFailed] = useState(false);
  const urls = useRef({ pages: interior, cover });
  urls.current = { pages: interior, cover };
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  // Each file loads the first time it's shown, once per order, and keeps loading while the other is
  // shown. Leaving the page aborts what's loading and frees pdf.js's workers (each holds a whole PDF).
  const current = docs[which];
  const loads = useRef(new Map<Which, AbortController>());
  const opened = useRef<PDFDocumentProxy[]>([]);
  useEffect(() => {
    if (loads.current.has(which)) return;
    const abort = new AbortController();
    loads.current.set(which, abort);
    const set = (l: Loaded) => setDocs((d) => ({ ...d, [which]: l }));
    set({ kind: 'loading', received: 0, total: null });
    openPdf(urls.current[which], { signal: abort.signal, onProgress: (received, total) => set({ kind: 'loading', received, total }) }).then(
      (doc) => {
        opened.current.push(doc);
        set({ kind: 'ready', doc });
      },
      () => !abort.signal.aborted && set({ kind: 'failed' }),
    );
  }, [orderId, which]);
  useEffect(
    () => () => {
      for (const a of loads.current.values()) a.abort();
      loads.current.clear();
      for (const d of opened.current.splice(0)) void d.loadingTask.destroy();
      setDocs({ pages: undefined, cover: undefined });
    },
    [],
  );

  // The canvas fits the box's content width (inside its padding), so pages keep their proportions.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setWidth(Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const doc = current?.kind === 'ready' ? current.doc : null;
  const count = doc?.numPages ?? 0;
  const shown = which === 'cover' ? 1 : Math.min(page, Math.max(count, 1));
  // One render at a time on the canvas (pdf.js refuses overlapping renders): each waits for the last.
  const rendering = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    const el = canvas.current;
    if (!doc || !el || width <= 0) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    // A book page fits the width up to a comfortable size; the cover (back, spine, front) uses it all.
    const cssWidth = which === 'cover' ? width : Math.min(width, 520);
    rendering.current = rendering.current
      .then(async () => {
        if (cancelled) return;
        task = await drawPage(doc, shown, el, cssWidth);
        if (cancelled) task.cancel();
        await task.promise;
        setDrawFailed(false);
      })
      .catch((err: unknown) => {
        // A cancelled render (the reader turned the page) is expected; anything else is shown.
        if (cancelled || (err instanceof Error && err.name === 'RenderingCancelledException')) return;
        console.warn('Proof page could not be drawn', err);
        setDrawFailed(true);
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, shown, which, width]);

  const go = (to: number) => setPage(Math.min(Math.max(1, to), count));
  const label = which === 'cover' ? 'The cover: back, spine and front' : `Page ${shown} of ${count}`;

  return (
    <div className="proof-viewer">
      <div className="segmented" role="group" aria-label="Show">
        <button type="button" aria-pressed={which === 'pages'} onClick={() => setWhich('pages')}>
          Pages
        </button>
        <button type="button" aria-pressed={which === 'cover'} onClick={() => setWhich('cover')}>
          Cover
        </button>
      </div>
      <div
        ref={box}
        className="proof-canvas"
        tabIndex={doc && which === 'pages' ? 0 : -1}
        aria-label={doc && which === 'pages' ? 'Proof pages: use the arrow keys to turn pages' : undefined}
        onKeyDown={(e) => {
          if (which !== 'pages') return;
          if (e.key === 'ArrowRight') go(shown + 1);
          if (e.key === 'ArrowLeft') go(shown - 1);
        }}
      >
        {current?.kind === 'loading' && (
          <p className="hint" role="status">
            Loading the {which === 'cover' ? 'cover' : 'pages'}… {current.received > 0 && (current.total ? `${mb(current.received)} of ${mb(current.total)}` : mb(current.received))}
          </p>
        )}
        {(current?.kind === 'failed' || (doc && drawFailed)) && (
          <p className="notice" role="alert">
            The {which === 'cover' ? 'cover' : 'pages'} can't be shown here. Use the links above to open the PDF.
          </p>
        )}
        <canvas ref={canvas} hidden={!doc} role="img" aria-label={label} />
      </div>
      {doc && which === 'pages' && (
        <div className="row viewer-controls">
          <button type="button" className="btn btn-small" onClick={() => go(shown - 1)} disabled={shown <= 1}>
            ← Previous
          </button>
          <label className="page-slider">
            <span className="sr-only">Go to page</span>
            <input type="range" min={1} max={count} value={shown} onChange={(e) => go(Number(e.target.value))} aria-valuetext={label} />
          </label>
          <button type="button" className="btn btn-small" onClick={() => go(shown + 1)} disabled={shown >= count}>
            Next →
          </button>
          <span className="muted" aria-live="polite">
            {label}
          </span>
        </div>
      )}
    </div>
  );
}
