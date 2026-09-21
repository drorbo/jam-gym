// Pure helpers for choosing which recorded sample to play. No Web Audio here, so it is testable in Node.

/** The velocity layer whose nominal velocity (`ref`) is closest to `vel`. */
export function pickLayer(layers, vel) {
  let best = layers[0];
  for (const l of layers) {
    const d = Math.abs(l.ref - vel);
    const bd = Math.abs(best.ref - vel);
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && l.ref > best.ref)) best = l;
  }
  return best;
}

/** The recorded note closest to `midi` (ties go to the lower one: pitching up sounds cleaner than down). */
export function pickNote(notes, midi) {
  let best = notes[0];
  for (const n of notes) {
    const d = Math.abs(n.midi - midi);
    const bd = Math.abs(best.midi - midi);
    if (d < bd || (d === bd && n.midi < best.midi)) best = n;
  }
  return best;
}

/** Playback rate that moves a sample recorded at `root` to `midi`. */
export const pitchRate = (midi, root) => 2 ** ((midi - root) / 12);

/** Level trim within a layer: harder than the layer's nominal velocity plays louder, softer plays quieter. */
export const layerGain = (vel, ref) => Math.min(1.3, Math.max(0.6, vel / ref));

/** If a kit lacks a voice, borrow a close relative instead of going silent. */
export const VOICE_FALLBACK = {
  hatPedal: ['hat'],
  hatOpen: ['hat'],
  tomHigh: ['tomMid', 'tomLow'],
  tomMid: ['tomHigh', 'tomLow'],
  tomLow: ['tomMid', 'tomHigh'],
};

export function findVoice(voices, name) {
  for (const candidate of [name, ...(VOICE_FALLBACK[name] ?? [])]) if (voices[candidate]) return voices[candidate];
  return null;
}
