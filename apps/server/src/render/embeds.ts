import sharp from 'sharp';
import type { Block } from '@logbook/core';

type Embed = Extract<Block, { type: 'embed' }>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Fetches a YouTube or Vimeo thumbnail for print, best-effort: on any failure the embed prints as a
 * title card in the same box, so layout doesn't change. Only the public video id leaves the server.
 */
export async function fetchEmbedThumbnail(block: Embed, outPath: string, fetchImpl: Fetch = fetch, timeoutMs = 5000): Promise<string | undefined> {
  const get = async (url: string) => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length <= MAX_BYTES ? buf : undefined;
  };
  try {
    let image: Buffer | undefined;
    if (block.provider === 'youtube') {
      for (const size of ['maxresdefault', 'hqdefault']) {
        image = await get(`https://i.ytimg.com/vi/${encodeURIComponent(block.videoId)}/${size}.jpg`);
        if (image && ((await sharp(image).metadata()).width ?? 0) >= 320) break;
        image = undefined;
      }
    } else {
      const oembed = await get(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${block.videoId}`)}&width=1280`);
      const thumb = oembed && (JSON.parse(oembed.toString('utf8')) as { thumbnail_url?: unknown }).thumbnail_url;
      if (typeof thumb === 'string' && thumb.startsWith('https://')) image = await get(thumb);
    }
    if (!image) return undefined;
    await sharp(image).resize({ width: 1600, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toFile(outPath);
    return outPath;
  } catch {
    return undefined;
  }
}
