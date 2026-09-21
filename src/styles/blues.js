// Blues: triplet shuffle. Shuffled hi-hat, backbeat, boogie-woogie bass, organ comping.

import { placeVoicing, voicingPcs } from '../engine/voicing.js';
import { mod12, nearestMidi } from '../theory/notes.js';
import { bassPc, boogieSteps, capDur, drum, note } from './helpers.js';
import { oddBass, oddChords, oddDrums } from './oddMeters.js';
import { walkBar } from './walking.js';

// Organ/piano comping per segment length: [startBeat, length, velocity]
const COMP = {
  4: [
    [[0, 0.9, 0.62], [1, 0.9, 0.5], [2, 0.9, 0.56], [3, 0.9, 0.5]],                       // four to the bar
    [[0, 1.9, 0.6], [2, 0.9, 0.55], [3.5, 0.45, 0.5]],                                    // long-short
    [[0, 3.6, 0.55]],                                                                     // pad
    [[0, 0.45, 0.64], [0.5, 0.45, 0.5], [1.5, 0.45, 0.5], [2, 0.45, 0.6], [2.5, 0.45, 0.5], [3.5, 0.45, 0.5]], // shuffle stabs
  ],
  2: [[[0, 1.9, 0.6]], [[0, 0.9, 0.6], [1, 0.9, 0.5]]],
  1: [[[0, 0.9, 0.6]]],
  3: [[[0, 2.9, 0.58]]],
};

function drums(ctx) {
  if (ctx.meter.id !== '4/4') return oddDrums(ctx, 'blues');
  const { rng, isLastBar, isFirstBar, chorus, barIndex } = ctx;
  const ev = [];

  // shuffled hi-hat: each beat plus the swung "and"
  [0.72, 0.56, 0.66, 0.56].forEach((v, b) => {
    ev.push(drum('hat', b, v, 0.3));
    ev.push(drum('hat', b + 0.5, v * 0.66, 0.3));
  });
  ev.push(drum('kick', 0, 0.82, 0.3), drum('kick', 2, 0.76, 0.3));
  if (rng.chance(0.35)) ev.push(drum('kick', 2.5, 0.55, 0.3));
  ev.push(drum('snare', 1, 0.9, 0.3), drum('snare', 3, 0.92, 0.3));
  // ghost notes on the shuffle's "a" just before each backbeat, and now and then a push into beat 1
  for (const b of [0.5, 2.5]) if (rng.chance(0.4)) ev.push(drum('snare', b, 0.3 + rng.next() * 0.14, 0.2));
  if (rng.chance(0.2)) ev.push(drum('snare', 3.5, 0.5 + rng.next() * 0.12, 0.2));

  if (isFirstBar && chorus > 1 && rng.chance(0.6)) ev.push(drum('crash', 0, 0.55, 1));

  if ((isLastBar && rng.chance(0.75)) || (barIndex % 4 === 3 && rng.chance(0.25))) {
    ev.push(
      drum('snare', 2, 0.7, 0.3), drum('snare', 2.5, 0.72, 0.3),
      drum('snare', 3, 0.8, 0.3), drum('tomLow', 3.5, 0.8, 0.3),
    );
  }
  return ev;
}

// Eighth-note bass figures, as semitones above the root. The classic is 1 3 5 6 b7 6 5 3.
const BOOGIE = {
  classic: (c) => boogieSteps(c),
  chicago: (c) => { const f = c.fifth ?? 7; return [0, f, 9, f, 0, f, 9, f]; },
  rise: (c) => { const t = c.third ?? 7; const f = c.fifth ?? 7; return [0, t, f, t, 9, f, c.seventh === 11 ? 11 : 10, f]; },
};

function boogieBar(ctx) {
  const { segments, nextChord, state, rng } = ctx;
  const ev = [];
  // stay with a figure for a few bars, then change
  const name = state.boogie && rng.chance(0.75) ? state.boogie : rng.weighted([['classic', 5], ['chicago', 2], ['rise', 2]]);
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

function bass(ctx) {
  if (ctx.meter.id !== '4/4') return oddBass(ctx, 'blues');
  const { pattern } = ctx.bassOpts;
  // "mixed": the boogie, with a walking bar to turn the chorus around (and one now and then for variety)
  if (pattern === 'walk' || (pattern === 'mixed' && (ctx.isLastBar || ctx.rng.chance(0.08)))) return walkBar(ctx, 'blues');
  return boogieBar(ctx);
}

function chords(ctx) {
  if (ctx.meter.id !== '4/4') return oddChords(ctx, 'blues');
  const { segments, state, rng } = ctx;
  const ev = [];
  for (const seg of segments) {
    if (!seg.chord) continue;
    const table = COMP[seg.beats] ?? COMP[seg.beats >= 4 ? 4 : 1];
    const pattern = rng.weighted(table.map((p, i) => [p, table.length === 4 ? [3, 3, 2, 2][i] : 1]));
    state.voicing = placeVoicing(voicingPcs(seg.chord, 'block'), state.voicing, { lo: 50, hi: 70, center: 60, maxSpan: 14 });
    const end = seg.startBeat + seg.beats;
    for (const [b, len, vel] of pattern) {
      const beat = seg.startBeat + b;
      if (beat >= end) continue;
      state.voicing.forEach((midi, i) => {
        ev.push(note('chords', midi, beat, capDur(len, beat, end), vel * (0.95 + rng.next() * 0.1), { dt: i * 0.003 }));
      });
    }
  }
  return ev;
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
  timbres: { bass: 'electric', chords: 'wurli', drums: 'jazz' },
  bass: { rhythm: 'mixed', line: 55, tension: 15, approach: 'mixed', pattern: 'mixed' },
  parts: { drums, bass, chords },
};
