// Shared building blocks for style definitions.

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

/** Boogie pattern: 1 3 5 6 b7 6 5 3, adapted to the chord's own third/fifth/seventh (semitones above the root). */
export function boogieSteps(chord) {
  const third = chord.third ?? 7;
  const fifth = chord.fifth ?? 7;
  const seventh = chord.seventh === 11 ? 11 : 10;
  return [0, third, fifth, 9, seventh, 9, fifth, third];
}

/** Cap an event's duration so it ends by `limit` beats (used to stop comping bleeding across chords). */
export const capDur = (dur, beat, limit) => Math.max(0.05, Math.min(dur, limit - beat));
