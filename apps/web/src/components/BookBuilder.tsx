import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BINDINGS,
  FINISHES,
  GRADIENTS,
  GRADIENT_IDS,
  INTERIORS,
  SPINE_TEXT_MIN_PAGES,
  TRIMS,
  bookOptionsSchema,
  formatDateRange,
  imageWarnings,
  pageGeometry,
  pageLimits,
  printMediaPlan,
  productLabel,
  selectEntries,
  today,
  type BookOptions,
  type Entry,
  type MediaMeta,
  type PaginationPlan,
  type Product,
} from '@logbook/core';
import { useJournal, useMediaUrl } from '../app/journal-context.tsx';
import { href } from '../app/router.ts';
import { BookPreview, PreviewCancelled, PreviewImages, coverPreviewDocument, spreadStarts } from '../lib/book-preview.ts';
import { fetchBookPrice, fetchCoverDimensions } from '../lib/api.ts';
import { formatLongDate } from './common.tsx';

type Step = 'entries' | 'product' | 'cover' | 'options' | 'preview';
const STEPS: { id: Step; label: string }[] = [
  { id: 'entries', label: 'Entries' },
  { id: 'product', label: 'Size & paper' },
  { id: 'cover', label: 'Cover' },
  { id: 'options', label: 'Layout' },
  { id: 'preview', label: 'Preview' },
];

/** The book builder (M2 slice C). Everything happens on this device; nothing is uploaded. */
export function BookBuilder() {
  const { journal, entries, loaded } = useJournal();
  const [options, setOptions] = useState<BookOptions | null>(null);
  const [media, setMedia] = useState<Map<string, MediaMeta>>(new Map());
  const [step, setStep] = useState<Step>('entries');
  const [preview, setPreview] = useState<{ plan: PaginationPlan; key: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);

  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    void journal.getBookDraft().then((draft) => alive && setOptions((o) => o ?? draft ?? defaultOptions(entries)));
    return () => {
      alive = false;
    };
  }, [journal, loaded, entries]);

  useEffect(() => {
    let alive = true;
    void journal.listMediaMeta().then((list) => alive && setMedia(new Map(list.map((m) => [m.id, m]))));
    return () => {
      alive = false;
    };
  }, [journal, entries]);

  // Keep the draft (D40), sealed like an entry when a passcode is on.
  useEffect(() => {
    if (!options) return;
    const t = setTimeout(() => void journal.saveBookDraft(options), 400);
    return () => clearTimeout(t);
  }, [journal, options]);

  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const selected = useMemo(() => (options ? selectEntries(entries, options.selection) : []), [entries, options]);
  const files = useMemo(() => (options ? printMediaPlan(selected, options, (id) => media.get(id)).files : []), [selected, options, media]);
  /** Identifies what a preview was made from, so a stale page count is never shown as current. */
  const key = useMemo(() => JSON.stringify([options, selected.map((e) => [e.id, e.rev])]), [options, selected]);
  const plan = preview?.key === key ? preview.plan : null;

  if (!loaded || !options) return <p className="muted">Opening your journal…</p>;
  if (!entries.length) {
    return (
      <div className="empty">
        <div className="big" aria-hidden="true">
          📖
        </div>
        <h1>Make a book</h1>
        <p>Write a few entries first. Then you can turn them into a printed book.</p>
        <a className="btn btn-primary" href={href({ name: 'new' })}>
          Write an entry
        </a>
      </div>
    );
  }

  const update = (patch: Partial<BookOptions>) => setOptions((o) => (o ? { ...o, ...patch } : o));
  const index = STEPS.findIndex((s) => s.id === step);
  const current = STEPS[index]!;

  return (
    <div className="book-builder">
      <h1>Make a book</h1>
      <p className="muted">Turn your entries into a printed book. Everything here happens on this device; nothing is uploaded.</p>

      <nav className="steps" aria-label="Book steps">
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button type="button" aria-current={s.id === step ? 'step' : undefined} onClick={() => setStep(s.id)}>
                <span className="step-n" aria-hidden="true">
                  {i + 1}
                </span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <p className="book-summary" aria-live="polite">
        {selected.length} {selected.length === 1 ? 'entry' : 'entries'} · {files.length} {files.length === 1 ? 'picture' : 'pictures'} · {productLabel(options.product)}
        {plan && ` · ${plan.pages} pages`}
      </p>

      <section className="panel" aria-labelledby="step-h">
        <h2 id="step-h" tabIndex={-1} ref={heading}>
          {current.label}
        </h2>
        {step === 'entries' && <EntriesStep options={options} entries={entries} selected={selected} update={update} />}
        {step === 'product' && <ProductStep product={options.product} update={(p) => update({ product: { ...options.product, ...p } })} />}
        {step === 'cover' && <CoverStep options={options} files={files} media={media} plan={plan} update={update} />}
        {step === 'options' && <OptionsStep options={options} update={update} />}
        {/* Stays mounted so a finished preview survives a visit to another step. */}
        <div hidden={step !== 'preview'}>
          <PreviewStep visible={step === 'preview'} options={options} selected={selected} media={media} files={files} previewKey={key} plan={preview?.plan ?? null} onPlan={(p) => setPreview({ plan: p, key })} />
        </div>
      </section>

      <div className="row step-nav">
        {index > 0 && (
          <button type="button" className="btn" onClick={() => setStep(STEPS[index - 1]!.id)}>
            ← {STEPS[index - 1]!.label}
          </button>
        )}
        {index < STEPS.length - 1 && (
          <button type="button" className="btn btn-primary" onClick={() => setStep(STEPS[index + 1]!.id)} disabled={!selected.length}>
            {STEPS[index + 1]!.label} →
          </button>
        )}
      </div>
    </div>
  );
}

