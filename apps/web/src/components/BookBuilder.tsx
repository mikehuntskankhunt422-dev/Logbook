import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BINDINGS,
  FINISHES,
  GRADIENTS,
  GRADIENT_IDS,
  INTERIORS,
  PRINTABLE_IMAGE_TYPES,
  PageCountError,
  SPINE_TEXT_MIN_PAGES,
  TRIMS,
  bookMedia,
  bookOptionsSchema,
  coverDocument,
  dateRangeLabel,
  estimateCoverDimensions,
  formatBytes,
  interiorDocument,
  interiorGeometry,
  pageLimits,
  planPages,
  productLabel,
  selectEntries,
  slugify,
  tagCounts,
  type BookOptions,
  type Entry,
  type Journal,
  type MediaMeta,
  type PagePlan,
  type Product,
  type PrintWarning,
} from '@logbook/core';
import { useJournal, useMediaUrl } from '../app/journal-context.tsx';
import { href } from '../app/router.ts';
import { useToast } from '../app/toasts.tsx';
import { downloadBlob } from '../lib/backup-io.ts';
import { getBookDraft, setBookDraft } from '../lib/book-draft.ts';
import { PreviewFrame, SupersededError, previewImage } from '../lib/print-preview.ts';
import { PRINT_API, makePrintFiles } from '../lib/print-server.ts';
import { Dialog, formatLongDate } from './common.tsx';

const CSS_PX_PER_IN = 96;

type Status = { kind: 'idle' } | { kind: 'working' } | { kind: 'ready'; plan: PagePlan } | { kind: 'error'; message: string };

function defaultOptions(): BookOptions {
  return bookOptionsSchema.parse({ title: 'My journal', locale: navigator.language || 'en-AU' });
}

