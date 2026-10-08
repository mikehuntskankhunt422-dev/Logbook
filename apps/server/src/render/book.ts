import {
  BLEED_IN,
  coverDocument,
  interiorDocument,
  interiorGeometry,
  packageId,
  pageLimits,
  planPages,
  resampleTargets,
  standaloneHtml,
  type BookBundle,
  type CoverDimensions,
  type CoverGeometry,
  type PagePlan,
  type PrintWarning,
} from '@logbook/core';
import type { Asset } from './assets.ts';
import { prepareImage } from './images.ts';
import { setPageBoxes } from './pdf.ts';
import type { Renderer } from './renderer.ts';
import type { CoverDimensionsSource } from '../lulu.ts';

export interface RenderedBook {
  interiorPdf: Buffer;
  coverPdf: Buffer;
  plan: PagePlan;
  podPackageId: string;
  cover: { dims: CoverDimensions; geometry: CoverGeometry };
  warnings: PrintWarning[];
  timingsMs: { images: number; layout: number; interior: number; cover: number };
}

export class RenderMismatchError extends Error {
  override name = 'RenderMismatchError';
}

const mediaPath = (id: string) => `/media/${id}`;

/**
 * Bundle → print-ready interior and cover PDFs. Images are resampled once, at the widest layout
 * (no gutter), so they carry enough pixels for whichever gutter the planner settles on.
 */
export async function renderBook(renderer: Renderer, bundle: BookBundle, covers: CoverDimensionsSource): Promise<RenderedBook> {
  const { options, entries, media } = bundle;
  const t0 = performance.now();
  const grayscale = options.product.interior === 'bw';

  const widest = interiorDocument({ options, entries, media, mediaUrl: (id) => (bundle.files.has(id) ? id : null), gutterIn: 0, notesPages: 0 });
  const files = await prepareAll(bundle, resampleTargets(widest.images, media), grayscale);
  // Anything sharp couldn't decode prints as a placeholder (and a warning) rather than failing the book.
  const mediaUrl = (id: string) => (files.has(mediaPath(id)) ? mediaPath(id).slice(1) : null);
  const t1 = performance.now();

  const head = renderer.pagedHead();
  const html = (gutterIn: number, notesPages: number) => standaloneHtml(interiorDocument({ options, entries, media, mediaUrl, gutterIn, notesPages }), head);
  const plan = await planPages(async (g) => (await renderer.paginate(html(g, 0), files, { pdf: false })).pages, pageLimits(options.product), estimatePages(entries.length));
  const t2 = performance.now();

  const final = interiorDocument({ options, entries, media, mediaUrl, gutterIn: plan.gutterIn, notesPages: plan.notesPages });
  const interior = await renderer.paginate(standaloneHtml(final, head), files, { pdf: true });
  if (interior.pages !== plan.totalPages) throw new RenderMismatchError(`Planned ${plan.totalPages} pages but the final layout has ${interior.pages}`);
  const t3 = performance.now();

  // The cover is always full colour, so a photo cover gets its own colour copy sized for the front panel.
  const dims = await covers.get(options.product, plan.totalPages);
  const coverUrl = (id: string) => (bundle.files.has(id) ? mediaPath(id).slice(1) : null);
  let cover = coverDocument({ options, entries, media, mediaUrl: coverUrl, pageCount: plan.totalPages, dims });
  const coverFiles = await prepareAll({ ...bundle, files: new Map([...bundle.files].filter(([id]) => cover.images.some((i) => i.mediaId === id))) }, resampleTargets(cover.images, media), false);
  cover = coverDocument({ options, entries, media, mediaUrl: (id) => (coverFiles.has(mediaPath(id)) ? mediaPath(id).slice(1) : null), pageCount: plan.totalPages, dims });
  const coverPdf = await renderer.print(standaloneHtml(cover, renderer.plainHead()), coverFiles);
  const t4 = performance.now();

  const page = interiorGeometry(options.product.trim, plan.gutterIn);
  const interiorPdf = await setPageBoxes(interior.pdf!, { widthIn: page.pageWidthIn, heightIn: page.pageHeightIn, bleedIn: BLEED_IN });
  const coverPdfExact = await setPageBoxes(coverPdf, { widthIn: dims.widthIn, heightIn: dims.heightIn, bleedIn: cover.geometry.wrapIn });

  return {
    interiorPdf,
    coverPdf: coverPdfExact,
    plan,
    podPackageId: packageId(options.product),
    cover: { dims, geometry: cover.geometry },
    warnings: [...final.warnings, ...cover.warnings],
    timingsMs: { images: Math.round(t1 - t0), layout: Math.round(t2 - t1), interior: Math.round(t3 - t2), cover: Math.round(t4 - t3) },
  };
}

async function prepareAll(bundle: Pick<BookBundle, 'files'>, targets: ReturnType<typeof resampleTargets>, grayscale: boolean): Promise<Map<string, Asset>> {
  const out = new Map<string, Asset>();
  for (const [id, bytes] of bundle.files) {
    try {
      out.set(mediaPath(id), await prepareImage(bytes, targets.get(id), { grayscale }));
    } catch {
      // Undecodable image: left out, so the layout shows a placeholder and the builder a warning.
    }
  }
  return out;
}

/** A rough first guess (front matter + a page or two per entry) so the planner usually measures once or twice. */
function estimatePages(entryCount: number): number {
  return 4 + Math.ceil(entryCount * 1.5);
}
