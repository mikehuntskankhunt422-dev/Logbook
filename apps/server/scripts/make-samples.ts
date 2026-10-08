/**
 * Generates the sample books in samples/: a ~40-page and a ~200-page journal, each as the bundle the
 * web app would upload, plus the interior PDF, cover PDF and render report.
 *
 *   npm run samples -w @logbook/server            (CHROMIUM_PATH=… if Playwright's Chromium isn't installed)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EstimatedCoverDimensions } from '../src/lulu.ts';
import { renderBook, type RenderedBook } from '../src/render/book.ts';
import { Renderer } from '../src/render/renderer.ts';
import { bundleZip, sampleBundle } from '../test/sample-journal.ts';

const OUT = path.resolve(import.meta.dirname, '../../../samples');
const TARGETS = [
  { name: 'sample-40', pages: 40, entries: 14, photoCover: false },
  { name: 'sample-200', pages: 200, entries: 85, photoCover: true },
];

const renderer = await Renderer.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  for (const t of TARGETS) {
    let entries = t.entries;
    let best: { out: RenderedBook; entries: number; zip: Uint8Array } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const bundle = await sampleBundle({ entries, photoCover: t.photoCover });
      const out = await renderBook(renderer, bundle, new EstimatedCoverDimensions());
      const off = out.plan.totalPages - t.pages;
      console.log(`${t.name}: ${entries} entries → ${out.plan.totalPages} pages (${out.plan.contentPages} content, gutter ${out.plan.gutterIn}″)`);
      if (!best || Math.abs(off) < Math.abs(best.out.plan.totalPages - t.pages)) best = { out, entries, zip: bundleZip(bundle) };
      if (off === 0) break;
      // Notes pages pad short books, so only overshooting needs fewer entries.
      const perEntry = out.plan.contentPages / entries;
      entries = Math.max(1, entries + Math.round((t.pages - out.plan.contentPages) / perEntry) - (off > 0 ? 1 : 0));
      if (entries === best.entries) break;
    }
    const dir = path.join(OUT, t.name);
    await mkdir(dir, { recursive: true });
    const { out } = best!;
    await writeFile(path.join(dir, 'interior.pdf'), out.interiorPdf);
    await writeFile(path.join(dir, 'cover.pdf'), out.coverPdf);
    await writeFile(path.join(dir, 'bundle.zip'), best!.zip);
    const report = { entries: best!.entries, podPackageId: out.podPackageId, plan: out.plan, cover: out.cover, warnings: out.warnings.map((w) => w.message), timingsMs: out.timingsMs };
    await writeFile(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`${t.name}: wrote ${out.plan.totalPages} pages to ${path.relative(process.cwd(), dir)}`);
  }
} finally {
  await renderer.close();
}
