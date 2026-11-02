/**
 * The sound of a page turning (D119): a short breath of filtered noise, made on the spot with the
 * Web Audio API (nothing shipped), quiet, and only if Page sounds is on (lib/library-prefs.ts).
 */

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** A page turning; `quick` when riffling, shorter and softer. */
export function rustle(quick = false): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx ??= new Ctx();
    if (ctx.state === 'suspended') void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.5), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const now = ctx.currentTime;
    const length = quick ? 0.16 : 0.32;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    // Paper: no rumble, no hiss, a soft middle that rises as the page lifts and falls as it lands.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1800, now);
    band.frequency.linearRampToValueAtTime(3200, now + length * 0.5);
    band.frequency.linearRampToValueAtTime(1400, now + length);
    band.Q.value = 0.9;
    const gain = ctx.createGain();
    const loud = quick ? 0.05 : 0.08;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(loud, now + length * 0.25);
    gain.gain.linearRampToValueAtTime(loud * 0.4, now + length * 0.6);
    gain.gain.linearRampToValueAtTime(loud * 0.9, now + length * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    source.connect(band).connect(gain).connect(ctx.destination);
    source.start(now, Math.random() * 0.1, length);
  } catch {
    // No sound here: the page turns anyway.
  }
}
