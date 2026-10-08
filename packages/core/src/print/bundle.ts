import { unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import type { Journal } from '../journal.ts';
import { entrySchema, mediaMetaSchema, type Entry, type MediaMeta } from '../model.ts';
import { bookOptionsSchema, selectEntries, type BookOptions } from './book.ts';
import { PRINTABLE_IMAGE_TYPES } from './images.ts';

/**
 * What the builder sends to the render server: the book options, the selected entries (decrypted),
 * their media metadata, and the bytes of the images that print. Videos, audio and attached files
 * never leave the device: only their names, sizes and poster frames are needed.
 *
 *   book.json      { format, version, options, entries, media }
 *   media/<id>     image bytes
 */
export const BOOK_BUNDLE_FORMAT = 'logbook-book';
export const BOOK_BUNDLE_VERSION = 1;

export const BUNDLE_LIMITS = {
  maxEntries: 5000,
  maxFiles: 20_000,
  /** Total uncompressed size; a zip bomb stops here. */
  maxBytes: 2 * 1024 ** 3,
};

const manifestSchema = z.object({
  format: z.literal(BOOK_BUNDLE_FORMAT),
  version: z.literal(BOOK_BUNDLE_VERSION),
  options: bookOptionsSchema,
  entries: z.array(entrySchema).max(BUNDLE_LIMITS.maxEntries),
  media: z.array(mediaMetaSchema).max(BUNDLE_LIMITS.maxFiles),
});

export interface BookBundle {
  options: BookOptions;
  entries: Entry[];
  media: Map<string, MediaMeta>;
  files: Map<string, Uint8Array>;
}

export class BookBundleError extends Error {
  override name = 'BookBundleError';
}

/** Media ids whose metadata the book needs, and the subset whose bytes it prints. */
export function bookMedia(entries: readonly Entry[], options: BookOptions, metaOf: (id: string) => MediaMeta | undefined): { metaIds: string[]; imageIds: string[] } {
  const meta = new Set<string>();
  const images = new Set<string>();
  const image = (id: string) => {
    meta.add(id);
    const m = metaOf(id);
    if (m && PRINTABLE_IMAGE_TYPES.has(m.mime)) images.add(id);
  };
  if (options.cover.kind === 'photo') image(options.cover.mediaId);
  for (const e of entries) {
    if (e.cover.kind === 'photo') image(e.cover.mediaId);
    for (const b of e.blocks) {
      if (b.type === 'photo') image(b.mediaId);
      else if (b.type === 'gallery') b.items.forEach((i) => image(i.mediaId));
      else if (b.type === 'video') {
        meta.add(b.mediaId);
        const poster = metaOf(b.mediaId)?.posterId;
        if (poster) image(poster);
      } else if (b.type === 'audio' || b.type === 'file') meta.add(b.mediaId);
    }
  }
  return { metaIds: [...meta], imageIds: [...images] };
}

/** Packs a book for the render server. The journal must be unlocked. */
export async function buildBookBundle(journal: Journal, options: BookOptions): Promise<Blob> {
  const entries = selectEntries(await journal.listEntries(), options);
  const allMeta = new Map((await journal.listMediaMeta()).map((m) => [m.id, m]));
  const { metaIds, imageIds } = bookMedia(entries, options, (id) => allMeta.get(id));
  const media = metaIds.map((id) => allMeta.get(id)).filter((m): m is MediaMeta => !!m);

  const files: Zippable = {};
  for (const id of imageIds) {
    const blob = await journal.getMediaBlob(id);
    if (blob) files[`media/${id}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  const manifest = { format: BOOK_BUNDLE_FORMAT, version: BOOK_BUNDLE_VERSION, options, entries, media };
  files['book.json'] = [new TextEncoder().encode(JSON.stringify(manifest)), { level: 6 }];
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** Unpacks and validates a bundle. Throws BookBundleError on anything malformed or oversized. */
export function readBookBundle(zip: Uint8Array): BookBundle {
  let total = 0;
  let count = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zip, {
      filter: (f) => {
        total += f.originalSize;
        count++;
        if (total > BUNDLE_LIMITS.maxBytes || count > BUNDLE_LIMITS.maxFiles + 1) throw new BookBundleError('Book bundle is too large');
        return f.name === 'book.json' || /^media\/[A-Za-z0-9_-]{1,64}$/.test(f.name);
      },
    });
  } catch (err) {
    if (err instanceof BookBundleError) throw err;
    throw new BookBundleError(`Book bundle is not a valid zip: ${(err as Error).message}`);
  }
  const json = raw['book.json'];
  if (!json) throw new BookBundleError('Book bundle has no book.json');
  let parsed: z.infer<typeof manifestSchema>;
  try {
    parsed = manifestSchema.parse(JSON.parse(new TextDecoder().decode(json)));
  } catch (err) {
    throw new BookBundleError(`book.json is invalid: ${err instanceof z.ZodError ? z.prettifyError(err) : (err as Error).message}`);
  }
  const media = new Map(parsed.media.map((m) => [m.id, m]));
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(raw)) {
    if (name === 'book.json') continue;
    const id = name.slice('media/'.length);
    if (media.has(id)) files.set(id, bytes);
  }
  // Re-select on this side too, so the server never prints an entry the options exclude.
  return { options: parsed.options, entries: selectEntries(parsed.entries, parsed.options), media, files };
}
