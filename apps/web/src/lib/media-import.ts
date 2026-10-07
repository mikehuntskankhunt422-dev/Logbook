import { MEDIA_LIMITS, fitWithin, mediaKind, type Journal, type MediaMeta } from '@logbook/core';

/**
 * Turns a dropped or picked file into stored media: reads dimensions and duration, makes a poster
 * frame for videos, and optionally downsizes very large photos. Runs in the browser and Tauri WebView.
 */

export interface ImportResult {
  meta: MediaMeta;
  kind: 'image' | 'video' | 'audio' | 'file';
  /** True when the browser could not decode an image (for example HEIC outside Safari). */
  undecodable?: boolean;
}

export async function importFile(journal: Journal, file: File, opts: { compress: boolean }): Promise<ImportResult> {
  const kind = mediaKind(file.type);
  if (kind === 'image') return importImage(journal, file, opts.compress);
  if (kind === 'video') return importVideo(journal, file);
  if (kind === 'audio') return importAudio(journal, file);
  return { meta: await journal.addMedia(file, { name: file.name }), kind: 'file' };
}

async function importImage(journal: Journal, file: File, compress: boolean): Promise<ImportResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { meta: await journal.addMedia(file, { name: file.name }), kind: 'file', undecodable: true };
  }
  const { width, height } = bitmap;
  const tooBig = Math.max(width, height) > MEDIA_LIMITS.imageMaxEdge || file.size > MEDIA_LIMITS.imageCompressAboveBytes;
  if (compress && tooBig && file.type !== 'image/gif') {
    const size = fitWithin(width, height, MEDIA_LIMITS.imageMaxEdge);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await drawToBlob(bitmap, size.width, size.height, type, 0.9);
    bitmap.close();
    if (blob && blob.size < file.size) {
      const name = type === 'image/jpeg' ? file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg' : file.name;
      return { meta: await journal.addMedia(blob, { name, mime: type, ...size }), kind: 'image' };
    }
  } else {
    bitmap.close();
  }
  return { meta: await journal.addMedia(file, { name: file.name, width, height }), kind: 'image' };
}

async function drawToBlob(source: CanvasImageSource, w: number, h: number, type: string, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function loadMediaElement<T extends HTMLMediaElement>(el: T, file: Blob): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => resolve(el);
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable media'));
    };
    el.src = url;
  });
}

async function importVideo(journal: Journal, file: File): Promise<ImportResult> {
  let durationMs: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let poster: Blob | null = null;
  try {
    const video = await loadMediaElement(document.createElement('video'), file);
    durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined;
    width = video.videoWidth || undefined;
    height = video.videoHeight || undefined;
    poster = await capturePoster(video);
    URL.revokeObjectURL(video.src);
  } catch {
    // Codec the browser can't play: store it anyway as a video without a poster.
  }
  const meta = await journal.addMedia(file, { name: file.name, width, height, durationMs });
  if (poster) {
    const p = await journal.addMedia(poster, { name: `${file.name}.poster.jpg`, mime: 'image/jpeg', width, height, derivedFrom: meta.id });
    const withPoster = { ...meta, posterId: p.id };
    await journal.updateMediaMeta(withPoster);
    return { meta: withPoster, kind: 'video' };
  }
  return { meta, kind: 'video' };
}

/** Grabs a frame ~10% in (max 2 s) so the poster isn't a black fade-in. */
async function capturePoster(video: HTMLVideoElement): Promise<Blob | null> {
  if (!video.videoWidth) return null;
  const t = Math.min(2, (video.duration || 0) * 0.1);
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    video.addEventListener('seeked', done, { once: true });
    setTimeout(done, 3000);
    video.currentTime = t;
  });
  const size = fitWithin(video.videoWidth, video.videoHeight, 1920);
  return drawToBlob(video, size.width, size.height, 'image/jpeg', 0.88);
}

async function importAudio(journal: Journal, file: File): Promise<ImportResult> {
  let durationMs: number | undefined;
  try {
    const audio = await loadMediaElement(document.createElement('audio'), file);
    durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined;
    URL.revokeObjectURL(audio.src);
  } catch {
    /* store anyway */
  }
  return { meta: await journal.addMedia(file, { name: file.name, durationMs }), kind: 'audio' };
}

export function canCompressVideo(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoDecoder' in window;
}

/**
 * Optional, user-initiated video compression with WebCodecs (Mediabunny). Produces an MP4 at most
 * 1080p. Returns null when the browser can't do it, so the caller keeps the original.
 */
export async function compressVideo(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<File | null> {
  if (!canCompressVideo()) return null;
  const { Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat, QUALITY_MEDIUM } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const videoTrack = await input.getPrimaryVideoTrack();
  const w = videoTrack ? await videoTrack.getDisplayWidth() : 0;
  const h = videoTrack ? await videoTrack.getDisplayHeight() : 0;
  // Cap the short edge at 1080 px: landscape sets height, portrait sets width; aspect ratio is kept.
  const cap = MEDIA_LIMITS.videoMaxHeight;
  const size = Math.min(w, h) > cap ? (w >= h ? { height: cap } : { width: cap }) : {};
  const conversion = await Conversion.init({
    input,
    output,
    video: { ...size, bitrate: QUALITY_MEDIUM },
    audio: { bitrate: QUALITY_MEDIUM },
    showWarnings: false,
  });
  if (!conversion.isValid) return null;
  conversion.onProgress = (p) => onProgress(p);
  signal?.addEventListener('abort', () => void conversion.cancel());
  await conversion.execute();
  if (!target.buffer) return null;
  const name = file.name.replace(/\.[a-z0-9]+$/i, '') + '.mp4';
  const out = new File([target.buffer], name, { type: 'video/mp4' });
  return out.size < file.size ? out : null;
}
