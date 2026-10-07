import {
  imagePlacements,
  mediaKind,
  pageGeometry,
  printMediaPlan,
  printPixelSize,
  PRINT_BUNDLE_FORMAT,
  type BookOptions,
  type Entry,
  type Journal,
  type MediaMeta,
  type Placement,
  type PrintBundle,
} from '@logbook/core';

/** What the consent dialog lists before anything leaves the device (PLAN §1.5 step 2). */
export interface UploadSummary {
  entries: number;
  pictures: number;
  /** Media that print as cards from their details only: videos (their poster is a picture), voice notes, files. */
  cardsOnly: number;
  /** Upper bound before pictures are reduced to print size. */
  maxBytes: number;
}

export function uploadSummary(entries: Entry[], options: BookOptions, metaOf: (id: string) => MediaMeta | undefined): UploadSummary {
  const plan = printMediaPlan(entries, options, metaOf);
  return {
    entries: entries.length,
    pictures: plan.files.length,
    cardsOnly: plan.metaOnly.length,
    maxBytes: plan.files.reduce((n, id) => n + (metaOf(id)?.bytes ?? 0), 0),
  };
}

export interface BundleFile {
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
  sha256: string;
  contentType: string;
}

export interface BuiltBundle {
  bundle: BundleFile;
  files: BundleFile[];
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The print bundle (core `bundle.ts`): the options, the chosen entries, the details of every
 * medium the pages mention, and the pictures they show, reduced on this device to what print needs
 * (600 PPI at their largest size in the book; never enlarged). Videos, voice notes and attachments
 * print as cards, so only their details and a voice note's waveform travel, never the files.
 */
export async function buildPrintBundle(
  journal: Journal,
  entries: Entry[],
  options: BookOptions,
  metaOf: (id: string) => MediaMeta | undefined,
  onProgress: (done: number, total: number) => void,
): Promise<BuiltBundle> {
  const plan = printMediaPlan(entries, options, metaOf);
  const boxes = new Map<string, Placement[]>();
  for (const p of imagePlacements(entries, options, metaOf, pageGeometry(options.product.trim, 0))) boxes.set(p.mediaId, [...(boxes.get(p.mediaId) ?? []), p.box]);

  const files: BundleFile[] = [];
  const media: PrintBundle['media'] = [];
  let done = 0;
  onProgress(0, plan.files.length);
  for (const id of plan.files) {
    const meta = metaOf(id)!;
    const blob = await journal.getMediaBlob(id);
    if (!blob) throw new Error(`The picture ${meta.name} is missing from this device.`);
    const prepared = await printReady(blob, meta, boxes.get(id) ?? []);
    const path = `media/${id.replace(/[^A-Za-z0-9_-]/g, '_')}.${EXT[prepared.type]!}`;
    const sha = await sha256(prepared.bytes);
    files.push({ path, bytes: prepared.bytes, sha256: sha, contentType: prepared.type });
    media.push({ meta, file: { path, sha256: sha, bytes: prepared.bytes.length, width: prepared.width, height: prepared.height } });
    onProgress(++done, plan.files.length);
  }

  const audioPeaks: Record<string, number[]> = {};
  for (const id of plan.metaOnly) {
    const meta = metaOf(id)!;
    media.push({ meta });
    if (mediaKind(meta.mime) === 'audio') {
      const peaks = await waveform(journal, id, meta).catch(() => undefined);
      if (peaks) audioPeaks[id] = peaks;
    }
  }

  const bundle: PrintBundle = { format: PRINT_BUNDLE_FORMAT, version: 1, createdAt: new Date().toISOString(), options, entries, media, audioPeaks };
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  return { bundle: { path: 'bundle.json', bytes, sha256: await sha256(bytes), contentType: 'application/json' }, files };
}

/**
 * A picture at print size. JPEG, PNG and WebP that are already small enough travel as they are;
 * anything bigger, or in another format, is redrawn on white (as the server flattens it, D37) and
 * sent as a high-quality JPEG.
 */
async function printReady(blob: Blob, meta: MediaMeta, boxes: Placement[]): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string; width: number; height: number }> {
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const target = width && height && boxes.length ? printPixelSize({ width, height }, boxes) : { width, height };
  if (EXT[blob.type] && width && height && target.width >= width) {
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type, width, height };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error(`This browser can't read the picture ${meta.name}, so it can't be prepared for printing.`);
  }
  const scale = Math.min(1, target.width ? target.width / bitmap.width : 1);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return { bytes: new Uint8Array(await out.arrayBuffer()), type: 'image/jpeg', width: w, height: h };
}

/** 200 loudness bars (0–1) for a voice note's printed card; skipped for very large files. */
async function waveform(journal: Journal, id: string, meta: MediaMeta): Promise<number[] | undefined> {
  if (meta.bytes > 40 * 1024 * 1024 || typeof OfflineAudioContext === 'undefined') return undefined;
  const blob = await journal.getMediaBlob(id);
  if (!blob) return undefined;
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const data = audio.getChannelData(0);
  const bars = 200;
  const step = Math.max(1, Math.floor(data.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars && i * step < data.length; i++) {
    let max = 0;
    for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) max = Math.max(max, Math.abs(data[j]!));
    peaks.push(Math.min(1, max));
  }
  const top = Math.max(...peaks, 0.001);
  return peaks.map((p) => Math.round((p / top) * 1000) / 1000);
}
