import { deflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';

/** A real 64×48 PNG (solid colour) so createImageBitmap, dimensions and polaroids behave normally. */
export function png(color: [number, number, number] = [255, 120, 80]): Buffer {
  const w = 64;
  const h = 48;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(color, y * (w * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** Opens a new entry, fills title and body, waits for the autosave to land. */
export async function writeEntry(page: Page, title: string, body: string): Promise<void> {
  await page.goto('/#/new');
  await page.getByLabel('Title').fill(title);
  const editor = page.getByRole('textbox', { name: 'Entry text' });
  await editor.click();
  await page.keyboard.type(body);
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect(page).toHaveURL(/#\/entry\//);
}