function defaultOptions(entries: Entry[]): BookOptions {
  const dates = entries.map((e) => e.date).sort();
  return bookOptionsSchema.parse({ selection: { kind: 'range', from: dates[0] ?? today(), to: dates.at(-1) ?? today() } });
}

// ── 1. entries ───────────────────────────────────────────────────────────────────────────────────

function EntriesStep({ options, entries, selected, update }: { options: BookOptions; entries: Entry[]; selected: Entry[]; update: (p: Partial<BookOptions>) => void }) {
  const sel = options.selection;
  const dates = useMemo(() => entries.map((e) => e.date).sort(), [entries]);
  const years = useMemo(() => [...new Set(dates.map((d) => d.slice(0, 4)))].sort().reverse(), [dates]);
  const oldestFirst = useMemo(() => [...entries].sort((a, b) => a.date.localeCompare(b.date)), [entries]);
  const picked = sel.kind === 'picked' ? new Set(sel.ids) : null;
  const setRange = (from: string, to: string) => update({ selection: { kind: 'range', from, to } });

  return (
    <>
      <div className="segmented" role="group" aria-label="Choose entries">
        <button type="button" aria-pressed={sel.kind === 'range'} onClick={() => sel.kind !== 'range' && setRange(dates[0]!, dates.at(-1)!)}>
          By date
        </button>
        <button type="button" aria-pressed={sel.kind === 'picked'} onClick={() => sel.kind !== 'picked' && update({ selection: { kind: 'picked', ids: selected.map((e) => e.id) } })}>
          Pick entries
        </button>
      </div>

      {sel.kind === 'range' ? (
        <>
          <div className="row presets" role="group" aria-label="Quick ranges">
            <button type="button" className="btn btn-small" onClick={() => setRange(dates[0]!, dates.at(-1)!)}>
              Everything
            </button>
            {years.map((y) => (
              <button key={y} type="button" className="btn btn-small" onClick={() => setRange(`${y}-01-01`, `${y}-12-31`)}>
                {y}
              </button>
            ))}
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="book-from">From</label>
              <input id="book-from" type="date" className="date-input" value={sel.from} max={sel.to} onChange={(e) => e.target.value && setRange(e.target.value, sel.to)} />
            </div>
            <div className="field">
              <label htmlFor="book-to">To</label>
              <input id="book-to" type="date" className="date-input" value={sel.to} min={sel.from} onChange={(e) => e.target.value && setRange(sel.from, e.target.value)} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <button type="button" className="btn btn-small" onClick={() => update({ selection: { kind: 'picked', ids: entries.map((e) => e.id) } })}>
              Select all
            </button>
            <button type="button" className="btn btn-small" onClick={() => update({ selection: { kind: 'picked', ids: [] } })}>
              Clear
            </button>
          </div>
          <ul className="pick-list">
            {oldestFirst.map((e) => (
              <li key={e.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked!.has(e.id)}
                    onChange={(ev) => update({ selection: { kind: 'picked', ids: ev.target.checked ? [...picked!, e.id] : [...picked!].filter((id) => id !== e.id) } })}
                  />
                  <span className="pick-date">{formatLongDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span>{e.title || 'Untitled'}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hint">
        {selected.length
          ? `${selected.length} ${selected.length === 1 ? 'entry' : 'entries'}, ${formatDateRange(selected[0]!.date, selected.at(-1)!.date)}.`
          : 'No entries chosen yet.'}
      </p>
    </>
  );
}

// ── 2. product ───────────────────────────────────────────────────────────────────────────────────

function Choice<K extends string>({ legend, value, options, onChange, hint }: { legend: string; value: K; options: Record<K, { label: string }>; onChange: (v: K) => void; hint?: string }) {
  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
      <div className="segmented" role="group" aria-label={legend}>
        {(Object.keys(options) as K[]).map((k) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
            {options[k].label}
          </button>
        ))}
      </div>
      {hint && <p className="hint">{hint}</p>}
    </fieldset>
  );
}

function ProductStep({ product, update }: { product: Product; update: (p: Partial<Product>) => void }) {
  const limits = pageLimits(product);
  return (
    <>
      <Choice legend="Size" value={product.trim} options={TRIMS} onChange={(trim) => update({ trim })} hint="6 × 9 in is a classic journal; 8.5 × 11 in gives photos more room." />
      <Choice legend="Pages" value={product.interior} options={INTERIORS} onChange={(interior) => update({ interior })} hint="Premium colour is printed on heavier coated paper, best for photos." />
      <Choice legend="Binding" value={product.binding} options={BINDINGS} onChange={(binding) => update({ binding })} hint={`${BINDINGS[product.binding].label}s have ${limits.min}–${limits.max} pages.`} />
      <Choice legend="Cover finish" value={product.finish} options={FINISHES} onChange={(finish) => update({ finish })} />
    </>
  );
}

// ── 3. cover ─────────────────────────────────────────────────────────────────────────────────────

function CoverStep({ options, files, media, plan, update }: { options: BookOptions; files: string[]; media: Map<string, MediaMeta>; plan: PaginationPlan | null; update: (p: Partial<BookOptions>) => void }) {
  const photos = files.filter((id) => !media.get(id)?.derivedFrom).slice(0, 24);
  const spineDisabled = plan !== null && plan.pages < SPINE_TEXT_MIN_PAGES;
  return (
    <>
      <div className="field">
        <label htmlFor="book-title">Title</label>
        <input id="book-title" className="text-input" value={options.title} maxLength={120} onChange={(e) => update({ title: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="book-subtitle">Subtitle</label>
        <input id="book-subtitle" className="text-input" value={options.subtitle} maxLength={200} onChange={(e) => update({ subtitle: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="book-author">Author</label>
        <input id="book-author" className="text-input" value={options.author} maxLength={120} onChange={(e) => update({ author: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="book-back">Back cover text</label>
        <textarea id="book-back" className="text-input" rows={3} value={options.backText} maxLength={1000} onChange={(e) => update({ backText: e.target.value })} />
      </div>
      <fieldset className="choice">
        <legend>Front cover</legend>
        <div className="cover-picker" role="group" aria-label="Colour covers">
          {GRADIENT_IDS.map((g) => (
            <button
              key={g}
              type="button"
              className="cover-swatch"
              style={{ backgroundImage: GRADIENTS[g].css }}
              aria-label={`${GRADIENTS[g].label} colour`}
              aria-pressed={options.cover.kind === 'gradient' && options.cover.gradient === g}
              onClick={() => update({ cover: { kind: 'gradient', gradient: g } })}
            />
          ))}
        </div>
        {photos.length > 0 && (
          <div className="cover-photos" role="group" aria-label="Photo covers">
            {photos.map((id) => (
              <CoverPhoto key={id} id={id} name={media.get(id)?.name ?? 'photo'} pressed={options.cover.kind === 'photo' && options.cover.mediaId === id} onPick={() => update({ cover: { kind: 'photo', mediaId: id } })} />
            ))}
          </div>
        )}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={options.spineText && !spineDisabled} disabled={spineDisabled} onChange={(e) => update({ spineText: e.target.checked })} />
        Print the title on the spine
      </label>
      <p className="hint">{spineDisabled ? `Spines are too narrow for text below ${SPINE_TEXT_MIN_PAGES} pages; this book has ${plan!.pages}.` : `Only on books of ${SPINE_TEXT_MIN_PAGES} pages or more.`}</p>
    </>
  );
}

function CoverPhoto({ id, name, pressed, onPick }: { id: string; name: string; pressed: boolean; onPick: () => void }) {
  const url = useMediaUrl(id);
  return (
    <button type="button" className="cover-photo" aria-pressed={pressed} aria-label={`Use ${name} as the cover`} onClick={onPick}>
      {url && <img src={url} alt="" />}
    </button>
  );
}

// ── 4. layout options ────────────────────────────────────────────────────────────────────────────

function OptionsStep({ options, update }: { options: BookOptions; update: (p: Partial<BookOptions>) => void }) {
  return (
    <>
      <div className="segmented" role="group" aria-label="Where entries start">
        <button type="button" aria-pressed={options.entryStart === 'new-page'} onClick={() => update({ entryStart: 'new-page' })}>
          Each entry on a new page
        </button>
        <button type="button" aria-pressed={options.entryStart === 'flow'} onClick={() => update({ entryStart: 'flow' })}>
          Run entries together
        </button>
      </div>
      <p className="hint">Running entries together uses fewer pages, so the book costs less.</p>
      <label className="check">
        <input type="checkbox" checked={options.contents} onChange={(e) => update({ contents: e.target.checked })} />
        Contents page
      </label>
      <label className="check">
        <input type="checkbox" checked={options.monthDividers} onChange={(e) => update({ monthDividers: e.target.checked })} />
        A divider page for each month
      </label>
    </>
  );
}

// ── 5. preview ───────────────────────────────────────────────────────────────────────────────────

function PreviewStep({
  visible,
  options,
  selected,
  media,
  files,
  previewKey,
  plan,
  onPlan,
}: {
  visible: boolean;
  options: BookOptions;
  selected: Entry[];
  media: Map<string, MediaMeta>;
  files: string[];
  previewKey: string;
  plan: PaginationPlan | null;
  onPlan: (p: PaginationPlan) => void;
}) {
  const { journal } = useJournal();
  const frame = useRef<HTMLIFrameElement>(null);
  const coverFrame = useRef<HTMLIFrameElement>(null);
  const preview = useRef<BookPreview | null>(null);
  const images = useMemo(() => new PreviewImages(journal), [journal]);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [renderedKey, setRenderedKey] = useState('');
  const [spread, setSpread] = useState(0);
  const [single, setSingle] = useState(() => matchMedia('(max-width: 640px)').matches);
  const [coverExact, setCoverExact] = useState(false);
  const [priceCents, setPriceCents] = useState<number | null>(null);
  const runs = useRef(0);
  const stale = status === 'done' && previewKey !== renderedKey;

  useEffect(() => () => images.dispose(), [images]);
  useEffect(() => {
    const mq = matchMedia('(max-width: 640px)');
    const on = () => setSingle(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const pages = status === 'done' ? (plan?.pages ?? 0) : 0;
  const starts = useMemo(() => spreadStarts(pages, single), [pages, single]);
  const first = starts[Math.min(spread, starts.length - 1)] ?? 1;
  const count = single || first === 1 ? 1 : Math.min(2, pages - first + 1);

  useEffect(() => {
    if (status !== 'done' || !visible) return;
    const show = () => preview.current?.show(first, count);
    show();
    window.addEventListener('resize', show);
    return () => window.removeEventListener('resize', show);
  }, [status, first, count, visible]);

  // Layout needs a visible frame; leaving the step mid-layout cancels it.
  useEffect(() => {
    if (!visible && status === 'running') preview.current?.cancel();
  }, [visible, status]);

  const gutter = plan?.gutterIn ?? 0;
  const warnings = useMemo(() => imageWarnings(selected, options, (id) => media.get(id), pageGeometry(options.product.trim, gutter)), [selected, options, media, gutter]);

  const run = async () => {
    if (!frame.current) return;
    preview.current ??= new BookPreview(frame.current);
    const thisRun = ++runs.current;
    setStatus('running');
    setSpread(0);
    setPriceCents(null);
    try {
      if (files.length) setMessage(`Preparing pictures (0 of ${files.length})…`);
      const urls = await images.urls(files, (n) => setMessage(`Preparing pictures (${n} of ${files.length})…`));
      const result = await preview.current.render({ options, entries: selected, meta: (id) => media.get(id), images: urls, printedOn: today() }, setMessage);
      onPlan(result);
      setRenderedKey(previewKey);
      setStatus('done');
      setMessage(`Preview ready: ${result.pages} pages.`);
      const front = options.cover.kind === 'photo' ? urls.get(options.cover.mediaId) : undefined;
      // The estimate shows at once; Lulu's exact size replaces it when the API answers (D39).
      setCoverExact(false);
      if (coverFrame.current) coverFrame.current.srcdoc = coverPreviewDocument(options, selected, result.pages, front).html;
      void fetchCoverDimensions(options.product, result.pages).then((dims) => {
        if (!dims || thisRun !== runs.current || !coverFrame.current) return;
        coverFrame.current.srcdoc = coverPreviewDocument(options, selected, result.pages, front, dims).html;
        setCoverExact(true);
      });
      // A price estimate from the printer's current cost (M3); none offline.
      if (!result.tooMany) void fetchBookPrice(options.product, result.pages).then((cents) => thisRun === runs.current && setPriceCents(cents));
    } catch (err) {
      if (err instanceof PreviewCancelled) {
        setStatus('idle');
        setMessage('Preview cancelled.');
      } else {
        setStatus('error');
        setMessage(`The preview failed: ${(err as Error).message}`);
      }
    }
  };

  const fitCover = () => {
    const f = coverFrame.current;
    const d = f?.contentDocument;
    if (!f || !d?.body) return;
    const width = d.body.offsetWidth || 1;
    d.documentElement.style.setProperty('zoom', String(Math.min(1, (f.clientWidth - 16) / width)));
    f.style.height = `${Math.ceil(d.body.offsetHeight * Math.min(1, (f.clientWidth - 16) / width)) + 16}px`;
  };

  const limits = pageLimits(options.product);
  const label = count === 2 ? `Pages ${first}–${first + 1} of ${pages}` : `Page ${first} of ${pages}`;

  return (
    <>
      <p>See every page before anything is printed. The preview is made on this device.</p>
      <div className="row">
        {status === 'running' ? (
          <button type="button" className="btn" onClick={() => preview.current?.cancel()}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={!selected.length}>
            {status === 'done' ? 'Update preview' : 'Make preview'}
          </button>
        )}
        {stale && <span className="hint">You've changed the book since this preview.</span>}
      </div>
      <p className="hint" role="status" aria-live="polite">
        {message}
      </p>

      {status === 'done' && plan && (
        <div className="preview-facts">
          <p>
            <strong>{plan.pages} pages</strong>, {productLabel(options.product)}.
            {plan.notesPages > 0 && ` Includes ${plan.notesPages} blank Notes ${plan.notesPages === 1 ? 'page' : 'pages'}: ${plan.laidOut < limits.min ? `${BINDINGS[options.product.binding].label}s need at least ${limits.min} pages` : 'printed books need an even page count'}.`}
          </p>
          {plan.tooMany && (
            <p className="notice notice-warn" role="alert">
              This book needs {plan.pages} pages and Lulu prints at most {limits.max}. Choose a shorter date range or fewer entries.
            </p>
          )}
          {priceCents !== null && !stale && (
            <p className="book-price">
              About <strong>{formatUsd(priceCents)}</strong> plus shipping and any tax, from the printer's current cost. You see the final price with your proof.
            </p>
          )}
          <p className="hint">The print file is laid out the same way, so the page count usually matches, but browsers and browser versions can differ by a page or two. You approve the exact print file before paying. Ordering is coming soon.</p>
        </div>
      )}

      <div
        className="book-viewer"
        tabIndex={status === 'done' ? 0 : -1}
        aria-label="Book preview pages"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setSpread((s) => Math.min(starts.length - 1, s + 1));
          if (e.key === 'ArrowLeft') setSpread((s) => Math.max(0, s - 1));
        }}
      >
        <iframe ref={frame} className="book-frame" title="Book preview" data-state={status} />
      </div>
      {status === 'done' && pages > 0 && (
        <div className="row viewer-controls">
          <button type="button" className="btn btn-small" onClick={() => setSpread((s) => Math.max(0, s - 1))} disabled={spread === 0}>
            ← Previous
          </button>
          <label className="page-slider">
            <span className="sr-only">Go to page</span>
            <input type="range" min={0} max={starts.length - 1} value={Math.min(spread, starts.length - 1)} onChange={(e) => setSpread(Number(e.target.value))} aria-valuetext={label} />
          </label>
          <button type="button" className="btn btn-small" onClick={() => setSpread((s) => Math.min(starts.length - 1, s + 1))} disabled={spread >= starts.length - 1}>
            Next →
          </button>
          <span className="muted" aria-live="polite">
            {label}
          </span>
        </div>
      )}

      <div hidden={status !== 'done'}>
        <h3>Cover</h3>
        <iframe ref={coverFrame} className="cover-frame" title="Cover preview" onLoad={fitCover} />
        <p className="hint">
          {coverExact ? "Back, spine and front, at the printer's exact size for this page count." : 'Back, spine and front. The spine width is approximate until the print file is made.'}
          {options.product.binding === 'hardcover' && ' The outer edge wraps around the boards.'}
        </p>
      </div>

      <Warnings warnings={warnings} />
    </>
  );
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' }).format(cents / 100) + (navigator.language.startsWith('en-US') ? '' : ' USD');
}

function Warnings({ warnings }: { warnings: ReturnType<typeof imageWarnings> }) {
  if (!warnings.length) return null;
  return (
    <section className="notice notice-warn book-warnings" aria-labelledby="warn-h">
      <h3 id="warn-h">
        {warnings.length} {warnings.length === 1 ? 'picture' : 'pictures'} may print blurry
      </h3>
      <p>Printed photos look sharp at 300 pixels per inch or more. These are below that at their size in the book:</p>
      <ul>
        {warnings.map((w, i) => (
          <li key={`${w.mediaId}-${i}`}>
            <strong>{w.name}</strong> — {w.ppi === null ? 'size unknown' : `${w.ppi} PPI`} ({w.where})
            {w.entryId && (
              <>
                {' '}
                in <a href={href({ name: 'entry', id: w.entryId })}>{w.entryTitle || formatLongDate(w.entryDate!, { day: 'numeric', month: 'short', year: 'numeric' })}</a>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