/** Lazy-loaded route: the book builder with a live, paginated preview. */
export default function BookBuilder() {
  const { journal, entries } = useJournal();
  const [opts, setOpts] = useState<BookOptions>(() => getBookDraft() ?? defaultOptions());
  const update = useCallback((patch: Partial<BookOptions>) => setOpts((o) => ({ ...o, ...patch })), []);
  useEffect(() => setBookDraft(opts), [opts]);

  const [media, setMedia] = useState<Map<string, MediaMeta>>(new Map());
  useEffect(() => {
    let alive = true;
    void journal.listMediaMeta().then((list) => alive && setMedia(new Map(list.map((m) => [m.id, m]))));
    return () => {
      alive = false;
    };
  }, [journal, entries]);

  const inRange = useMemo(() => selectEntries(entries, { ...opts, excludeIds: [] }), [entries, opts]);
  const selected = useMemo(() => selectEntries(entries, opts), [entries, opts]);
  const imageIds = useMemo(() => bookMedia(selected, opts, (id) => media.get(id)).imageIds, [selected, opts, media]);
  const urls = usePreviewUrls(journal, imageIds);

  // Resolution and missing-file checks don't need a layout: placements come straight from the geometry.
  const warnings = useMemo(
    () => interiorDocument({ options: opts, entries: selected, media, mediaUrl: (id) => (media.has(id) ? id : null), gutterIn: 0, notesPages: 0 }).warnings,
    [opts, selected, media],
  );

  const [plan, setPlan] = useState<PagePlan | null>(null);

  return (
    <div className="builder">
      <h1>Make a book</h1>
      <p className="hint">Turn your journal into a printed book. Everything below is laid out exactly as it will print; nothing leaves this device until you make the print files.</p>

      <section className="panel" aria-labelledby="b-title">
        <h2 id="b-title">Title page</h2>
        <div className="field">
          <label htmlFor="book-title">Title</label>
          <input id="book-title" className="text-input" maxLength={120} value={opts.title} onChange={(e) => update({ title: e.target.value })} aria-invalid={!opts.title.trim()} />
        </div>
        <div className="field">
          <label htmlFor="book-subtitle">Subtitle (optional)</label>
          <input id="book-subtitle" className="text-input" maxLength={200} value={opts.subtitle} onChange={(e) => update({ subtitle: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="book-author">Author (optional)</label>
          <input id="book-author" className="text-input" maxLength={120} value={opts.author} onChange={(e) => update({ author: e.target.value })} />
        </div>
      </section>

      <EntriesPanel opts={opts} update={update} entries={entries} inRange={inRange} selected={selected} />
      <FormatPanel opts={opts} update={update} plan={plan} />
      <CoverPanel opts={opts} update={update} selected={selected} media={media} plan={plan} />

      <Preview opts={opts} selected={selected} media={media} urls={urls} onPlan={setPlan} />

      <WarningsPanel warnings={warnings} />
      <PrintFilesPanel opts={opts} selected={selected} imageIds={imageIds} media={media} plan={plan} />
    </div>
  );
}

function EntriesPanel({ opts, update, entries, inRange, selected }: { opts: BookOptions; update: (p: Partial<BookOptions>) => void; entries: Entry[]; inRange: Entry[]; selected: Entry[] }) {
  const tags = useMemo(() => tagCounts(entries), [entries]);
  const dates = useMemo(() => entries.map((e) => e.date).sort(), [entries]);
  const excluded = new Set(opts.excludeIds);
  const toggle = (id: string) => update({ excludeIds: excluded.has(id) ? opts.excludeIds.filter((x) => x !== id) : [...opts.excludeIds, id] });
  return (
    <section className="panel" aria-labelledby="b-entries">
      <h2 id="b-entries">Entries</h2>
      <div className="row">
        <div className="field">
          <label htmlFor="book-from">From</label>
          <input id="book-from" type="date" className="text-input" min={dates[0]} max={opts.to ?? dates.at(-1)} value={opts.from ?? ''} onChange={(e) => update({ from: e.target.value || null })} />
        </div>
        <div className="field">
          <label htmlFor="book-to">To</label>
          <input id="book-to" type="date" className="text-input" min={opts.from ?? dates[0]} max={dates.at(-1)} value={opts.to ?? ''} onChange={(e) => update({ to: e.target.value || null })} />
        </div>
      </div>
      {tags.length > 0 && (
        <div className="tags" role="group" aria-label="Only entries tagged">
          {tags.map(([t]) => (
            <button key={t} type="button" className="tag" aria-pressed={opts.tags.includes(t)} onClick={() => update({ tags: opts.tags.includes(t) ? opts.tags.filter((x) => x !== t) : [...opts.tags, t] })}>
              #{t}
            </button>
          ))}
        </div>
      )}
      <p className="muted" aria-live="polite" data-testid="entry-count">
        {selected.length} of {entries.length} {entries.length === 1 ? 'entry' : 'entries'} in this book
        {selected.length > 0 && ` · ${dateRangeLabel(selected, opts.locale)}`}
      </p>
      {inRange.length > 0 && (
        <details className="entry-picker">
          <summary>Choose individual entries</summary>
          <ul>
            {inRange.map((e) => (
              <li key={e.id}>
                <label>
                  <input type="checkbox" checked={!excluded.has(e.id)} onChange={() => toggle(e.id)} />
                  <span className="muted">{formatLongDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span> {e.title || 'Untitled'}
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Segmented<K extends string>({ label, value, options, onChange }: { label: string; value: K; options: Record<K, { label: string }>; onChange: (k: K) => void }) {
  return (
    <div className="field">
      <span className="field-label" id={`seg-${slugify(label)}`}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={`seg-${slugify(label)}`}>
        {(Object.keys(options) as K[]).map((k) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
            {options[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FormatPanel({ opts, update, plan }: { opts: BookOptions; update: (p: Partial<BookOptions>) => void; plan: PagePlan | null }) {
  const set = (patch: Partial<Product>) => update({ product: { ...opts.product, ...patch } });
  const limits = pageLimits(opts.product);
  return (
    <section className="panel" aria-labelledby="b-format">
      <h2 id="b-format">Format</h2>
      <div className="format-grid">
        <Segmented label="Size" value={opts.product.trim} options={TRIMS} onChange={(trim) => set({ trim })} />
        <Segmented label="Pages" value={opts.product.interior} options={INTERIORS} onChange={(interior) => set({ interior })} />
        <Segmented label="Binding" value={opts.product.binding} options={BINDINGS} onChange={(binding) => set({ binding })} />
        <Segmented label="Cover finish" value={opts.product.finish} options={FINISHES} onChange={(finish) => set({ finish })} />
      </div>
      <p className="hint">
        {productLabel(opts.product)}. {BINDINGS[opts.product.binding].label}s have {limits.minPages}–{limits.maxPages} pages; short books get blank Notes pages at the end.
        {plan && plan.gutterIn > 0 && ` At ${plan.totalPages} pages the inside margin grows by ${plan.gutterIn}″ so nothing disappears into the binding.`}
      </p>
      <label className="check">
        <input type="checkbox" checked={opts.contents} onChange={(e) => update({ contents: e.target.checked })} /> Contents page
      </label>
    </section>
  );
}

function CoverPanel({ opts, update, selected, media, plan }: { opts: BookOptions; update: (p: Partial<BookOptions>) => void; selected: Entry[]; media: Map<string, MediaMeta>; plan: PagePlan | null }) {
  const photos = useMemo(() => {
    const ids = new Set<string>();
    for (const e of selected) {
      if (e.cover.kind === 'photo') ids.add(e.cover.mediaId);
      for (const b of e.blocks) {
        if (b.type === 'photo') ids.add(b.mediaId);
        if (b.type === 'gallery') b.items.forEach((i) => ids.add(i.mediaId));
      }
    }
    return [...ids].filter((id) => PRINTABLE_IMAGE_TYPES.has(media.get(id)?.mime ?? '')).slice(0, 24);
  }, [selected, media]);
  const spineAllowed = !plan || plan.totalPages >= SPINE_TEXT_MIN_PAGES;
  return (
    <section className="panel" aria-labelledby="b-cover">
      <h2 id="b-cover">Cover</h2>
      <div className="cover-picker" role="group" aria-label="Cover colour">
        {GRADIENT_IDS.map((g) => (
          <button
            key={g}
            type="button"
            className="cover-swatch"
            style={{ backgroundImage: GRADIENTS[g].css }}
            aria-label={GRADIENTS[g].label}
            aria-pressed={opts.cover.kind === 'gradient' && opts.cover.gradient === g}
            onClick={() => update({ cover: { kind: 'gradient', gradient: g } })}
          />
        ))}
      </div>
      {photos.length > 0 && (
        <>
          <p className="hint">Or use one of this book's photos on the front:</p>
          <div className="photo-picker" role="group" aria-label="Cover photo">
            {photos.map((id) => (
              <PhotoChoice key={id} id={id} name={media.get(id)?.name ?? 'Photo'} pressed={opts.cover.kind === 'photo' && opts.cover.mediaId === id} onPick={() => update({ cover: { kind: 'photo', mediaId: id } })} />
            ))}
          </div>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={opts.spineText && spineAllowed} disabled={!spineAllowed} onChange={(e) => update({ spineText: e.target.checked })} aria-describedby={spineAllowed ? undefined : 'spine-hint'} /> Title on the spine
      </label>
      {!spineAllowed && (
        <p className="hint" id="spine-hint">
          Lulu leaves the spine blank on books of {SPINE_TEXT_MIN_PAGES - 1} pages or fewer, because the text would run onto the covers.
        </p>
      )}
    </section>
  );
}

function PhotoChoice({ id, name, pressed, onPick }: { id: string; name: string; pressed: boolean; onPick: () => void }) {
  const url = useMediaUrl(id);
  return (
    <button type="button" className="photo-choice" aria-pressed={pressed} aria-label={`Cover photo: ${name}`} onClick={onPick}>
      {url ? <img src={url} alt="" /> : <span aria-hidden="true">📷</span>}
    </button>
  );
}

/** The paginated interior and the cover, laid out with the same code and fonts as the print files. */
function Preview({ opts, selected, media, urls, onPlan }: { opts: BookOptions; selected: Entry[]; media: Map<string, MediaMeta>; urls: Map<string, string> | null; onPlan: (p: PagePlan | null) => void }) {
  const bookRef = useRef<HTMLIFrameElement>(null);
  const coverRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState<{ book: PreviewFrame; cover: PreviewFrame } | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [width, setWidth] = useState(800);
  const [page, setPage] = useState(0);
  const [coverHeight, setCoverHeight] = useState(0);

  useEffect(() => {
    if (bookRef.current && coverRef.current) setFrames({ book: new PreviewFrame(bookRef.current), cover: new PreviewFrame(coverRef.current) });
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = interiorGeometry(opts.product.trim, 0);
  const single = width < 620;
  const pagePx = geo.pageWidthIn * CSS_PX_PER_IN;
  const zoom = Math.min(1, Math.max(0.2, (width - 32) / (single ? pagePx : 2 * pagePx)));
  const view = useMemo(() => ({ zoom, single }), [zoom, single]);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => frames?.book.applyView(view), [frames, view]);

  useEffect(() => {
    if (!frames || !urls) return;
    if (selected.length === 0 || !opts.title.trim()) {
      setStatus({ kind: 'idle' });
      onPlan(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setStatus({ kind: 'working' });
        try {
          const mediaUrl = (id: string) => urls.get(id) ?? null;
          const doc = (gutterIn: number, notesPages: number) => interiorDocument({ options: opts, entries: selected, media, mediaUrl, gutterIn, notesPages, preview: true });
          let shown: number | null = null;
          const plan = await planPages(
            async (g) => {
              shown = g;
              return frames.book.paginate(doc(g, 0), viewRef.current);
            },
            pageLimits(opts.product),
            4 + Math.ceil(selected.length * 1.5),
          );
          if (plan.notesPages > 0 || shown !== plan.gutterIn) await frames.book.paginate(doc(plan.gutterIn, plan.notesPages), viewRef.current);
          if (cancelled) return;
          // Paperback covers match Lulu's formula; hardcover wraps are sized by Lulu, so this is an approximation.
          const dims = estimateCoverDimensions(opts.product, plan.totalPages) ?? estimateCoverDimensions({ ...opts.product, binding: 'paperback' }, plan.totalPages)!;
          const cover = coverDocument({ options: opts, entries: selected, media, mediaUrl, pageCount: plan.totalPages, dims });
          const coverZoom = Math.min(1, (width - 32) / ((dims.widthIn + 0.3) * CSS_PX_PER_IN));
          await frames.cover.show(cover, coverZoom);
          setCoverHeight(Math.ceil((dims.heightIn * CSS_PX_PER_IN + 24) * coverZoom + 8));
          if (cancelled) return;
          setStatus({ kind: 'ready', plan });
          onPlan(plan);
          setPage(0);
          bookRef.current?.contentWindow?.addEventListener('scroll', () => setPage(frames.book.firstVisiblePage()), { passive: true });
        } catch (err) {
          if (err instanceof SupersededError || cancelled) return;
          setStatus({ kind: 'error', message: err instanceof PageCountError ? err.message : `The preview couldn't be laid out: ${(err as Error).message}` });
          onPlan(null);
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The cover's zoom follows `width`, but a resize alone shouldn't re-run the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, urls, opts, selected, media, onPlan]);

  const total = status.kind === 'ready' ? status.plan.totalPages : 0;
  const spreadStart = (i: number) => (single || i === 0 ? i : i % 2 === 1 ? i : i - 1);
  const go = (dir: 1 | -1) => {
    if (!frames) return;
    const cur = spreadStart(frames.book.firstVisiblePage());
    const next = single ? cur + dir : dir > 0 ? (cur === 0 ? 1 : cur + 2) : cur <= 1 ? 0 : cur - 2;
    const clamped = Math.max(0, Math.min(total - 1, next));
    frames.book.scrollToPage(clamped);
    setPage(clamped);
  };
  const pageLabel = single || page === 0 || page + 1 >= total ? `Page ${page + 1}` : `Pages ${page + 1}–${page + 2}`;

  return (
    <section className="panel preview-panel" aria-labelledby="b-preview">
      <h2 id="b-preview">Preview</h2>
      <p className="preview-status" role="status" data-testid="preview-status">
        {status.kind === 'idle' && (selected.length === 0 ? 'Choose some entries to see your book.' : 'Give the book a title to see it.')}
        {status.kind === 'working' && 'Laying out pages…'}
        {status.kind === 'ready' && `${status.plan.totalPages} pages${status.plan.notesPages ? `, including ${status.plan.notesPages} blank Notes ${status.plan.notesPages === 1 ? 'page' : 'pages'}` : ''}`}
        {status.kind === 'error' && status.message}
      </p>
      <div className="preview-toolbar">
        <button type="button" className="btn btn-small" onClick={() => go(-1)} disabled={status.kind !== 'ready'} aria-label={single ? 'Previous page' : 'Previous spread'}>
          ←
        </button>
        <span aria-live="polite">{status.kind === 'ready' ? `${pageLabel} of ${total}` : ' '}</span>
        <button type="button" className="btn btn-small" onClick={() => go(1)} disabled={status.kind !== 'ready'} aria-label={single ? 'Next page' : 'Next spread'}>
          →
        </button>
      </div>
      <div ref={boxRef} className={`preview-box${status.kind === 'working' ? ' is-working' : ''}`}>
        <iframe ref={bookRef} className="preview-frame" title="Book preview" data-testid="book-frame" />
      </div>
      <h3>Cover</h3>
      <p className="hint">Back, spine and front, as one sheet. {opts.product.binding === 'hardcover' && 'Hardcover wraps are sized by Lulu, so this preview is approximate.'}</p>
      <iframe ref={coverRef} className="cover-frame" title="Cover preview" data-testid="cover-frame" style={coverHeight ? { height: coverHeight } : undefined} />
    </section>
  );
}

function WarningsPanel({ warnings }: { warnings: PrintWarning[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? warnings : warnings.slice(0, 8);
  return (
    <section className="panel" aria-labelledby="b-check">
      <h2 id="b-check">Print check</h2>
      {warnings.length === 0 ? (
        <p data-testid="print-check">✅ Every photo has enough detail for print (300 PPI or more where it's placed).</p>
      ) : (
        <>
          <p data-testid="print-check">
            {warnings.length} {warnings.length === 1 ? 'thing' : 'things'} to look at before printing. The book still prints; these may just not look their best.
          </p>
          <ul className="warning-list">
            {shown.map((w, i) => (
              <li key={`${w.mediaId}-${w.entryId}-${i}`}>
                {w.message}{' '}
                {w.entryId && (
                  <a href={href({ name: 'entry', id: w.entryId })} className="nowrap">
                    Open entry
                  </a>
                )}
              </li>
            ))}
          </ul>
          {warnings.length > shown.length && (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setAll(true)}>
              Show all {warnings.length}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function PrintFilesPanel({ opts, selected, imageIds, media, plan }: { opts: BookOptions; selected: Entry[]; imageIds: string[]; media: Map<string, MediaMeta>; plan: PagePlan | null }) {
  const { journal } = useJournal();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const photoBytes = imageIds.reduce((n, id) => n + (media.get(id)?.bytes ?? 0), 0);
  const ready = !!PRINT_API && !!plan && selected.length > 0 && !!opts.title.trim();

  const run = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      const files = await makePrintFiles(journal, opts);
      downloadBlob(files.zip, `${slugify(opts.title)}-print-files.zip`);
      toast(files.coverSource === 'estimate' ? `Print files ready: ${files.pages} pages. The cover size is an estimate, fine for checking.` : `Print files ready: ${files.pages} pages.`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="b-files">
      <h2 id="b-files">Print files</h2>
      <p>
        Lulu prints from two PDFs: the pages and the wraparound cover. Make them to check every page before you order. (Ordering and prices come next.)
      </p>
      {!PRINT_API && <p className="hint">Making print files isn't available on this site yet.</p>}
      <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => setConfirming(true)}>
        {busy ? 'Making print files…' : 'Make print PDFs'}
      </button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Send this book to the print server?"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void run()}>
              Send and make PDFs
            </button>
          </>
        }
      >
        <p>To make the PDFs, Logbook sends a copy of this book to its print server:</p>
        <ul>
          <li>
            the text, titles, tags and captions of {selected.length} {selected.length === 1 ? 'entry' : 'entries'}
            {journal.isEncrypted && ' (decrypted on this device first)'}
          </li>
          <li>
            {imageIds.length} {imageIds.length === 1 ? 'photo' : 'photos'} ({formatBytes(photoBytes)})
          </li>
          <li>the names and lengths of any videos, recordings and attached files, but never the files themselves</li>
        </ul>
        <p className="hint">They're used only to make these PDFs and aren't kept. Nothing else from your journal is sent.</p>
      </Dialog>
    </section>
  );
}

/** Screen-resolution object URLs for the book's photos, made once each and revoked when the builder closes. */
function usePreviewUrls(journal: Journal, ids: string[]): Map<string, string> | null {
  const cache = useRef(new Map<string, string>());
  const [urls, setUrls] = useState<Map<string, string> | null>(null);
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const id of key ? key.split(',') : []) {
        if (cache.current.has(id)) continue;
        const blob = await journal.getMediaBlob(id);
        if (!alive) return;
        if (blob) cache.current.set(id, URL.createObjectURL(await previewImage(blob)));
      }
      if (alive) setUrls(new Map(cache.current));
    })();
    return () => {
      alive = false;
    };
  }, [journal, key]);
  useEffect(() => {
    const c = cache.current;
    return () => {
      for (const u of c.values()) URL.revokeObjectURL(u);
      c.clear();
    };
  }, []);
  return urls;
}
