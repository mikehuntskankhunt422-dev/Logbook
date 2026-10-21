import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Weather } from '@logbook/core';
import { playGardenSounds, type GardenSounds } from '../../lib/garden-sound.ts';
import { setGardenPrefs } from '../../lib/garden-prefs.ts';

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

/**
 * The weather over the garden (D99): rain, snow or petals on one canvas covering the window,
 * drawn only where the garden is on screen, so a long garden costs no more than a short one. It
 * hangs off the document's body, where no animated page can move it. At most 120 at a time, 30
 * frames a second, and only while the garden is on screen: nothing runs when it's scrolled away or
 * the page is hidden. With reduced motion or forced colours it isn't there at all (the beds' still
 * snow, puddles or petals show the weather).
 */

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
    const garden = scene.current;
    if (!c || !ctx || !garden || weather === 'clear') return;
    let drops: Drop[] = [];
    let dpr = 0;
    // The drawing surface matches the canvas's own box, at the screen's density (which changes
    // when a window moves to another screen, with no resize).
    const fit = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const sizes = new ResizeObserver(fit);
    sizes.observe(c);

    let frame = 0;
    let last = 0;
    let drawn = false;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // Two frames of a 60 Hz screen can measure a little under 33.3 ms: a frame is due a bit early.
      if (now - last < FRAME_MS - 4) return;
      // Frames stop while the page is hidden; the first one back doesn't jump.
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      if (Math.min(2, window.devicePixelRatio || 1) !== dpr) fit();
      const width0 = c.clientWidth;
      const height0 = c.clientHeight;
      if (drawn) ctx.clearRect(0, 0, width0, height0);
      drawn = false;
      const box = garden.getBoundingClientRect();
      // The part of the garden on screen, in the garden's own coordinates: drops are kept in
      // those, so scrolling carries them with the garden.
      const left = Math.max(0, -box.left);
      const top = Math.max(0, -box.top);
      const width = Math.min(width0, box.right) - Math.max(0, box.left);
      const height = Math.min(height0, box.bottom) - Math.max(0, box.top);
      if (width <= 0 || height <= 0) return;
      // As many as suit the garden on screen, up to MAX.
      const want = Math.min(MAX, Math.round((width * height) / 9000));
      while (drops.length < want) drops.push(drop(weather, left, width, top, height));
      if (drops.length > want) drops = drops.slice(0, want);
      ctx.save();
      ctx.translate(box.left, box.top);
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip();
      for (const d of drops) {
        const was = d.y;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.turn += d.spin * dt;
        // Blown out at one side, back in at the other.
        if (d.x < left || d.x > left + width) d.x = left + ((((d.x - left) % width) + width) % width);
        const bottom = top + height + 20;
        // Fallen past the bottom: back in at the top. Left out of view by a scroll: back in
        // anywhere on screen, so they don't all come in at once along one line.
        if (d.y > bottom) Object.assign(d, was <= bottom ? drop(weather, left, width, top - 20, 0) : drop(weather, left, width, top, height));
        else if (d.y < top - 40) Object.assign(d, drop(weather, left, width, top, height));
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
      drawn = true;
    };
    // Only while the garden is on screen.
    const seen = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(frame);
      if (e?.isIntersecting) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      } else if (drawn) {
        ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
        drawn = false;
      }
    });
    seen.observe(garden);
    return () => {
      seen.disconnect();
      sizes.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [weather, night, scene]);

  if (weather === 'clear') return null;
  return createPortal(<canvas ref={canvas} className="garden-weather" aria-hidden="true" />, document.body);
}

/**
 * Today's date and whether the app is dark, kept current while the garden is open: a page left
 * open past midnight gets the new day's weather, and one that turns dark at sunset its night.
 */
export function useGardenNow(): { day: string; dark: boolean } {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', refresh);
    const theme = new MutationObserver(refresh);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const back = () => !document.hidden && refresh();
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(timer);
      scheme.removeEventListener('change', refresh);
      theme.disconnect();
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  return { day: today(), dark: isDark() };
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
