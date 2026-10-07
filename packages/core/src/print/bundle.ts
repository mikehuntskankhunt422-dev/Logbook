import { z } from 'zod';
import { entrySchema, mediaMetaSchema, mediaKind, type Entry, type MediaMeta } from '../model.ts';
import { bookOptionsSchema, type BookOptions } from './options.ts';

/**
 * What the client uploads for one book after the consent dialog (PLAN §1.5 step 2): the options,
 * the selected entries, and only the image files the pages show. Videos, audio and attachments
 * print as cards from their metadata, so their files are never uploaded.
 */
export const PRINT_BUNDLE_FORMAT = 'logbook-print-bundle';

export const bundleFileSchema = z.object({
  /** Path inside the bundle, e.g. `media/k3f9x2abcd01.jpg`. */
  path: z.string().regex(/^media\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  /** Pixel size of the file as uploaded, which may be downscaled from the original. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const printBundleSchema = z.object({
  format: z.literal(PRINT_BUNDLE_FORMAT),
  version: z.literal(1),
  createdAt: z.string(),
  options: bookOptionsSchema,
  entries: z.array(entrySchema).max(5000),
  media: z
    .array(z.object({ meta: mediaMetaSchema, file: bundleFileSchema.optional() }))
    .max(20000),
  /** Waveform peaks (0–1) per audio media id, computed on the device. */
  audioPeaks: z.record(z.string(), z.array(z.number().min(0).max(1)).max(512)).default({}),
});
export type PrintBundle = z.infer<typeof printBundleSchema>;

export interface PrintMediaPlan {
  /** Images the pages show: uploaded as files. */
  files: string[];
  /** Media printed as cards from metadata only. */
  metaOnly: string[];
}

/** Which media a book needs, and which of it must travel as files. */
export function printMediaPlan(entries: Entry[], options: BookOptions, metaOf: (id: string) => MediaMeta | undefined): PrintMediaPlan {
  const files = new Set<string>();
  const metaOnly = new Set<string>();
  if (options.cover.kind === 'photo') files.add(options.cover.mediaId);
  for (const e of entries) {
    if (e.cover.kind === 'photo') files.add(e.cover.mediaId);
    for (const b of e.blocks) {
      if (b.type === 'photo') files.add(b.mediaId);
      else if (b.type === 'gallery') for (const i of b.items) files.add(i.mediaId);
      else if (b.type === 'video') {
        metaOnly.add(b.mediaId);
        const poster = metaOf(b.mediaId)?.posterId;
        if (poster) files.add(poster);
      } else if (b.type === 'audio' || b.type === 'file') metaOnly.add(b.mediaId);
    }
  }
  // A photo block pointing at a non-image (shouldn't happen) is printed as metadata, not uploaded.
  for (const id of files) {
    const m = metaOf(id);
    if (!m) files.delete(id);
    else if (mediaKind(m.mime) !== 'image') {
      files.delete(id);
      metaOnly.add(id);
    }
  }
  for (const id of metaOnly) if (!metaOf(id) || files.has(id)) metaOnly.delete(id);
  return { files: [...files], metaOnly: [...metaOnly] };
}
