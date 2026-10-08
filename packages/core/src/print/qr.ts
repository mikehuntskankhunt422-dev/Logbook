import { encode } from 'uqr';

/**
 * A QR code as a self-contained SVG: one solid black path on a white square, no transparency, so it
 * survives Lulu's flattening rules. Medium error correction tolerates scuffs on paper.
 */
export function qrSvg(text: string, sizeIn: number, label = 'QR code'): string {
  const { data, size } = encode(text, { ecc: 'M', border: 0 });
  const quiet = 2;
  const n = size + quiet * 2;
  let d = '';
  for (let y = 0; y < size; y++) {
    const row = data[y]!;
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue;
      // Merge horizontal runs into one rectangle.
      let run = 1;
      while (x + run < size && row[x + run]) run++;
      d += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  return (
    `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${sizeIn}in" height="${sizeIn}in" role="img" aria-label="${escapeAttr(label)}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`
  );
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
