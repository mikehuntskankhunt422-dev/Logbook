import { encode } from 'uqr';

/**
 * A QR code as one opaque SVG path (no transparency, vector at any print size), with the standard
 * four-module quiet zone painted white so it scans on any background.
 */
export function qrSvg(text: string, label = 'QR code'): string {
  const qr = encode(text, { ecc: 'M', border: 4 });
  let d = '';
  qr.data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      d += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  const n = qr.size;
  return (
    `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${label.replace(/["<>&]/g, '')}">` +
    `<rect width="${n}" height="${n}" fill="#ffffff"/><path fill="#000000" d="${d}"/></svg>`
  );
}
