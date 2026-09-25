// Blues: triplet shuffle. Shuffled hi-hat, backbeat, boogie-woogie bass, organ comping.

import { mod12, nearestMidi } from '../theory/notes.js';
import { bassPc, boogieSteps, note } from './helpers.js';
import { keysBar, oddChords } from './comping.js';
import { bluesDrums } from './drumming.js';
import { oddBass } from './oddMeters.js';
import { walkBar } from './walking.js';

function chords(ctx) {
  return ctx.meter.id !== '4/4' ? oddChords(ctx, 'blues') : keysBar(ctx, 'blues');
}

// Eighth-note bass figures, as semitones above the root. The classic is 1 3 5 6 b7 6 5 3.
const BOOGIE = {
  classic: (c) => boogieSteps(c),
  chicago: (c) => { const f = c.fifth ?? 7; return [0, f, 9, f, 0, f, 9, f]; },
  rise: (c) => { const t = c.third ?? 7; const f = c.fifth ?? 7; return [0, t, f, t, 9, f, c.seventh === 11 ? 11 : 10, f]; },
};

function boogieBar(ctx, only) {
  const { segments, nextChord, state, rng } = ctx;
  const ev = [];
  // stay with a figure for a few bars, then change (unless one was asked for by name)
  const name = only ?? (state.boogie && rng.chance(0.75) ? state.boogie : rng.weighted([['classic', 5], ['chicago', 2], ['rise', 2]]));
  state.boogie = name;
  segments.forEach((seg, k) => {
    if (!seg.chord) return;
    const upcoming = segments[k + 1] ? segments[k + 1].chord : nextChord;
    const rootPc = bassPc(seg.chord);
    const base = 28 + mod12(rootPc - 28); // E1..D#2 so the figure tops out below E3
    const steps = BOOGIE[name](seg.chord);
    const count = seg.beats * 2;
    const pitches = Array.from({ length: count }, (_, i) => base + steps[i % steps.length]);
    // lead into a change of chord: the last eighth steps to the next root from a half step away
    let lead = false;
    if (upcoming && bassPc(upcoming) !== rootPc && count >= 2 && rng.chance(0.6)) {
      const target = bassPc(upcoming);
      const from = pitches[count - 2];
      const up = nearestMidi(mod12(target + 1), from, 28, 46);
      const down = nearestMidi(mod12(target - 1), from, 28, 46);
      pitches[count - 1] = Math.abs(up - from) <= Math.abs(down - from) ? up : down;
      lead = true;
    }
    pitches.forEach((midi, i) => {
      ev.push(note('bass', midi, seg.startBeat + i / 2, 0.42, lead && i === count - 1 ? 0.72 : i % 2 === 0 ? 0.8 : 0.62));
    });
    state.bass = pitches[count - 1];
    state.bass2 = pitches[count - 2] ?? state.bass;
  });
  return ev;
}

// Fixed figures, for the Pattern choices beyond the boogie. Each step is [beat, semitones above the root, length, velocity];
// `f` steps sit on exact triplets (they do not swing again). Intervals are chosen from the chord (third, fifth, sixth).
const FIGURES = {
  fifths: (c) => [[0, 0, 0.9, 0.84], [1, c.fifth ?? 7, 0.9, 0.7], [2, 0, 0.9, 0.8], [3, c.fifth ?? 7, 0.9, 0.7]],
  pushed: (c) => [[0, 0, 0.9, 0.86], [1.5, 0, 0.45, 0.7], [2, c.fifth ?? 7, 0.9, 0.74], [3.5, 0, 0.4, 0.66]],
  stoptime: (c) => [[0, 0, 0.6, 0.92], [1.5, c.fifth ?? 7, 0.4, 0.72]],
  triplets: () => Array.from({ length: 12 }, (_, i) => [i / 3, 0, 0.3, i % 3 === 0 ? 0.84 : 0.56, true]),
};

/** A bar of one of the fixed figures, leading a half step into a change of chord like the boogie does. */
function figureBar(ctx, name) {
  const { segments, nextChord, state, rng } = ctx;
  const ev = [];
  segments.forEach((seg, k) => {
    if (!seg.chord) return;
    const upcoming = segments[k + 1] ? segments[k + 1].chord : nextChord;
    const rootPc = bassPc(seg.chord);
    const base = 28 + mod12(rootPc - 28);
    const steps = FIGURES[name](seg.chord).filter((st) => st[0] < seg.beats);
    const pitches = steps.map((st) => base + st[1]);
    const n = pitches.length;
    if (upcoming && bassPc(upcoming) !== rootPc && n >= 2 && rng.chance(0.5)) {
      const target = bassPc(upcoming);
      const from = pitches[n - 2];
      const up = nearestMidi(mod12(target + 1), from, 28, 46);
      const down = nearestMidi(mod12(target - 1), from, 28, 46);
      pitches[n - 1] = Math.abs(up - from) <= Math.abs(down - from) ? up : down;
    }
    steps.forEach(([beat, , dur, vel, fixed], i) => ev.push(note('bass', pitches[i], seg.startBeat + beat, dur, vel, fixed ? { fixed: true } : {})));
    state.bass = pitches[n - 1];
    state.bass2 = pitches[n - 2] ?? state.bass;
  });
  return ev;
}

function bass(ctx) {
  if (ctx.meter.id !== '4/4') return oddBass(ctx, 'blues');
  const { pattern } = ctx.bassOpts;
  // "mixed": the boogie, with a walking bar to turn the chorus around (and one now and then for variety)
  if (pattern === 'walk' || (pattern === 'mixed' && (ctx.isLastBar || ctx.rng.chance(0.08)))) return walkBar(ctx, 'blues');
  if (FIGURES[pattern]) return figureBar(ctx, pattern);
  if (BOOGIE[pattern]) return boogieBar(ctx, pattern); // one named boogie figure, all the way
  return boogieBar(ctx);
}

export const blues = {
  id: 'blues',
  name: 'Blues',
  description: 'Triplet shuffle. Backbeat drums, boogie bass and electric piano.',
  defaultTempo: 100,
  timeSignatures: ['4/4', '6/8', '7/8', '10/8'],
  feel: { name: 'shuffle', swing: 0.667 },
  humanize: {
    drums: { t: 0.004, v: 0.08 },
    bass: { t: 0.003, v: 0.05 },
    chords: { t: 0.006, v: 0.08, lay: 0.003 },
  },
  timbres: { bass: 'guitar', chords: 'wurli', drums: 'jazz' },
  bass: { rhythm: 'mixed', line: 55, tension: 15, approach: 'mixed', pattern: 'mixed', fills: 40, length: 50, pocket: 50, loose: 50 },
  comp: { rhythm: 'auto', density: 65, sync: 30, variety: 50, tension: 25, range: 40, spread: 55, length: 50, power: 50, pocket: 50, loose: 50 },
  kit: { cymbal: 50, kick: 50, snare: 50, ghosts: 50, fills: 50, wild: 50, crash: 50, power: 50, pocket: 50, loose: 50 },
  parts: { drums: bluesDrums, bass, chords },
};
