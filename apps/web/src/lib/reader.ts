import { entryHtml, mediaKind, referencedMediaIds, type Entry, type ExportMedia, type Journal } from '@logbook/core';
import { formatLongDate } from '../components/common.tsx';

/**
 * An entry to read like a book (D113): its markup as the web page export makes it (everything
 * from the entry escaped, D89), with its pictures from the journal, and a way to let them go.
 * Pictures that can't be read are left out; the words always come.
 */
export async function readableEntry(journal: Journal, id: string): Promise<{ entry: Entry; html: string; release: () => void } | undefined> {
  const entry = await journal.getEntry(id);
  if (!entry || entry.deletedAt) return undefined;
  const urls: string[] = [];
  const release = () => urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const urlOf = async (mediaId: string) => {
    const blob = await journal.getMediaBlob(mediaId).catch(() => undefined);
    if (!blob) return undefined;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };
  const lookup = new Map<string, ExportMedia>();
  try {
    for (const mediaId of new Set(referencedMediaIds(entry))) {
      const meta = await journal.getMediaMeta(mediaId).catch(() => undefined);
      if (!meta) continue;
      const kind = mediaKind(meta.mime);
      const info: ExportMedia = { kind, name: meta.name, width: meta.width, height: meta.height };
      if (kind === 'image') info.src = await urlOf(mediaId);
      else if (kind === 'video' && meta.posterId) info.posterSrc = await urlOf(meta.posterId);
      lookup.set(mediaId, info);
    }
  } catch (err) {
    release();
    throw err;
  }
  if (journal.isLocked) {
    release();
    return undefined;
  }
  return { entry, html: entryHtml(entry, (m) => lookup.get(m), { mode: 'print', formatDate: (d) => formatLongDate(d) }), release };
}
