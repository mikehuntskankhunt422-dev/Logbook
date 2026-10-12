import { parseIsoDate } from '../dates.ts';
import type { Entry } from '../model.ts';

/**
 * What an exported document knows about a picture, video, recording or file (D89). `src` is where
 * the copy of the file sits relative to the document (or a URL for the print view); without it the
 * file isn't part of the export and the document names it instead.
 */
export interface ExportMedia {
  kind: 'image' | 'video' | 'audio' | 'file';
  name: string;
  src?: string;
  width?: number;
  height?: number;
  /** A video's poster frame, for the print view where a video can't play. */
  posterSrc?: string;
}
export type MediaLookup = (id: string) => ExportMedia | undefined;

export interface RenderOptions {
  /** "Wednesday, 7 October 2026" in the reader's language; plain ISO dates if not given. */
  formatDate?: (iso: string) => string;
}

export const longDate = (iso: string): string =>
  parseIsoDate(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Date, mood and tags, as one line of plain text. */
export function metaLine(entry: Entry, opts: RenderOptions): string[] {
  const parts = [opts.formatDate ? opts.formatDate(entry.date) : entry.date];
  if (entry.mood) parts.push(`Mood: ${entry.mood}`);
  if (entry.tags.length) parts.push(`Tags: ${entry.tags.join(', ')}`);
  return parts;
}

/** What a media block is called when its file isn't in the export. */
export function mediaLabel(kind: ExportMedia['kind'] | undefined): string {
  return kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : kind === 'audio' ? 'Recording' : 'File';
}

/** Oldest first, as a journal reads. */
export function chronological(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

/** Only web and email links become clickable; anything else stays text. */
export function safeHref(href: unknown): string | undefined {
  return typeof href === 'string' && /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : undefined;
}
