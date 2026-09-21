// Shared building blocks for style definitions.

import { mod12, nearestMidi } from '../theory/notes.js';

/** Event constructors. Positions are in beats from the start of the bar, on a straight grid. */
export const drum = (voice, beat, vel, dur = 0.25, extra = {}) => ({ inst: 'drums', voice, beat, dur, vel, ...extra });
export const note = (inst, midi, beat, dur, vel, extra = {}) => ({ inst, midi, beat, dur, vel, ...extra });

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dominant: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 9, 10],
  halfdim: [0, 2, 3, 5, 6, 8, 10],
  dim: [0, 2, 3, 5, 6, 8, 9, 11],
  aug: [0, 2, 4, 6, 8, 10],
  sus: [0, 2, 5, 7, 9, 10],
  power: [0, 2, 4, 5, 7, 9, 10],
};

/** Scale degrees (semitones above the root) that suit a chord, honouring its alterations. */
export function scaleIntervals(chord) {
  let scale = [...SCALES[chord.family]];
  if (chord.family === 'minor' && chord.seventh === 11) scale = [0, 2, 3, 5, 7, 9, 11];
  const replace = (remove, add) => {
    scale = scale.filter((i) => !remove.includes(i));
    scale.push(add);
  };
  if (chord.fifth !== null && chord.fifth !== 7 && chord.family !== 'dim' && chord.family !== 'halfdim') {
    replace([6, 7, 8], chord.fifth);
  }
  if (chord.eleventh === 18) replace([5, 6], 6);
  if (chord.ninth === 13) replace([1, 2, 3], 1);
  if (chord.ninth === 15) replace([1, 2, 3], 3);
  return [...new Set(scale)].sort((a, b) => a - b);
}

/** The pitch class the bass should treat as "the root" of a chord (slash bass wins). */
export const bassPc = (chord) => (chord.bass !== null ? chord.bass : chord.root);

/**
 * One segment of a walking bass line: a quarter note per beat that starts on the root,
 * moves through chord/scale tones, and approaches the next chord's root on the last beat.
 * Mutates `state.bass` / `state.dir` so lines continue smoothly across segments and bars.
 *
 * @returns {{beat:number, midi:number}[]}
 */
export function walkSegment(seg, nextRootPc, state, rng, { lo = 28, hi = 48, center = 38 } = {}, steps = null) {
  const { chord } = seg;
  const rootPc = bassPc(chord);
  const scalePcs = scaleIntervals(chord).map((i) => mod12(chord.root + i));
  const fifth = chord.fifth ?? 7;
  const out = [];
  // one note per beat by default; odd meters pass the positions of their group downbeats instead
  const positions = steps ?? Array.from({ length: seg.beats }, (_, i) => seg.startBeat + i);
  const count = positions.length;

  for (let i = 0; i < count; i++) {
    const prev = state.bass ?? center;
    const isLast = i === count - 1;
    let midi;

    if (i === 0) {
      midi = nearestMidi(rootPc, prev, lo, hi);
    } else if (isLast && nextRootPc !== null) {
      // approach the next root: mostly chromatic, sometimes from the fifth above or a step
      const style = rng.weighted([['chromatic', 6], ['dominant', 2], ['step', 2]]);
      let pc;
      if (style === 'dominant') pc = mod12(nextRootPc + 7);
      else if (style === 'step') pc = mod12(nextRootPc + (rng.chance(0.5) ? 2 : -2));
      else {
        const above = nearestMidi(mod12(nextRootPc + 1), prev, lo, hi);
        const below = nearestMidi(mod12(nextRootPc - 1), prev, lo, hi);
        pc = Math.abs(above - prev) < Math.abs(below - prev) ? mod12(nextRootPc + 1) : mod12(nextRootPc - 1);
      }
      midi = nearestMidi(pc, prev, lo, hi);
    } else if (isLast) {
      midi = nearestMidi(mod12(chord.root + fifth), prev, lo, hi);
    } else {
      const aim = nearestMidi(nextRootPc ?? rootPc, prev, lo, hi);
      let bestCost = Infinity;
      for (let m = lo; m <= hi; m++) {
        if (!scalePcs.includes(mod12(m))) continue;
        const d = Math.abs(m - prev);
        let cost = d === 0 ? 6 : d <= 2 ? 0 : d <= 4 ? 0.7 : d <= 7 ? 1.8 : 5;
        const rel = mod12(m - chord.root);
        if (rel === chord.third || rel === chord.seventh) cost -= 1.1;
        else if (rel === fifth) cost -= 0.8;
        else if (rel === 0) cost -= 0.2;
        else if (count === 4 && i === 2) cost += 2; // beat 3 should be a chord tone
        cost += 0.06 * Math.abs(m - center) + 0.12 * Math.abs(m - aim);
        if (state.dir && Math.sign(m - prev) === state.dir && d <= 4) cost -= 0.4;
        cost += rng.next();
        if (cost < bestCost) { bestCost = cost; midi = m; }
      }
    }

    state.dir = Math.sign(midi - prev) || state.dir || 1;
    state.bass = midi;
    out.push({ beat: positions[i], midi });
  }
  return out;
}

/** Boogie pattern: 1 3 5 6 b7 6 5 3, adapted to the chord's own third/fifth/seventh (semitones above the root). */
export function boogieSteps(chord) {
  const third = chord.third ?? 7;
  const fifth = chord.fifth ?? 7;
  const seventh = chord.seventh === 11 ? 11 : 10;
  return [0, third, fifth, 9, seventh, 9, fifth, third];
}

/** Cap an event's duration so it ends by `limit` beats (used to stop comping bleeding across chords). */
export const capDur = (dur, beat, limit) => Math.max(0.05, Math.min(dur, limit - beat));
