import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SIZE_STAGES, TIERS, type Journal, type Plant as PlantData } from '@logbook/core';
import { useJournal } from '../../app/journal-context.tsx';
import { useToast } from '../../app/toasts.tsx';
import { downloadBlob } from '../../lib/backup-io.ts';
import { Dialog, formatLongDate } from '../common.tsx';
import { Plant } from './Plant.tsx';

/**
 * Postcards (D98, the Radiant tier): a picture of one plant (1200 × 1500) or of a month's whole
 * bed (at 2×, at most 2,000 wide), saved as a PNG. They start private: every flower drawn in the
 * same neutral colours, and no title, date or month, until each is added. Entry text never goes
 * on one.
 */

/** The tier that opens Postcards. */
export const POSTCARD_TIER = 6;

export interface PostcardOptions {
  /** Draw each plant's own flower (its mood) instead of the neutral one. */
  moods: boolean;
  /** The plant's title and date, or the bed's month. */
  words: boolean;
}

const SKY_TOP = '#cfe6fb';
const SKY_BOTTOM = '#fbf7f1';
const GROUND = '#9ccc7a';
const GROUND_DEEP = '#7fb25e';
const PAPER = '#fbf7f1';
const INK = '#1d1a17';
const INK_SOFT = '#5a5148';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Room around a plant's box for what reaches past it (glows, rays, crowns). */
const PAD = 70;

const monthName = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** A plant drawn as an image: the image, its box, and how far its look reaches above the box. */
interface PlantImage {
  img: HTMLImageElement;
  w: number;
  h: number;
  above: number;
}

/**
 * How far above its box a plant's tier look reaches, in its own units, from Plant.tsx's geometry
 * (r is its bloom radius): glows, rays and the aurora from Legendary, the nebula from Cosmic, and
 * a Worldbloom's crown inside the nebula's reach.
 */
function reach(tier: number, h: number): number {
  const r = 6 + 0.06 * h;
  return tier >= 11 ? 3 * r + 4 : tier >= 4 ? Math.max(1.3 * r, tier >= 10 ? 0.1 * h : 0) + 4 : 0;
}

/** A plant drawn as an image, the size of its box plus PAD on the sides and top. */
async function plantImage(plant: PlantData, neutral: boolean): Promise<PlantImage> {
  // Drawn by the same component as the garden, outside the page.
  const holder = document.createElement('div');
  const root = createRoot(holder);
  flushSync(() => root.render(<Plant plant={plant} neutral={neutral} />));
  const svg = holder.querySelector('svg')!;
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${w + 2 * PAD} ${h + PAD}`);
  svg.setAttribute('width', String(w + 2 * PAD));
  svg.setAttribute('height', String(h + PAD));
  svg.removeAttribute('class');
  svg.removeAttribute('style');
  const markup = new XMLSerializer().serializeToString(svg);
  root.unmount();
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, w, h, above: reach(plant.tier, h) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draws a plant standing at (x, ground), `scale` times its size. */
function drawPlant(ctx: CanvasRenderingContext2D, p: PlantImage, x: number, ground: number, scale: number) {
  ctx.drawImage(p.img, x - (p.w / 2 + PAD) * scale, ground - (p.h + PAD) * scale, (p.w + 2 * PAD) * scale, (p.h + PAD) * scale);
}

function sky(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, SKY_TOP);
  g.addColorStop(1, SKY_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function ground(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, GROUND);
  g.addColorStop(1, GROUND_DEEP);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/**
 * Without Intl.Segmenter: a flag (a pair of regional indicators), or a character with its marks,
 * skin tones and tags, joined to the next by zero-width joiners. Close enough to keep emoji whole.
 */
const CLUSTER = /\p{RI}\p{RI}|\P{M}[\p{M}\p{Emoji_Modifier}\u{e0020}-\u{e007f}]*(?:\u200d\P{M}[\p{M}\p{Emoji_Modifier}\u{e0020}-\u{e007f}]*)*/gu;

/** Text cut short with "…" to fit `max` pixels, between whole letters and emoji. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  const parts = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((g) => g.segment) : (text.match(CLUSTER) ?? [...text]);
  while (parts.length > 1 && ctx.measureText(`${parts.join('')}…`).width > max) parts.pop();
  return `${parts.join('').trimEnd()}…`;
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The postcard couldn’t be drawn.'))), 'image/png'));
}

export async function plantPostcard(plant: PlantData, opts: PostcardOptions): Promise<Blob> {
  const W = 1200;
  const H = 1500;
  const SCENE = 1160;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  sky(ctx, W, SCENE);
  ground(ctx, 0, 990, W, SCENE - 990);
  const p = await plantImage(plant, !opts.moods);
  // Big enough to see, while a little sprout still looks little next to a tree; and never so big
  // that a crown or a nebula runs off the top.
  const scale = Math.min(9, Math.max(2.5, 820 / p.h), 990 / (p.h + p.above));
  drawPlant(ctx, p, W / 2, 1010, scale);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, SCENE, W, H - SCENE);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 60px ${FONT}`;
  let y = SCENE + 96;
  ctx.fillText(`${TIERS[plant.tier]!.name} ${opts.moods ? plant.species : 'plant'}`, 72, y);
  ctx.font = `500 38px ${FONT}`;
  ctx.fillStyle = INK_SOFT;
  y += 60;
  ctx.fillText(SIZE_STAGES[plant.stage]!.name, 72, y);
  if (opts.words) {
    ctx.fillStyle = INK;
    ctx.font = `650 42px ${FONT}`;
    y += 76;
    ctx.fillText(fit(ctx, plant.entry.title || 'Untitled', W - 144), 72, y);
    ctx.fillStyle = INK_SOFT;
    ctx.font = `500 34px ${FONT}`;
    y += 52;
    ctx.fillText(formatLongDate(plant.entry.date), 72, y);
  }
  footer(ctx, W, H);
  return toPng(canvas);
}

