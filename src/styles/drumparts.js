// The drum mixer's channels: which drum voices each fader controls. Pure data, shared by the Drums panel (settings.js,
// band-ui.js) and the audio bus (which puts one gain in front of each channel).

export const DRUM_PARTS = [
  { id: 'kick', name: 'Kick', voices: ['kick'] },
  { id: 'snare', name: 'Snare', voices: ['snare', 'rim'] },
  { id: 'hat', name: 'Hi-hat', voices: ['hat', 'hatPedal', 'hatOpen'] },
  { id: 'ride', name: 'Ride', voices: ['ride'] },
  { id: 'crash', name: 'Crash', voices: ['crash', 'brushCrash'] },
  { id: 'toms', name: 'Toms', voices: ['tomHigh', 'tomMid', 'tomLow'] },
  { id: 'brush', name: 'Brushes', voices: ['brush', 'swish'], styles: ['jazz'] },
];

/** Which channel plays a voice. Anything unknown goes through the kick channel's neighbours untouched (see partOf). */
const BY_VOICE = Object.fromEntries(DRUM_PARTS.flatMap((p) => p.voices.map((v) => [v, p.id])));
export const partOf = (voice) => BY_VOICE[voice] ?? null;

/** Every channel at 50, which is unity gain: the kit sounds as it always did. */
export const DEFAULT_LEVELS = Object.freeze(Object.fromEntries(DRUM_PARTS.map((p) => [p.id, 50])));

/** Fader position 0..100 -> gain: 0 is silent, 50 is 1 (0 dB), 100 is 4 (+12 dB), 25 is a quarter (-12 dB). */
export const levelGain = (v) => (Math.max(0, Math.min(100, v)) / 50) ** 2;

/** A fader position as decibels, for display. */
export const levelDb = (v) => (v <= 0 ? -Infinity : 40 * Math.log10(v / 50));
