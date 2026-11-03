import { MOODS, RACK_ROOM, SHELF_ROOM, bookMetres, FOLDER_HEIGHT, type Book, type RackThing, type ShelfThing } from '@logbook/core';

/**
 * What the walls of the 3D Library (D113) show, painted on canvases: every spine on a bookcase in
 * one picture, every folder's edge on a rack in another, each laid out as the shelves are (a row a
 * shelf, left to right as you face it), so one texture and one mesh draw a whole wall. A close
 * version (titles, days) for the room you're in; a plain one (colours, bands) for further off.
 * Where a thing sits in the picture is worked out from metres alone (`AtlasLayout`), so either
 * version fits the same mesh.
 */

/** The same colours as the flat shelves' spines (app.css), all lettered in cream at 5.5:1 or more. */
const MOOD_SPINES = ['#8f4a12', '#2f6b3a', '#55555f', '#3b4f7a', '#25456c', '#8e1f1f', '#4b3f72', '#74368a', '#952c5a', '#2b5c60'];
const TONES = ['#6b3e26', '#5b2333', '#2c3e50', '#33472f'];
const CREAM = '#f7efdc';
const GILT = '#d9b35b';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const TYPE = 'ui-monospace, Menlo, Consolas, monospace';

export function spineColour(book: Book): string {
  const m = book.mood ? MOODS.indexOf(book.mood) : -1;
  return m >= 0 ? MOOD_SPINES[m]! : TONES[book.tone]!;
}

/** A wall's picture: `rows` shelves of `room` metres, each `rowMetres` tall. */
export interface AtlasLayout {
  room: number;
  rows: number;
  rowMetres: number;
}
export const BOOK_WALL: AtlasLayout = { room: SHELF_ROOM, rows: 5, rowMetres: 0.36 };
export const FOLDER_RACK: AtlasLayout = { room: RACK_ROOM, rows: 5, rowMetres: 0.38 };

/** Where something `x` metres along shelf `row`, `width` wide and `height` tall, is in the picture (0–1, v up as WebGL has it). */
export function atlasRect(layout: AtlasLayout, row: number, x: number, width: number, height: number): { u0: number; u1: number; v0: number; v1: number } {
  const total = layout.rows * layout.rowMetres;
  const bottom = (row + 1) * layout.rowMetres - 0.01;
  return { u0: x / layout.room, u1: (x + width) / layout.room, v0: 1 - bottom / total, v1: 1 - (bottom - height) / total };
}

function canvasFor(layout: AtlasLayout, widthPx: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; scale: number } {
  const canvas = document.createElement('canvas');
  const scale = widthPx / layout.room;
  canvas.width = widthPx;
  canvas.height = Math.ceil(layout.rows * layout.rowMetres * scale);
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx, scale };
}

