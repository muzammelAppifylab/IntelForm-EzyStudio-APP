import type {StepSound} from '../lib/intelform/form/settings';

let audio: AudioContext | null = null;

/** One note: a sine with a fast attack and an exponential fade, so it never clicks. */
function note(ctx: AudioContext, freq: number, start: number, length: number, peak: number, glideTo?: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + length);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/**
 * Plays a short synthesized sound (no audio files) on moving to the next step, or `done` on
 * submit. Silent when the browser blocks audio or has none. Also used by the builder's
 * Settings tab to preview the sound.
 */
export function playStepSound(kind: StepSound, done = false): void {
  if (kind === 'off') return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const t = audio.currentTime;
    if (kind === 'tick') note(audio, done ? 1320 : 1000, t, 0.07, 0.09);
    else if (kind === 'pop') note(audio, done ? 520 : 420, t, 0.11, 0.14, done ? 880 : 760);
    else {
      note(audio, 660, t, 0.22, 0.08);
      note(audio, done ? 1320 : 990, t + 0.09, 0.3, 0.07);
    }
  } catch {
    // No audio support or blocked: the form works the same without it.
  }
}
