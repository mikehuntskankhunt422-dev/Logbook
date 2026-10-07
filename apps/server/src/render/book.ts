import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  estimateCoverDimensions,
  formatDateRange,
  imageWarnings,
  pageGeometry,
  podPackageId,
  type BookOptions,
  type Block,
  type CoverDimensions,
  type Entry,
  type ImageWarning,
  type MediaMeta,
} from '@logbook/core';
import { renderCover, type CoverResult } from './cover.ts';
import { fetchEmbedThumbnail } from './embeds.ts';
import { preparePrintImages } from './images.ts';
import { renderInterior, type InteriorResult } from './interior.ts';

export interface BookSource {
  options: BookOptions;
  /** Selected and sorted (selectEntries). */
  entries: Entry[];
  meta(id: string): MediaMeta | undefined;
  /** The original (or client-downscaled) image file for a media id. */
  source(id: string): Promise<Buffer | string | undefined>;
  audioPeaks?: Record<string, number[]>;
  printedOn: string;
  /** Lulu's cover size; when it has none, the cover uses the guide's estimate and is marked approximate. */
  coverDims?(podPackageId: string, pages: number): Promise<CoverDimensions | undefined>;
  /** Fetch YouTube/Vimeo thumbnails (best effort; samples skip it so their output is deterministic). */
  embedThumbnails?: boolean;
  /** Scratch folder for print-ready images. */
  workDir: string;
}

export interface BookRender {
  podPackageId: string;
  interior: InteriorResult;
  cover: CoverResult;
  coverApproximate: boolean;
  warnings: ImageWarning[];
}

/** The whole print job for one book: images (D37), interior, Lulu's cover size, cover. */
export async function renderBook(src: BookSource): Promise<BookRender> {
  const product = src.options.product;
  const images = await preparePrintImages({ entries: src.entries, options: src.options, meta: src.meta, source: src.source }, join(src.workDir, 'images'));

  const embedThumbnails = new Map<string, string>();
  if (src.embedThumbnails) {
    await mkdir(join(src.workDir, 'embeds'), { recursive: true });
    const embeds = src.entries.flatMap((e) => e.blocks.filter((b): b is Extract<Block, { type: 'embed' }> => b.type === 'embed'));
    for (const b of embeds) {
      if (embedThumbnails.has(b.videoId)) continue;
      const file = await fetchEmbedThumbnail(b, join(src.workDir, 'embeds', `${embedThumbnails.size}.jpg`));
      if (file) embedThumbnails.set(b.videoId, file);
    }
  }

  const interior = await renderInterior({
    options: src.options,
    entries: src.entries,
    meta: src.meta,
    images: new Map([...images].map(([id, img]) => [id, img.path])),
    audioPeaks: src.audioPeaks,
    embedThumbnails,
    printedOn: src.printedOn,
  });

  const pod = podPackageId(product);
  const pages = interior.plan.pages;
  const lulu = await src.coverDims?.(pod, pages);
  const frontId = src.options.cover.kind === 'photo' ? src.options.cover.mediaId : undefined;
  const cover = await renderCover({
    options: src.options,
    pages,
    dims: lulu ?? estimateCoverDimensions(product, pages),
    approximate: !lulu,
    dateRange: src.entries.length ? formatDateRange(src.entries[0]!.date, src.entries.at(-1)!.date) : '',
    frontImage: frontId ? images.get(frontId)?.path : undefined,
  });

  return {
    podPackageId: pod,
    interior,
    cover,
    coverApproximate: !lulu,
    warnings: imageWarnings(src.entries, src.options, src.meta, pageGeometry(product.trim, interior.plan.gutterIn)),
  };
}
