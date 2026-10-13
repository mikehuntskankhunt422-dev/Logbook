/**
 * The clock's ringing (D92): three rising notes every 1.5 seconds, made with Web Audio (no sound
 * file to ship), and a buzz on phones. It stops by itself after five minutes.
 */

let ctx: AudioContext | null = null;

/**
 * Called on a tap (Start, Save an alarm): browsers let a page make sound later only once it has
 * been tapped.
 */
export function primeSound(): void {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function startChime(): () => void {
  primeSound();
  const c = ctx;
  const note = (at: number, freq: number) => {
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
    osc.connect(gain).connect(c.destination);
    osc.start(at);
    osc.stop(at + 0.45);
  };
  const ring = () => {
    if (c) {
      const t = c.currentTime + 0.05;
      note(t, 880);
      note(t + 0.18, 1175);
      note(t + 0.36, 1568);
    }
    navigator.vibrate?.([300, 150, 300]);
  };
  ring();
  const timer = setInterval(ring, 1500);
  const stop = () => {
    clearInterval(timer);
    clearTimeout(limit);
    navigator.vibrate?.(0);
  };
  const limit = setTimeout(stop, 5 * 60_000);
  return stop;
}