export async function bedPostcard(month: string, plants: PlantData[], opts: PostcardOptions): Promise<Blob> {
  const SCALE = 2;
  // Wide enough for the glow of a rare plant at either end of a row.
  const MARGIN = 96;
  const GAP = 24;
  const GROUND_H = 36;
  const HEAD = 140;
  const FOOT = 90;
  const images: PlantImage[] = [];
  for (const p of plants) images.push(await plantImage(p, !opts.moods));
  const natural = images.reduce((n, p) => n + p.w * SCALE, 0) + GAP * Math.max(0, images.length - 1);
  const W = Math.min(2000, Math.max(1000, natural + 2 * MARGIN));
  // Rows left to right, oldest first, like the bed.
  const rows: PlantImage[][] = [[]];
  let used = 0;
  for (const p of images) {
    const w = p.w * SCALE;
    if (rows.at(-1)!.length && used + GAP + w > W - 2 * MARGIN) {
      rows.push([]);
      used = 0;
    }
    used += (rows.at(-1)!.length ? GAP : 0) + w;
    rows.at(-1)!.push(p);
  }
  // Room for each row's tallest plant and whatever its look reaches above it.
  const rowHeights = rows.map((r) => Math.max(...r.map((p) => (p.h + p.above) * SCALE)) + GROUND_H + 24);
  const H = HEAD + rowHeights.reduce((a, b) => a + b, 0) + FOOT;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  sky(ctx, W, H);

  // The bed's sign.
  ctx.font = `700 44px ${FONT}`;
  const sign = opts.words ? `${monthName(month)} · ${plants.length === 1 ? '1 plant' : `${plants.length} plants`}` : plants.length === 1 ? '1 plant' : `${plants.length} plants`;
  const signW = ctx.measureText(sign).width + 48;
  ctx.fillStyle = '#8b5e34';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(MARGIN, 40, signW, 70, 14);
  else ctx.rect(MARGIN, 40, signW, 70);
  ctx.fill();
  ctx.fillStyle = '#fff8ec';
  ctx.textBaseline = 'middle';
  ctx.fillText(sign, MARGIN + 24, 76);

  let top = HEAD;
  rows.forEach((row, r) => {
    const base = top + rowHeights[r]! - GROUND_H;
    ground(ctx, MARGIN / 2, base - 6, W - MARGIN, GROUND_H + 6);
    const width = row.reduce((n, p) => n + p.w * SCALE, 0) + GAP * (row.length - 1);
    let x = (W - width) / 2;
    for (const p of row) {
      drawPlant(ctx, p, x + (p.w * SCALE) / 2, base, SCALE);
      x += p.w * SCALE + GAP;
    }
    top += rowHeights[r]!;
  });
  footer(ctx, W, H);
  return toPng(canvas);
}

