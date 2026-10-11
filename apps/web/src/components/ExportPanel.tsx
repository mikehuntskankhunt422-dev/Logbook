import { useEffect, useMemo, useRef, useState } from 'react';
import { ExportTooLargeError, LockedError, referencedMediaIds } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { useToast } from '../app/toasts.tsx';
import { exportToFile, printEntries, releasePrintView, type ExportChoice } from '../lib/export-io.ts';
import { isDesktop } from '../lib/platform.ts';

const FORMATS: { id: ExportChoice; label: string; about: string }[] = [
  { id: 'markdown', label: 'Markdown', about: 'Text with headings, lists and links, for notes apps such as Obsidian, or any text editor.' },
  { id: 'text', label: 'Plain text', about: 'Just the words: titles, dates, moods, tags and what you wrote. Photos are named, not included.' },
  { id: 'html', label: 'Web page', about: 'One page with your writing, photos, videos and recordings, to open in any browser.' },
  { id: 'pdf', label: 'PDF', about: 'Your entries laid out for paper, with photos. Logbook opens the print window: choose “Save as PDF” there.' },
];

/** Settings → Export: entries as documents to read or keep elsewhere (D89). Not a backup. */
export function ExportPanel() {
  const { journal, entries } = useJournal();
  const toast = useToast();
  const [format, setFormat] = useState<ExportChoice>('markdown');
  const [layout, setLayout] = useState<'one-file' | 'per-entry'>('one-file');
  const [includeMedia, setIncludeMedia] = useState(true);
  const dates = useMemo(() => entries.map((e) => e.date).sort(), [entries]);
  const years = useMemo(() => [...new Set(dates.map((d) => d.slice(0, 4)))].sort().reverse(), [dates]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const from = range?.from ?? dates[0] ?? '';
  const to = range?.to ?? dates.at(-1) ?? '';
  const chosen = useMemo(() => entries.filter((e) => e.date >= from && e.date <= to), [entries, from, to]);
  const [busy, setBusy] = useState(false);
  const run$ = useRef<AbortController | null>(null);

  // Leaving Settings stops an export that's still being prepared; the print layout goes once
  // anything still printing has had time to finish (export-io.ts).
  useEffect(
    () => () => {
      run$.current?.abort();
      releasePrintView();
    },
    [],
  );

  if (!entries.length) {
    return (
      <section className="panel" aria-labelledby="export-h">
        <h2 id="export-h">Export</h2>
        <p>Once you've written something, you can export it here as Markdown, plain text, a web page or a PDF.</p>
      </section>
    );
  }

  const run = async () => {
    const controller = new AbortController();
    run$.current = controller;
    setBusy(true);
    try {
      const r = format === 'pdf' ? await printEntries(journal, chosen, controller.signal) : await exportToFile(journal, chosen, { format, layout, includeMedia }, controller.signal);
      if (!r.saved) return;
      const what = `${r.entries} ${r.entries === 1 ? 'entry' : 'entries'}`;
      const missing = r.mediaMissing ? ` ${r.mediaMissing} ${r.mediaMissing === 1 ? 'file' : 'files'} couldn't be read (still syncing?) and ${r.mediaMissing === 1 ? 'was' : 'were'} left out.` : '';
      toast(format === 'pdf' ? `${what} ready to print.${missing}` : `Exported ${what}.${missing}`, undefined, missing ? 8000 : 5000);
    } catch (err) {
      if (err instanceof LockedError) toast('Logbook locked before the export was finished, so nothing was saved. Unlock it and export again.', undefined, 8000);
      else if (err instanceof ExportTooLargeError) toast(err.message, undefined, 10000);
      else toast(`Couldn't export: ${err instanceof Error ? err.message : String(err)}`, undefined, 8000);
    } finally {
      if (run$.current === controller) run$.current = null;
      setBusy(false);
    }
  };

  const about = FORMATS.find((f) => f.id === format)!.about;
  // A zip only when there's more than one file to put in it: media to go with the documents, or a
  // Markdown file for each of several entries.
  const withMedia = (format === 'markdown' || format === 'html') && includeMedia && chosen.some((e) => referencedMediaIds(e).length > 0);
  const severalFiles = format === 'markdown' && layout === 'per-entry' && chosen.length > 1;

  return (
    <section className="panel" aria-labelledby="export-h">
      <h2 id="export-h">Export</h2>
      <p>Your entries as documents to read, print or use in other apps. To keep a copy you can restore into Logbook, make a backup instead.</p>

      <div className="segmented" role="group" aria-label="Export format">
        {FORMATS.map((f) => (
          <button key={f.id} type="button" aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <p className="hint">{about}</p>

      <div className="row presets" role="group" aria-label="Which entries">
        <button type="button" className="btn btn-small" aria-pressed={!range} onClick={() => setRange(null)}>
          Everything
        </button>
        {years.map((y) => (
          <button key={y} type="button" className="btn btn-small" aria-pressed={range?.from === `${y}-01-01` && range.to === `${y}-12-31`} onClick={() => setRange({ from: `${y}-01-01`, to: `${y}-12-31` })}>
            {y}
          </button>
        ))}
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="export-from">From</label>
          <input id="export-from" type="date" className="date-input" value={from} max={to} onChange={(e) => e.target.value && setRange({ from: e.target.value, to })} />
        </div>
        <div className="field">
          <label htmlFor="export-to">To</label>
          <input id="export-to" type="date" className="date-input" value={to} min={from} onChange={(e) => e.target.value && setRange({ from, to: e.target.value })} />
        </div>
      </div>

      {format === 'markdown' && (
        <div className="segmented" role="group" aria-label="Markdown files" style={{ marginTop: 10 }}>
          <button type="button" aria-pressed={layout === 'one-file'} onClick={() => setLayout('one-file')}>
            All in one file
          </button>
          <button type="button" aria-pressed={layout === 'per-entry'} onClick={() => setLayout('per-entry')}>
            A file per entry
          </button>
        </div>
      )}
      {(format === 'markdown' || format === 'html') && (
        <label className="row" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} /> Include photos, videos, recordings and files
        </label>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-primary" disabled={busy || !chosen.length} onClick={() => void run()}>
          {busy ? 'Preparing…' : format === 'pdf' ? '🖨️ Print or save as PDF…' : `${isDesktop ? '💾 Export' : '⬇️ Download'} ${chosen.length} ${chosen.length === 1 ? 'entry' : 'entries'}${isDesktop ? '…' : ''}`}
        </button>
      </div>
      <p className="hint">
        {!chosen.length
          ? 'No entries between those dates.'
          : format === 'pdf'
            ? `${chosen.length} ${chosen.length === 1 ? 'entry' : 'entries'}. In the print window, pick “Save as PDF” (on Windows, “Microsoft Print to PDF”) as the printer.`
            : withMedia
              ? 'A .zip file: unzip it to get the documents and a media folder they link to.'
              : severalFiles
                ? 'A .zip file with a Markdown file for each entry.'
                : 'A single file.'}
        {journal.isEncrypted && ' Exported files aren’t protected by your passcode: anyone with the file can read it.'}
      </p>
    </section>
  );
}