/** Text that fits `max` pixels, cut with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo ? `${text.slice(0, lo).trimEnd()}…` : '';
}

/** Writes `text` up a spine (top to bottom, as on English spines) between y0 and y1, centred on x. */
function upTheSpine(ctx: CanvasRenderingContext2D, text: string, x: number, y0: number, y1: number, size: number, font: string, colour: string) {
  ctx.save();
  ctx.translate(x, y0);
  ctx.rotate(Math.PI / 2);
  ctx.font = `600 ${size}px ${font}`;
  ctx.fillStyle = colour;
  ctx.textBaseline = 'middle';
  ctx.fillText(fit(ctx, text, y1 - y0), 0, 0);
  ctx.restore();
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const shortMonth = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`;

/** A bookcase's spines, a row a shelf. `close`: titles and days; otherwise colours and gilt bands only. */
export function paintBookWall(shelves: ShelfThing[][], close: boolean): HTMLCanvasElement {
  const { canvas, ctx, scale } = canvasFor(BOOK_WALL, close ? 2048 : 512);
  shelves.forEach((row, r) => {
    for (const thing of row) {
      const x = thing.x * scale;
      const w = thing.width * scale;
      if (thing.kind === 'divider') {
        const h = 0.24 * scale;
        const y = (r + 1) * BOOK_WALL.rowMetres * scale - 0.01 * scale;
        ctx.fillStyle = '#b38a3e';
        ctx.fillRect(x, y - h, w, h);
        if (close) upTheSpine(ctx, shortMonth(thing.month), x + w / 2, y - h + 8, y - 6, Math.min(w * 0.7, 14), FONT, '#2a1d0e');
        continue;
      }
      const { height } = bookMetres(thing.book);
      const h = height * scale;
      const bottom = (r + 1) * BOOK_WALL.rowMetres * scale - 0.01 * scale;
      const top = bottom - h;
      ctx.fillStyle = spineColour(thing.book);
      ctx.fillRect(x, top, w, h);
      // Light from the left, shadow to the right.
      const shade = ctx.createLinearGradient(x, 0, x + w, 0);
      shade.addColorStop(0, 'rgba(255,255,255,0.12)');
      shade.addColorStop(0.4, 'rgba(255,255,255,0)');
      shade.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = shade;
      ctx.fillRect(x, top, w, h);
      // Gilt bands near the head and the foot.
      ctx.fillStyle = GILT;
      ctx.fillRect(x, top + h * 0.05, w, Math.max(1, h * 0.015));
      ctx.fillRect(x, bottom - h * 0.17, w, Math.max(1, h * 0.015));
      // A line between books.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x + w - Math.max(1, scale * 0.002), top, Math.max(1, scale * 0.002), h);
      // A letter to your future self, still sealed (D122): a wax seal across the spine.
      if (thing.book.sealed) waxSeal(ctx, x + w / 2, top + h * 0.5, Math.max(2, Math.min(w * 0.45, scale * 0.028)));
      if (!close) continue;
      const size = Math.max(10, Math.min(w * 0.5, 22));
      upTheSpine(ctx, thing.book.title.trim() || 'Untitled', x + w / 2, top + h * 0.09, bottom - h * 0.2, size, FONT, CREAM);
      ctx.font = `700 ${Math.max(9, Math.min(w * 0.42, 16))}px ${FONT}`;
      ctx.fillStyle = CREAM;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Number(thing.book.date.slice(8))), x + w / 2, bottom - h * 0.085);
      ctx.textAlign = 'start';
    }
  });
  return canvas;
}

/** A blob of red sealing wax, pressed (D122). */
function waxSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.fillStyle = '#8e1b1b';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 210, 190, 0.45)';
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
  ctx.stroke();
}

/** A rack's folder edges, a row a shelf: manila, a typed label with the title, a mood-coloured tab; green guide cards between months. */
export function paintFolderRack(shelves: RackThing[][], close: boolean): HTMLCanvasElement {
  const { canvas, ctx, scale } = canvasFor(FOLDER_RACK, close ? 1024 : 256);
  shelves.forEach((row, r) => {
    const bottom = (r + 1) * FOLDER_RACK.rowMetres * scale - 0.01 * scale;
    for (const thing of row) {
      const x = thing.x * scale;
      const w = thing.width * scale;
      if (thing.kind === 'guide') {
        const h = 0.34 * scale;
        ctx.fillStyle = '#3f6b4f';
        ctx.fillRect(x, bottom - h, w, h);
        if (close) upTheSpine(ctx, shortMonth(thing.month), x + w / 2, bottom - h + 6, bottom - 6, Math.min(w * 0.75, 11), TYPE, '#ffffff');
        continue;
      }
      const h = FOLDER_HEIGHT * scale;
      const top = bottom - h;
      ctx.fillStyle = '#e2c58a';
      ctx.fillRect(x, top, w, h);
      ctx.fillStyle = 'rgba(120,90,40,0.45)';
      ctx.fillRect(x + w - 1, top, 1, h);
      // The tab: the entry's mood (or its leather), so a run of folders reads like a chart.
      ctx.fillStyle = spineColour(thing.book);
      ctx.fillRect(x, top, w, h * 0.12);
      // The label.
      ctx.fillStyle = '#fffdf6';
      ctx.fillRect(x + w * 0.12, top + h * 0.16, w * 0.76, h * 0.7);
      // A letter to your future self, still sealed (D122): a wax seal on the edge.
      if (thing.book.sealed) waxSeal(ctx, x + w / 2, top + h * 0.5, Math.max(2, Math.min(w * 0.45, scale * 0.03)));
      if (!close) continue;
      upTheSpine(ctx, thing.book.title.trim() || 'Untitled', x + w / 2, top + h * 0.18, top + h * 0.84, Math.max(8, Math.min(w * 0.55, 13)), TYPE, '#1f1d1a');
      ctx.font = `700 ${Math.max(7, Math.min(w * 0.45, 10))}px ${TYPE}`;
      ctx.fillStyle = '#3a2c12';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Number(thing.book.date.slice(8))), x + w / 2, bottom - h * 0.07);
      ctx.textAlign = 'start';
    }
  });
  return canvas;
}

/** A sign: a wooden plaque with a gilt edge in the Library, a white card in the storage room. */
export function paintSign(text: string, sub: string, style: 'library' | 'storage'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  if (style === 'library') {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#6b4226');
    g.addColorStop(1, '#3f2614');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = GILT;
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, 1004, 236);
  } else {
    ctx.fillStyle = '#f4f2ec';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(0, 0, 1024, 18);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style === 'library' ? CREAM : '#1f1d1a';
  ctx.font = `700 ${sub ? 86 : 100}px ${style === 'library' ? 'Georgia, "Times New Roman", serif' : TYPE}`;
  ctx.fillText(fit(ctx, text, 960), 512, sub ? 104 : 132);
  if (sub) {
    ctx.font = `500 50px ${style === 'library' ? FONT : TYPE}`;
    ctx.fillText(fit(ctx, sub, 960), 512, 196);
  }
  return canvas;
}
