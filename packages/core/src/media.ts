import { mediaKind } from './model.ts';

const MB = 1024 * 1024;

export const MEDIA_LIMITS = {
  /** Above this, the import dialog explains the cost and offers compression. */
  videoWarnBytes: 100 * MB,
  audioWarnBytes: 50 * MB,
  imageWarnBytes: 15 * MB,
  /** Above this, browsers may refuse to store it; desktop is recommended. */
  hardWarnBytes: 1024 * MB,
  /**
   * Images are downscaled to this long edge when "compress large media" is on. 4000 px still gives
   * ≥ 300 PPI on a full-bleed 8.5×11″ page (needs 3375 px), so print quality is preserved.
   */
  imageMaxEdge: 4000,
  imageCompressAboveBytes: 6 * MB,
  /** Target for optional video compression. */
  videoMaxHeight: 1080,
  videoBitrate: 4_000_000,
};

export interface SizeAdvice {
  level: 'ok' | 'large' | 'huge';
  message: string;
}

export function sizeAdvice(bytes: number, mime: string): SizeAdvice {
  const kind = mediaKind(mime);
  if (bytes >= MEDIA_LIMITS.hardWarnBytes) {
    return {
      level: 'huge',
      message: `${formatBytes(bytes)} is very large. Browsers may refuse to store it; compress it first or use the desktop app.`,
    };
  }
  const limit =
    kind === 'video' ? MEDIA_LIMITS.videoWarnBytes : kind === 'audio' ? MEDIA_LIMITS.audioWarnBytes : kind === 'image' ? MEDIA_LIMITS.imageWarnBytes : MEDIA_LIMITS.videoWarnBytes;
  if (bytes >= limit) {
    return { level: 'large', message: `${formatBytes(bytes)} is large. It will use a lot of storage and make backups slower.` };
  }
  return { level: 'ok', message: '' };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * MB) return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
  return `${(n / (1024 * MB)).toFixed(1)} GB`;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Fit (w,h) inside a square of `maxEdge`, never upscaling. */
export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
