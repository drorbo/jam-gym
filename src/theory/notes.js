// Pitch-class helpers. A pitch class (pc) is an integer 0-11, C = 0.

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const mod12 = (n) => ((n % 12) + 12) % 12;

/** Normalise unicode accidentals to ASCII. */
export const asciiAccidentals = (s) => s.replace(/♯/g, '#').replace(/♭/g, 'b');

/**
 * Parse a note name like "C", "f#", "Bb", "E♭" into a pitch class.
 * @returns {number|null}
 */
export function parseNoteName(name) {
  const m = /^([A-Ga-g])([#♯b♭]?)$/.exec(name.trim());
  if (!m) return null;
  const acc = asciiAccidentals(m[2]);
  return mod12(LETTER_PC[m[1].toUpperCase()] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0));
}

export function noteName(pc, useFlats = false) {
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

/** MIDI note number -> frequency in Hz (A4 = 440). */
export const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Nearest MIDI note with pitch class `pc` to `target`, clamped inside [lo, hi]. */
export function nearestMidi(pc, target, lo, hi) {
  let best = null;
  for (let m = lo; m <= hi; m++) {
    if (mod12(m) !== pc) continue;
    if (best === null || Math.abs(m - target) < Math.abs(best - target)) best = m;
  }
  return best;
}
