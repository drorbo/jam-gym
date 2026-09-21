// Chord voicings. Two jobs:
//   1. decide WHICH tones to play for a chord in a given idiom  (voicingPcs)
//   2. decide WHERE to put them, with smooth voice-leading      (placeVoicing)

import { absolutePcs } from '../theory/chord.js';
import { mod12 } from '../theory/notes.js';

/**
 * Jazz "rootless" tones: the bass covers the root, so the piano plays the guide tones
 * (3rd, 7th) plus colour (5th/13th, 9th).
 * @returns {number[]} absolute pitch classes
 */
function rootlessPcs(c) {
  const third = c.third ?? 7;
  const fifth = c.fifth ?? 7;
  const seventh = c.seventh ?? (c.sixth ? 9 : null);
  const ninth = c.ninth ? c.ninth % 12 : 2;
  let tones;
  switch (c.family) {
    case 'dominant': {
      const color = c.eleventh === 18 ? 6 : c.thirteenth ? c.thirteenth % 12 : fifth !== 7 ? fifth : 9;
      tones = [third, color, seventh ?? 10, ninth];
      break;
    }
    case 'major':
    case 'minor':
      tones = seventh === null
        ? [third, fifth, 0, ninth]
        : [third, c.eleventh === 18 ? 6 : fifth, seventh, ninth];
      break;
    case 'halfdim': tones = [3, 6, 10, 5]; break;
    case 'dim': tones = c.seventh === 9 ? [0, 3, 6, 9] : [0, 3, 6]; break;
    case 'aug': tones = seventh === null ? [4, 8, 0] : [4, 8, seventh, ninth]; break;
    case 'sus': tones = [third, fifth, seventh ?? 0, ninth]; break;
    default: tones = [0, 7];
  }
  return tones.map((i) => mod12(c.root + i));
}

/** Full-ish block chord including the root (organ / electric piano in blues). */
function blockPcs(c) {
  const tones = [0, c.third ?? 7, c.fifth ?? 7];
  const seventh = c.seventh ?? (c.sixth ? 9 : null);
  if (seventh !== null) tones.push(seventh);
  return tones.map((i) => mod12(c.root + i));
}

/**
 * @param {import('../theory/chord.js').Chord} chord
 * @param {'rootless'|'block'|'all'} kind
 * @returns {number[]} absolute pitch classes, deduplicated, in importance order
 */
export function voicingPcs(chord, kind) {
  const pcs = kind === 'rootless' ? rootlessPcs(chord) : kind === 'block' ? blockPcs(chord) : absolutePcs(chord);
  return [...new Set(pcs)];
}

/**
 * Choose octaves for `pcs` so the voicing sits in [lo, hi], stays compact, and moves as
 * little as possible from `prev`. Deterministic.
 * @param {number[]} pcs absolute pitch classes
 * @param {number[]|null} prev previous voicing (MIDI notes, ascending)
 * @returns {number[]} MIDI notes, ascending
 */
export function placeVoicing(pcs, prev, { lo = 52, hi = 72, center = 62, maxSpan = 12 } = {}) {
  const options = pcs.map((pc) => {
    const o = [];
    for (let m = lo; m <= hi; m++) if (mod12(m) === pc) o.push(m);
    return o;
  });
  if (options.some((o) => o.length === 0)) return pcs.map((pc) => lo + mod12(pc - lo));

  let best = null;
  let bestCost = Infinity;
  const pick = new Array(pcs.length);
  const evaluate = () => {
    const notes = [...pick].sort((a, b) => a - b);
    const span = notes[notes.length - 1] - notes[0];
    if (span > maxSpan) return;
    let cost = 0;
    const mean = notes.reduce((s, n) => s + n, 0) / notes.length;
    cost += Math.abs(mean - center) * 0.15;
    if (prev && prev.length) {
      const n = Math.min(prev.length, notes.length);
      for (let i = 0; i < n; i++) cost += Math.abs(notes[i] - prev[i]);
      cost += Math.abs(prev.length - notes.length) * 2;
    }
    for (let i = 1; i < notes.length; i++) {
      const gap = notes[i] - notes[i - 1];
      if (gap === 0) return; // two pcs landed on the same pitch
      if (gap === 1) cost += 1.5;
      if (gap <= 2 && notes[i - 1] < 58) cost += 4; // muddy low seconds
    }
    if (cost < bestCost - 1e-9) { bestCost = cost; best = notes; }
  };
  const recurse = (i) => {
    if (i === pcs.length) { evaluate(); return; }
    for (const m of options[i]) { pick[i] = m; recurse(i + 1); }
  };
  recurse(0);

  if (best) return best;
  // Nothing fit the span limit: fall back to stacking upwards from the lowest option.
  return pcs.map((pc) => lo + mod12(pc - lo)).sort((a, b) => a - b);
}

/**
 * Guitar-style chord (not voice-led; guitarists just move the shape).
 * `full` adds the third and upper fifth/seventh; otherwise a power chord.
 * @returns {number[]} MIDI notes, ascending, low root around E2-D#3
 */
export function guitarChord(chord, { full = false } = {}) {
  const r = 40 + mod12(chord.root - 40);
  const fifth = chord.fifth ?? 7;
  const notes = [r, r + fifth, r + 12];
  if (full && chord.third !== null) {
    notes.push(r + 12 + chord.third);
    notes.push(chord.seventh !== null && chord.family !== 'dim' ? r + 12 + chord.seventh : r + 12 + fifth);
  }
  return notes;
}
