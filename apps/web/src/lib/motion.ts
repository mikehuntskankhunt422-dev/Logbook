import confetti from 'canvas-confetti';
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = matchMedia(QUERY);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Spring presets for motion/react. Collapsed to instant when the user prefers reduced motion. */
export function spring(reduced: boolean) {
  return reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 26, mass: 0.8 };
}

const COLORS = ['#ff5f6d', '#ffc371', '#00c6ff', '#8e2de2', '#43e97b', '#f5576c'];

/** Confetti for real milestones only. Silent when reduced motion is requested. */
export function celebrate(kind: 'entry' | 'streak' | 'backup' = 'entry'): void {
  if (prefersReducedMotion()) return;
  const base = { colors: COLORS, disableForReducedMotion: true, zIndex: 80 };
  if (kind === 'streak') {
    void confetti({ ...base, particleCount: 140, spread: 90, startVelocity: 45, origin: { y: 0.3 } });
    setTimeout(() => void confetti({ ...base, particleCount: 80, angle: 60, spread: 70, origin: { x: 0, y: 0.6 } }), 180);
    setTimeout(() => void confetti({ ...base, particleCount: 80, angle: 120, spread: 70, origin: { x: 1, y: 0.6 } }), 320);
  } else {
    void confetti({ ...base, particleCount: kind === 'backup' ? 60 : 90, spread: 70, origin: { y: 0.7 } });
  }
}

/** Stable small tilt for a polaroid, derived from its id so it doesn't jump between renders. */
export function tiltFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  const deg = ((Math.abs(h) % 50) - 25) / 10; // -2.5° … +2.4°
  return `${deg.toFixed(1)}deg`;
}
