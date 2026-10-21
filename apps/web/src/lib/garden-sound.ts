/**
 * Garden sounds (D99): a breeze, birdsong by day, crickets at night, and rain when it rains, made
 * with Web Audio as the clock's chime is (no sound files to ship). Nothing plays until Play is
 * pressed; the garden page stops them when it's left or hidden.
 */

export interface GardenScene {
  night: boolean;
  rain: boolean;
}

export interface GardenSounds {
  /** What plays: birds by day, crickets by night; rain hushes both. */
  set(scene: GardenScene): void;
  /** 0 to 1. */
  volume(v: number): void;
  stop(): void;
}

/** Loudness heard for a volume slider's 0 to 1: squared, as ears hear. */
const level = (v: number) => Math.max(0, Math.min(1, v)) ** 2 * 0.9;
const between = (a: number, b: number) => a + Math.random() * (b - a);
/** How far ahead calls are lined up, and how often more are. */
const AHEAD = 0.8;
const TICK_MS = 200;

/** Two seconds of white noise, looped by the breeze and the rain. */
function noise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Starts the garden's sounds, or null where the browser can't make any. */
export function playGardenSounds(scene: GardenScene, volume: number): GardenSounds | null {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  void ctx.resume();
  let now = { ...scene };
  const master = ctx.createGain();
  master.gain.value = level(volume);
  master.connect(ctx.destination);
  const buffer = noise(ctx);

  // The breeze: low noise that swells and settles every 15 seconds or so.
  const air = ctx.createBufferSource();
  air.buffer = buffer;
  air.loop = true;
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 420;
  const breeze = ctx.createGain();
  breeze.gain.value = 0.06;
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.07;
  const depth = ctx.createGain();
  depth.gain.value = 0.04;
  swell.connect(depth).connect(breeze.gain);
  air.connect(low).connect(breeze).connect(master);

  // Rain: brighter noise, faded in and out with the weather.
  const drops = ctx.createBufferSource();
  drops.buffer = buffer;
  drops.loop = true;
  drops.loopStart = 0.37;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1400;
  band.Q.value = 0.4;
  const rain = ctx.createGain();
  rain.gain.value = now.rain ? 0.22 : 0;
  drops.connect(band).connect(rain).connect(master);
  air.start();
  drops.start();
  swell.start();

  const tone = (at: number, from: number, to: number, length: number, gain: number) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.015, length / 3));
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(env).connect(master);
    osc.start(at);
    osc.stop(at + length + 0.02);
  };
  // A bird's call: two to six quick notes that rise or fall.
  const bird = (at: number) => {
    const notes = Math.round(between(2, 6));
    const pitch = between(2200, 4200);
    let t = at;
    for (let i = 0; i < notes; i++) {
      const length = between(0.05, 0.12);
      tone(t, pitch * between(0.9, 1.1), pitch * between(0.75, 1.3), length, 0.05);
      t += length + between(0.02, 0.08);
    }
    return t;
  };
  // A cricket's chirp: three short pulses of one high note.
  const cricket = (at: number) => {
    const pitch = between(4300, 4800);
    for (let i = 0; i < 3; i++) tone(at + i * 0.045, pitch, pitch * 1.01, 0.025, 0.035);
    return at + 0.15;
  };

  // Calls are lined up a little ahead, so a busy page doesn't stutter them.
  let next = ctx.currentTime + 0.3;
  const timer = setInterval(() => {
    while (next < ctx.currentTime + AHEAD) {
      if (now.rain) next += 1;
      else if (now.night) next = cricket(next) + between(0.5, 1.1);
      else next = bird(next) + between(1.2, 4.5);
    }
  }, TICK_MS);

  let stopped = false;
  return {
    set(scene) {
      if (stopped) return;
      now = { ...scene };
      rain.gain.setTargetAtTime(now.rain ? 0.22 : 0, ctx.currentTime, 0.8);
    },
    volume(v) {
      if (!stopped) master.gain.setTargetAtTime(level(v), ctx.currentTime, 0.05);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      // Faded out rather than cut, then the whole sound let go.
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => void ctx.close().catch(() => {}), 400);
    },
  };
}
