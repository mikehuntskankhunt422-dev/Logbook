import { useEffect, useRef } from 'react';

/**
 * The Unwritten has you (Intense horror, D116): its blank page of a face fills the screen, small
 * and blown up into hard pixels, for a moment, before you wake at the door. One sudden picture, not
 * a flashing one; with reduced motion it doesn't shake or lunge.
 */
export function Scare({ reduced, onDone }: { reduced: boolean; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const g = canvas.current?.getContext('2d');
    if (g) paintFace(g);
    const timer = setTimeout(() => done.current(), 1700);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="scare" data-still={reduced || undefined} role="alert">
      <canvas ref={canvas} width={64} height={48} aria-hidden="true" />
      <p className="sr-only">The Unwritten caught you.</p>
    </div>
  );
}

/** The face: a page with nothing written on it, ink running from where its eyes should be. */
function paintFace(g: CanvasRenderingContext2D) {
  g.fillStyle = '#0b0303';
  g.fillRect(0, 0, 64, 48);
  // The coat's collar, either side.
  g.fillStyle = '#16100d';
  g.beginPath();
  g.moveTo(0, 48);
  g.lineTo(0, 30);
  g.lineTo(14, 48);
  g.moveTo(64, 48);
  g.lineTo(64, 30);
  g.lineTo(50, 48);
  g.fill();
  g.save();
  g.translate(32, 24);
  g.rotate(-0.07);
  g.translate(-32, -24);
  g.fillStyle = '#e4ddcb';
  g.fillRect(15, 1, 34, 46);
  g.fillStyle = '#9fb0c8';
  for (let y = 6; y < 47; y += 4) g.fillRect(15, y, 34, 1);
  g.fillStyle = '#c98f8f';
  g.fillRect(20, 1, 1, 46);
  // Where its eyes should be: ink, running down the lines.
  g.fillStyle = '#060404';
  for (const [x, a, b] of [
    [26, 15, 8],
    [39, 9, 17],
  ] as const) {
    // A blot, not a circle: ink that soaked in where it landed.
    for (const [dx, dy, r] of [
      [0, 0, 3.2],
      [1.6, -1.2, 2.1],
      [-1.8, 0.7, 1.9],
      [0.5, 2, 1.7],
      [-0.6, -2, 1.4],
    ] as const) {
      g.beginPath();
      g.arc(x + dx, 17 + dy, r, 0, Math.PI * 2);
      g.fill();
    }
    // And running down the lines, unevenly.
    g.fillRect(x - 2, 18, 1, a);
    g.fillRect(x, 19, 1, Math.round((a + b) / 2));
    g.fillRect(x + 2, 18, 1, b);
  }
  // And a tear across the page where a mouth would be.
  g.beginPath();
  g.moveTo(25, 35);
  for (let x = 25; x <= 41; x += 2) g.lineTo(x, 34 + ((x * 7) % 5) - 1);
  for (let x = 41; x >= 25; x -= 2) g.lineTo(x, 37 + ((x * 3) % 3));
  g.closePath();
  g.fill();
  g.restore();
  // Grain.
  for (let i = 0; i < 140; i++) {
    g.fillStyle = i % 2 ? 'rgba(0,0,0,0.35)' : 'rgba(255,240,220,0.08)';
    g.fillRect((i * 37) % 64, (i * 23) % 48, 1, 1);
  }
}
