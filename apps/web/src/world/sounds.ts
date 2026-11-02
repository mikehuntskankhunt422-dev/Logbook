/**
 * Horror's sounds in the walking Library (D116), made with Web Audio (no files to ship): a low hum
 * where The Unwritten walks, its footsteps coming closer from where it is, a breath when it goes,
 * and, on Intense, the scream when it catches you. Silent unless horror and its sounds are on, and
 * only once the page has been touched or a key pressed, as browsers require.
 */
export interface Sounds {
  /** After a tap or a key: sound is allowed from now on. */
  wake(): void;
  setOn(on: boolean): void;
  hum(on: boolean): void;
  /** A footstep, from `pan` (-1 left to 1 right), as loud as `level` (0–1). */
  step(level: number, pan: number): void;
  breath(): void;
  scream(): void;
  /** Face to face with him, suddenly (D119): a short, sharp chord. */
  sting(): void;
  /** The lamps going out (D119): a low thud and the hum dropping away; and coming back. */
  lampsOut(): void;
  lampsOn(): void;
  /** A whisper, from `pan` (D119): breath shaped like words, with no words in it. */
  whisper(pan: number): void;
  dispose(): void;
}

export function createSounds(): Sounds {
  let ctx: AudioContext | null = null;
  let on = false;
  let drone: { stop(): void; gain: GainNode } | null = null;
  let noise: AudioBuffer | null = null;

  const live = () => (on && ctx && ctx.state === 'running' ? ctx : null);
  const noiseBuffer = (c: AudioContext) => {
    if (noise) return noise;
    noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noise;
  };
  /** A burst of noise through a filter, shaped by an attack and a decay. */
  const burst = (c: AudioContext, at: number, filter: BiquadFilterType, freq: number, peak: number, attack: number, decay: number, pan = 0) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f).connect(g).connect(p).connect(c.destination);
    src.start(at, Math.random());
    src.stop(at + attack + decay + 0.05);
  };

  const sounds: Sounds = {
    wake() {
      try {
        ctx ??= new AudioContext();
        void ctx.resume();
      } catch {
        ctx = null;
      }
    },
    setOn(next) {
      on = next;
      if (!on) sounds.hum(false);
    },
    hum(want) {
      const c = live();
      if (!want || !c) {
        if (drone) {
          const d = drone;
          drone = null;
          if (ctx) d.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
          setTimeout(() => d.stop(), 1500);
        }
        return;
      }
      if (drone) return;
      const gain = c.createGain();
      gain.gain.value = 0.0001;
      gain.gain.setTargetAtTime(0.06, c.currentTime, 1.2);
      const low = c.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 220;
      const oscs = [55, 55.7, 82.4].map((f) => {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(low);
        o.start();
        return o;
      });
      low.connect(gain).connect(c.destination);
      drone = { gain, stop: () => oscs.forEach((o) => o.stop()) };
    },
    step(level, pan) {
      const c = live();
      if (!c || level <= 0.01) return;
      burst(c, c.currentTime, 'bandpass', 420, 0.5 * level, 0.008, 0.11, pan);
    },
    breath() {
      const c = live();
      if (!c) return;
      burst(c, c.currentTime, 'bandpass', 2600, 0.12, 0.5, 1.1);
    },
    scream() {
      const c = live();
      if (!c) return;
      const at = c.currentTime;
      burst(c, at, 'highpass', 900, 0.6, 0.01, 1.2);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.28, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
      g.connect(c.destination);
      for (const f of [116, 123, 247, 349, 466]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, at);
        o.frequency.exponentialRampToValueAtTime(f * 0.7, at + 1.4);
        o.connect(g);
        o.start(at);
        o.stop(at + 1.45);
      }
    },
    sting() {
      const c = live();
      if (!c) return;
      const at = c.currentTime;
      burst(c, at, 'highpass', 1400, 0.35, 0.005, 0.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.2, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
      g.connect(c.destination);
      for (const f of [311, 330, 466, 494]) {
        const o = c.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(f, at);
        o.connect(g);
        o.start(at);
        o.stop(at + 0.75);
      }
    },
    lampsOut() {
      const c = live();
      if (!c) return;
      burst(c, c.currentTime, 'lowpass', 140, 0.5, 0.01, 0.6);
      if (drone) drone.gain.gain.setTargetAtTime(0.012, c.currentTime, 0.15);
    },
    lampsOn() {
      const c = live();
      if (!c) return;
      if (drone) drone.gain.gain.setTargetAtTime(0.06, c.currentTime, 0.6);
    },
    whisper(pan) {
      const c = live();
      if (!c) return;
      // Syllables of breath: a handful of short, shaped hisses, unevenly spaced.
      let at = c.currentTime;
      for (let i = 0; i < 7; i++) {
        burst(c, at, 'bandpass', 2200 + Math.random() * 1800, 0.05 + Math.random() * 0.04, 0.03, 0.09 + Math.random() * 0.12, pan);
        at += 0.12 + Math.random() * 0.16;
      }
    },
    dispose() {
      sounds.hum(false);
      on = false;
      const c = ctx;
      ctx = null;
      if (c) setTimeout(() => void c.close().catch(() => {}), 1600);
    },
  };
  return sounds;
}