function footer(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = '#6f655a';
  ctx.font = `500 28px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Grown in Logbook', W - 48, H - 40);
  ctx.textAlign = 'left';
}

/** Saves it like an export: the apps ask where, the browser downloads it. False when cancelled. */
async function savePostcard(journal: Journal, blob: Blob, name: string): Promise<boolean> {
  if (import.meta.env.VITE_PLATFORM !== 'web') {
    const { saveFile } = await import('../../desktop/bridge.ts');
    return (await saveFile(blob, name, () => !journal.isLocked)) !== null;
  }
  downloadBlob(blob, name);
  return true;
}

/** Choosing what goes on a postcard of a month's bed, or of one plant in it. */
export function PostcardDialog({ month, plants, onClose }: { month: string; plants: PlantData[]; onClose: () => void }) {
  const { journal } = useJournal();
  const toast = useToast();
  const [plantId, setPlantId] = useState('');
  const [opts, setOpts] = useState<PostcardOptions>({ moods: false, words: false });
  // A picture remembers what it was drawn from: one drawn from other choices is never shown as
  // ready or saved, however quickly the choices change.
  const [card, setCard] = useState<{ blob: Blob; url: string; opts: PostcardOptions; plant?: PlantData; plants: PlantData[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const plant = plants.find((p) => p.entry.id === plantId);
  const ready = card && card.opts === opts && card.plant === plant && card.plants === plants ? card : null;

  useEffect(() => {
    let alive = true;
    setFailed(false);
    // After this render: the plants are drawn by React, outside the page.
    void Promise.resolve()
      .then(() => (plant ? plantPostcard(plant, opts) : bedPostcard(month, plants, opts)))
      .then((blob) => alive && setCard({ blob, url: URL.createObjectURL(blob), opts, plant, plants }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [plant, plants, month, opts]);
  // A picture's address lasts as long as the picture: until a new one replaces it, or the dialog
  // closes. Going back to the choices it was drawn from shows it again at once.
  useEffect(
    () => () => {
      if (card) URL.revokeObjectURL(card.url);
    },
    [card],
  );

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      // The name gives the date away too, so it has one only when the picture does.
      const name = ready.opts.words ? `garden-${ready.plant ? ready.plant.entry.date : month}.png` : 'garden-postcard.png';
      if (await savePostcard(journal, ready.blob, name)) toast('📮 Postcard saved.');
    } catch (err) {
      toast(`Couldn’t save the postcard: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Postcard of ${monthName(month)}`}
      actions={
        <>
          {/* Closed as a dialog, so focus goes back to the button that opened it. */}
          <button type="button" className="btn" onClick={(e) => e.currentTarget.closest('dialog')?.close()}>
            Close
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save picture'}
          </button>
        </>
      }
    >
      <div className="postcard-form">
        <label className="field">
          <span>Picture of</span>
          <select
            className="text-input"
            value={plantId}
            onChange={(e) => {
              // "Show the month" isn't "Show the title and date": switching between the bed and a
              // plant starts that choice again.
              if (Boolean(e.target.value) !== Boolean(plantId)) setOpts({ ...opts, words: false });
              setPlantId(e.target.value);
            }}
          >
            <option value="">The whole bed ({plants.length === 1 ? '1 plant' : `${plants.length} plants`})</option>
            {plants.map((p) => (
              <option key={p.entry.id} value={p.entry.id}>
                {p.entry.title || 'Untitled'} · {formatLongDate(p.entry.date, { day: 'numeric', month: 'short' })}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">It starts private: every flower looks the same, with no titles or dates. Add only what you want to share.</p>
        <label className="row postcard-option">
          <input type="checkbox" checked={opts.moods} onChange={(e) => setOpts({ ...opts, moods: e.target.checked })} />
          <span>
            Show the flowers
            <span className="hint"> · shows which mood each entry had</span>
          </span>
        </label>
        <label className="row postcard-option">
          <input type="checkbox" checked={opts.words} onChange={(e) => setOpts({ ...opts, words: e.target.checked })} />
          <span>
            {plant ? 'Show the title and date' : 'Show the month'}
            <span className="hint"> · {plant ? 'the entry’s title, not its text' : 'when these entries were'}</span>
          </span>
        </label>
      </div>
      <div className="postcard-preview">
        {failed ? <p className="error">The postcard couldn’t be drawn.</p> : ready ? <img src={ready.url} alt="Postcard preview" /> : <p className="muted">Drawing…</p>}
      </div>
    </Dialog>
  );
}
