import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  estimateCoverDimensions,
  formatDateRange,
  imageWarnings,
  pageGeometry,
  podPackageId,
  selectEntries,
  type CoverDimensions,
  type ImageWarning,
} from '@logbook/core';
import { renderCover, type CoverResult } from '../render/cover.ts';
import { preparePrintImages } from '../render/images.ts';
import { renderInterior, type InteriorResult } from '../render/interior.ts';
import { inspectPdf, type PdfReport } from '../render/pdf.ts';
import { generateSample, type SampleKind } from './generate.ts';
import { SAMPLE_PRODUCTS, type SampleProductId } from './products.ts';

export { SAMPLE_PRODUCTS, type SampleProductId };

export interface SampleBuild {
  kind: SampleKind;
  product: SampleProductId;
  podPackageId: string;
  interior: Omit<InteriorResult, 'pdf'>;
  cover: Omit<CoverResult, 'pdf'>;
  coverApproximate: boolean;
  interiorReport: PdfReport;
  coverReport: PdfReport;
  warnings: ImageWarning[];
  files: { interior: string; cover: string };
}

/**
 * Generates a sample journal, prepares its images, renders interior and cover, inspects both PDFs
 * and writes everything to `outDir`. `coverDims` gives Lulu's size (live, or recorded for CI); when
 * it has none, the cover uses the offline estimate and is marked approximate.
 */
export async function buildSampleBook(
  kind: SampleKind,
  productId: SampleProductId,
  outDir: string,
  opts: { coverDims?: (podPackageId: string, pages: number) => Promise<CoverDimensions | undefined> } = {},
): Promise<SampleBuild> {
  await mkdir(outDir, { recursive: true });
  const product = SAMPLE_PRODUCTS[productId];
  const sample = await generateSample(kind, product);
  const entries = selectEntries(sample.entries, sample.options.selection);
  const meta = (id: string) => sample.media.get(id);
  const images = await preparePrintImages({ entries, options: sample.options, meta, source: async (id) => sample.files.get(id) }, join(outDir, 'images'));

  const interior = await renderInterior({
    options: sample.options,
    entries,
    meta,
    images: new Map([...images].map(([id, img]) => [id, img.path])),
    audioPeaks: sample.audioPeaks,
    printedOn: '2026-10-07',
  });

  const pod = podPackageId(product);
  const pages = interior.plan.pages;
  const lulu = await opts.coverDims?.(pod, pages);
  const dims = lulu ?? estimateCoverDimensions(product, pages);
  const coverApproximate = !lulu;
  const frontId = sample.options.cover.kind === 'photo' ? sample.options.cover.mediaId : undefined;
  const cover = await renderCover({
    options: sample.options,
    pages,
    dims,
    approximate: coverApproximate,
    dateRange: formatDateRange(entries[0]!.date, entries.at(-1)!.date),
    frontImage: frontId ? images.get(frontId)?.path : undefined,
  });

  const files = { interior: join(outDir, 'interior.pdf'), cover: join(outDir, 'cover.pdf') };
  await writeFile(files.interior, interior.pdf);
  await writeFile(files.cover, cover.pdf);
  const { pdf: _i, ...interiorInfo } = interior;
  const { pdf: _c, ...coverInfo } = cover;
  const build: SampleBuild = {
    kind,
    product: productId,
    podPackageId: pod,
    interior: interiorInfo,
    cover: coverInfo,
    coverApproximate,
    interiorReport: await inspectPdf(interior.pdf),
    coverReport: await inspectPdf(cover.pdf),
    warnings: imageWarnings(entries, sample.options, meta, pageGeometry(product.trim, interior.plan.gutterIn)),
    files,
  };
  await writeFile(join(outDir, 'report.json'), JSON.stringify(build, null, 2));
  return build;
}
