import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Weather } from '@logbook/core';
import { playGardenSounds, type GardenSounds } from '../../lib/garden-sound.ts';
import { setGardenPrefs } from '../../lib/garden-prefs.ts';

/**
 * The weather over the garden (D99): rain, snow or petals on one canvas the size of the window,
 * drawn only where the garden is on screen, so a long garden costs no more than a short one. At
 * most 120 at a time, 30 frames a second; nothing moves with reduced motion (the beds' still
 * snow, puddles or petals show the weather instead), and nothing is drawn while the page is hidden.
 */

/** The tiers that open Seasons and weather (Prismatic) and Garden sounds (Legendary). */
export const SEASONS_TIER = 7;
export const SOUNDS_TIER = 4;

/** Today's date where the device is, "2026-10-21": the day's weather follows the local day. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whether the app is dark now (chosen, or following the system): the garden's night. */
export function isDark(): boolean {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

const MAX = 120;
const FRAME_MS = 1000 / 30;
const PETALS = ['#ffb7c5', '#ff8fab', '#fbcfe8', '#f9a8d4', '#fde68a'];

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  turn: number;
  spin: number;
  colour: string;
}

function drop(weather: Weather, left: number, width: number, top: number, height: number): Drop {
  const r = Math.random;
  const base = { x: left + r() * width, y: top + r() * height, turn: r() * Math.PI, spin: (r() - 0.5) * 3, colour: PETALS[Math.floor(r() * PETALS.length)]! };
  if (weather === 'rain') return { ...base, vx: -60, vy: 520 + r() * 220, size: 10 + r() * 8 };
  if (weather === 'snow') return { ...base, vx: (r() - 0.5) * 30, vy: 28 + r() * 36, size: 1.4 + r() * 2.2 };
  return { ...base, vx: 20 + r() * 30, vy: 34 + r() * 30, size: 3 + r() * 2 };
}

export function WeatherLayer({ weather, night, scene }: { weather: Weather; night: boolean; scene: RefObject<HTMLElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || weather === 'clear') return;
    let drops: Drop[] = [];
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(innerWidth * dpr);
      c.height = Math.round(innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    addEventListener('resize', fit);

    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      // Frames stop while the page is hidden; the first one back doesn't jump.
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const box = scene.current?.getBoundingClientRect();
      if (!box) return;
      const left = Math.max(0, box.left);
      const top = Math.max(0, box.top);
      const width = Math.min(innerWidth, box.right) - left;
      const height = Math.min(innerHeight, box.bottom) - top;
      if (width <= 0 || height <= 0) return;
      // As many as suit the garden on screen, up to MAX.
      const want = Math.min(MAX, Math.round((width * height) / 9000));
      while (drops.length < want) drops.push(drop(weather, left, width, top, height));
      if (drops.length > want) drops = drops.slice(0, want);
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip();
      for (const d of drops) {
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.turn += d.spin * dt;
        // Out of the garden on screen: back in at its top, anywhere along it.
        if (d.y > top + height + 20 || d.x < left - 20 || d.x > left + width + 20) Object.assign(d, drop(weather, left, width, top - 20, 0));
        if (weather === 'rain') {
          ctx.strokeStyle = night ? 'rgb(190 210 245 / 0.55)' : 'rgb(70 120 190 / 0.45)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x + (d.vx / d.vy) * d.size, d.y + d.size);
          ctx.stroke();
        } else if (weather === 'snow') {
          ctx.fillStyle = 'rgb(255 255 255 / 0.92)';
          ctx.strokeStyle = night ? 'rgb(255 255 255 / 0.3)' : 'rgb(120 150 190 / 0.45)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = d.colour;
          ctx.beginPath();
          ctx.ellipse(d.x, d.y, d.size, d.size * 0.55, d.turn, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', fit);
      ctx.clearRect(0, 0, c.width, c.height);
    };
  }, [weather, night, scene]);

  if (weather === 'clear') return null;
  return <canvas ref={canvas} className="garden-weather" aria-hidden="true" />;
}

/**
 * Garden sounds' Play button and volume (D99). Never plays by itself: it starts on Play, and
 * stops on Pause, when the garden page is left (this unmounts) or when the page is hidden.
 */
export function SoundControls({ night, rain, volume }: { night: boolean; rain: boolean; volume: number }) {
  const [playing, setPlaying] = useState(false);
  const sounds = useRef<GardenSounds | null>(null);
  const stop = useCallback(() => {
    sounds.current?.stop();
    sounds.current = null;
    setPlaying(false);
  }, []);
  // Started by the tap itself: browsers let a page make sound only after one.
  const toggle = () => {
    if (sounds.current) return stop();
    sounds.current = playGardenSounds({ night, rain }, volume);
    setPlaying(Boolean(sounds.current));
  };

  useEffect(() => {
    if (!playing) return;
    const hide = () => document.hidden && stop();
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [playing, stop]);
  // Leaving the garden page stops them.
  useEffect(() => stop, [stop]);
  useEffect(() => sounds.current?.set({ night, rain }), [night, rain]);
  useEffect(() => sounds.current?.volume(volume), [volume]);

  return (
    <div className="garden-sound row" role="group" aria-label="Garden sounds">
      <button type="button" className="btn btn-small" aria-pressed={playing} onClick={toggle}>
        <span aria-hidden="true">{playing ? '🔊' : '🔈'} </span>Garden sounds
      </button>
      <label className="row garden-volume">
        <span>Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setGardenPrefs({ soundVolume: Number(e.target.value) })} />
      </label>
    </div>
  );
}
