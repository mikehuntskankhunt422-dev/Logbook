import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { fetchEmbedThumbnail } from '../src/render/embeds.ts';
import { preparePrintImage } from '../src/render/images.ts';
import { finishCover, finishInterior, inspectPdf } from '../src/render/pdf.ts';
import { fontFile } from '../src/render/assets.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'logbook-render-'));

async function pngWithAlpha(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 80, b: 40, alpha: 0.5 } } }).png().toBuffer();
}

describe('PDF inspection', () => {
  it('finds unembedded fonts, soft masks, alpha and annotations', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawText('hi', { font: await doc.embedFont(StandardFonts.Helvetica) });
    page.drawImage(await doc.embedPng(await pngWithAlpha(4, 4)), { x: 0, y: 0, width: 10, height: 10 });
    page.drawRectangle({ x: 20, y: 20, width: 10, height: 10, opacity: 0.5 });
    page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 1, 1] })]) as PDFArray);
    const r = await inspectPdf(await doc.save());
    expect(r.fonts).toEqual([{ name: 'Helvetica', subtype: 'Type1', embedded: false }]);
    expect(r.softMasks).toBe(1);
    expect(r.alphaStates).toBe(1);
    expect(r.annotations).toBe(1);
  });

  it('sets interior boxes to trim + bleed, cropping from the top-left', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([450.5, 666.5]);
    const out = await inspectPdf(await finishInterior(await doc.save(), { width: 6, height: 9 }, 0.125));
    expect(out.mediaBoxes).toEqual(['450.00x666.00']);
    expect(out.trimBoxes).toEqual(['432.00x648.00']);
  });

  it('refuses a page smaller than the book, and crops covers to the exact size', async () => {
    const small = await PDFDocument.create();
    small.addPage([440, 660]);
    await expect(finishInterior(await small.save(), { width: 6, height: 9 }, 0.125)).rejects.toThrow(/smaller/);
    const cover = await PDFDocument.create();
    cover.addPage([922, 670]);
    expect((await inspectPdf(await finishCover(await cover.save(), 920.37, 666))).mediaBoxes).toEqual(['920.37x666.00']);
  });
});

describe('print images (D37)', () => {
  const box = { width: 2, height: 2, fit: 'contain' as const };

  it('flattens transparency onto white and resamples to 600 PPI', async () => {
    const out = join(tmp(), 'a.jpg');
    const img = await preparePrintImage(await pngWithAlpha(3000, 3000), out, { boxes: [box], grayscale: false });
    expect(img).toMatchObject({ width: 1200, height: 1200 });
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', hasAlpha: false, channels: 3, space: 'srgb' });
  });

  it('never upscales, and converts to greyscale for B&W interiors', async () => {
    const out = join(tmp(), 'b.jpg');
    const img = await preparePrintImage(await pngWithAlpha(300, 200), out, { boxes: [box], grayscale: true });
    expect(img).toMatchObject({ width: 300, height: 200 });
    expect((await sharp(out).metadata()).channels).toBe(1);
  });

  it('applies EXIF orientation', async () => {
    const sideways = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#336699' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const img = await preparePrintImage(sideways, join(tmp(), 'c.jpg'), { boxes: [{ width: 10, height: 10, fit: 'contain' }], grayscale: false });
    expect(img).toMatchObject({ width: 300, height: 400 });
  });
});

describe('embed thumbnails', () => {
  const yt = { id: 'y', type: 'embed' as const, provider: 'youtube' as const, videoId: 'abc123DEF45', url: 'https://www.youtube.com/watch?v=abc123DEF45', title: '', caption: '' };
  const jpeg = (w: number) => sharp({ create: { width: w, height: Math.round((w * 9) / 16), channels: 3, background: '#000' } }).jpeg().toBuffer();

  it('falls back from maxres to hq on YouTube', async () => {
    const asked: string[] = [];
    const fake = async (url: string) => {
      asked.push(url);
      return url.includes('maxres') ? new Response(null, { status: 404 }) : new Response(new Uint8Array(await jpeg(480)));
    };
    const out = await fetchEmbedThumbnail(yt, join(tmp(), 't.jpg'), fake);
    expect(out).toMatch(/t\.jpg$/);
    expect(asked).toEqual(['https://i.ytimg.com/vi/abc123DEF45/maxresdefault.jpg', 'https://i.ytimg.com/vi/abc123DEF45/hqdefault.jpg']);
  });

  it('reads the Vimeo thumbnail from oEmbed, and only over https', async () => {
    const vimeo = { ...yt, provider: 'vimeo' as const, videoId: '76979871' };
    const fake = (thumb: string) => async (url: string) =>
      url.includes('oembed') ? new Response(JSON.stringify({ thumbnail_url: thumb })) : new Response(new Uint8Array(await jpeg(640)));
    expect(await fetchEmbedThumbnail(vimeo, join(tmp(), 'v.jpg'), fake('https://i.vimeocdn.com/x.jpg'))).toBeDefined();
    expect(await fetchEmbedThumbnail(vimeo, join(tmp(), 'w.jpg'), fake('http://169.254.169.254/latest'))).toBeUndefined();
  });

  it('gives up quietly on network errors', async () => {
    expect(await fetchEmbedThumbnail(yt, join(tmp(), 'x.jpg'), async () => Promise.reject(new Error('offline')))).toBeUndefined();
  });
});

describe('font routing', () => {
  it('serves only font files from the print font packages', () => {
    expect(fontFile('/fonts/newsreader/400.css')).toMatch(/@fontsource\/newsreader\/400\.css$/);
    expect(fontFile('/fonts/newsreader/../../../package.json')).toBeUndefined();
    expect(fontFile('/fonts/newsreader/package.json')).toBeUndefined();
    expect(fontFile('/fonts/left-pad/index.css')).toBeUndefined();
  });
});
