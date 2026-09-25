// The rock bass player. Reads the Bass line panel (ctx.bassOpts, see settings.js):
//
//   pattern   Mixed (varies from bar to bar), Driving eighths, Octaves, Pushes, Quarter notes, Syncopated, Melodic line
//   line      from root notes only to a melodic part: fifths, octaves and (with Tensions) sevenths and fourths mixed in
//   tension   how much colour goes into those extra notes
//   approach  how the last note leads into a change of chord (None leaves the root ringing until it changes)
//   fills     bass runs that lead into the next phrase
//
// Note length, Timing and Feel are applied afterwards, in renderBar.

import { slotsWithin } from '../theory/meter.js';
import { mod12, nearestMidi } from '../theory/notes.js';
import { bassPc, boogieSteps, note } from './helpers.js';
import { spread } from './drumming.js';
import { planApproach, walkBar, walkOddBar } from './walking.js';

const LO = 28;
const HI = 47;

// Bass figures in beats within a chord; `o` marks an octave-up note.
const FIGURES = {
  eighths: Array.from({ length: 8 }, (_, i) => ({ b: i / 2 })),
  octaves: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b, i) => ({ b, o: i % 4 === 2 })),
  pushes: [0, 1, 2, 2.5, 3, 3.5].map((b) => ({ b })),
  quarters: [0, 1, 2, 3].map((b) => ({ b })),
  syncopated: [0, 0.75, 1.5, 2, 2.75, 3.5].map((b) => ({ b })),
  gallop: [0, 1, 2, 3].flatMap((n) => [{ b: n }, { b: n + 0.5 }, { b: n + 0.75 }]),
  threethreetwo: [0, 1.5, 3].map((b) => ({ b })),
  offbeat: [0.5, 1.5, 2.5, 3.5].map((b) => ({ b })),
  held: [{ b: 0, d: 1.8 }, { b: 2, d: 1.8 }],
  // the boogie in straight eighths: intervals come from the chord (see boogieSteps)
  boogie: Array.from({ length: 8 }, (_, i) => ({ b: i / 2, boogie: i })),
};

/** Which figure this bar plays. "Mixed" is what rock bass always did: mostly eighths and octaves, pushes to end a phrase. */
function figureFor(name, barIndex, rng) {
  if (name !== 'mixed') return FIGURES[name] ?? FIGURES.eighths;
  return FIGURES[barIndex % 4 === 3 ? 'pushes' : rng.weighted([['eighths', 5], ['octaves', 3], ['pushes', 2]])];
}

/** Intervals a rock bassist adds to the root: fifth and octave first, then sevenths, fourths and sixths as Tensions rises. */
function extras(chord, tension) {
  const t = tension / 100;
  return [
    [chord.fifth ?? 7, 3],
    [12, 3],
    [10, 1.5 * t + 0.05],
    [chord.third ?? 4, 1.2 * t],
    [5, 1.0 * t],
    [9, 0.8 * t],
  ];
}

/** Sometimes swap a root for a fifth, octave or colour note, according to Line and Tensions. */
function embellish(base, chord, opts, rng) {
  if (!rng.chance((opts.line / 100) * 0.55)) return base;
  return base + rng.weighted(extras(chord, opts.tension));
}

/** Lead into the next chord: replace `midi` with an approach note if the chord is about to change. */
function approachNote(midi, seg, upcoming, opts, rng) {
  if (!upcoming || opts.approach === 'none' || bassPc(upcoming) === bassPc(seg.chord)) return midi;
  if (opts.approach === 'mixed' && !rng.chance(0.5)) return midi;
  const [pc] = planApproach({ mode: opts.approach === 'mixed' ? 'mixed' : opts.approach, targetPc: bassPc(upcoming), chord: seg.chord, count: 2, prevMidi: midi, rng });
  return pc === undefined ? midi : nearestMidi(pc, midi, LO, HI + 2);
}

/** A fast run for the last beat of a phrase: a pentatonic climb or fall that lands on the approach note. */
function fillRun(seg, upcoming, opts, rng) {
  const root = 28 + mod12(bassPc(seg.chord) - 28);
  const pool = [0, seg.chord.third ?? 3, 5, seg.chord.fifth ?? 7, 10, 12].map((i) => root + i);
  if (opts.tension > 50) pool.push(root + 6); // the blue note
  pool.sort((a, b) => a - b);
  const up = rng.chance(0.5);
  const start = rng.int(Math.max(1, pool.length - 3));
  const run = up ? pool.slice(start, start + 3) : pool.slice(start, start + 3).reverse();
  const last = approachNote(up ? run[2] + 2 : run[2] - 2, seg, upcoming, { ...opts, approach: opts.approach === 'none' ? 'chromatic' : opts.approach }, rng);
  return [...run, last];
}

/** One bar of rock bass in 4/4. */
export function rockBassBar(ctx) {
  const { segments, nextChord, state, rng, barIndex, isLastBar } = ctx;
  const o = ctx.bassOpts;
  if (o.pattern === 'melodic') {
    return walkBar({ ...ctx, bassOpts: { ...o, rhythm: o.line >= 60 ? 'eighths' : 'quarters' } }, 'rock');
  }
  const figure = figureFor(o.pattern, barIndex, rng);
  const fills = (isLastBar && rng.chance(spread(0.35, o.fills))) || (barIndex % 4 === 3 && rng.chance(spread(0.12, o.fills)));
  const ev = [];
  segments.forEach((seg, k) => {
    if (!seg.chord) return;
    const upcoming = segments[k + 1] ? segments[k + 1].chord : nextChord;
    const isLast = k === segments.length - 1;
    const root = 28 + mod12(bassPc(seg.chord) - 28);
    const steps = figure.filter((s) => s.b < seg.beats);
    const runFrom = fills && isLast && seg.beats >= 2 ? seg.beats - 1 : Infinity;
    let lastMidi = root;
    steps.forEach((step, i) => {
      if (step.b >= runFrom) return;
      let midi = root + (step.o ? 12 : 0);
      if (step.boogie !== undefined) midi = root + boogieSteps(seg.chord)[step.boogie];
      else if (i > 0 && !step.o) midi = embellish(root, seg.chord, o, rng);
      if (isLast && i === steps.length - 1 && runFrom === Infinity) midi = approachNote(midi, seg, upcoming, o, rng);
      ev.push(note('bass', midi, seg.startBeat + step.b, step.d ?? (step.b % 0.5 === 0.25 ? 0.2 : 0.42), step.b % 1 === 0 ? 0.82 : 0.68));
      lastMidi = midi;
    });
    if (runFrom !== Infinity) {
      fillRun(seg, upcoming, o, rng).forEach((midi, i) => {
        ev.push(note('bass', midi, seg.startBeat + runFrom + i * 0.25, 0.22, i === 3 ? 0.8 : 0.7));
        lastMidi = midi;
      });
    }
    state.bass = lastMidi;
  });
  return ev;
}

/** One bar of rock bass in a /8 meter. */
export function rockBassOdd(ctx) {
  const { meter, segments, nextChord, state, rng } = ctx;
  const o = ctx.bassOpts;
  if (o.pattern === 'melodic') return walkOddBar({ ...ctx, bassOpts: { ...o, rhythm: o.line >= 60 ? 'eighths' : 'quarters' } }, 'rock');
  const variant = o.pattern === 'mixed'
    ? rng.weighted([['eighths', 5], ['pushes', 3]])
    : o.pattern === 'quarters' || o.pattern === 'held' ? 'quarters' : o.pattern === 'pushes' ? 'pushes' : 'eighths';
  const ev = [];
  segments.forEach((seg, k) => {
    if (!seg.chord) return;
    const upcoming = segments[k + 1] ? segments[k + 1].chord : nextChord;
    const isLast = k === segments.length - 1;
    const root = 28 + mod12(bassPc(seg.chord) - 28);
    const slots = slotsWithin(meter, seg.startBeat, seg.beats).filter((s) => {
      if (variant === 'quarters') return s.posInGroup === 0;
      if (variant === 'pushes') return !(meter.groups[s.group] === 3 && s.posInGroup === 1);
      return true;
    });
    let lastMidi = root;
    slots.forEach((s, i) => {
      let midi = i > 0 ? embellish(root, seg.chord, o, rng) : root;
      if (isLast && i === slots.length - 1) midi = approachNote(midi, seg, upcoming, o, rng);
      ev.push(note('bass', midi, s.start, 0.42, s.posInGroup === 0 ? 0.82 : 0.68));
      lastMidi = midi;
    });
    state.bass = lastMidi;
  });
  return ev;
}
