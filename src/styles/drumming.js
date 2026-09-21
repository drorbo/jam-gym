// The drummer. Each style's drum part reads the Drums panel (ctx.kitOpts, see settings.js):
//
//   cymbal  ride / hi-hat density     Just quarters .. Standard .. Full
//   kick    kick placement            On the beat .. Syncopated
//   snare   extra snare hits          Backbeat only (jazz: no comping) .. Busy
//   ghosts  quiet snare notes         None .. Lots
//   fills   how often a fill comes    None .. Constantly
//   wild    what a fill is like       one snare pickup .. sixteenth-note tom runs
//   crash   crash cymbals             None .. Always
//
// Every slider is anchored so that 50 plays what the style always played, so a style left at its defaults sounds as it
// did before the panel existed. Dynamics, Timing and Feel are applied to the whole kit afterwards, in renderBar.

import { slotsWithin } from '../theory/meter.js';
import { drum } from './helpers.js';
import { gain, odds } from './settings.js';

/** A probability that is `base` at the middle of a slider, 0 at the bottom and 1 at the top. */
export const spread = (base, v) => (v <= 50 ? base * (v / 50) : base + (1 - base) * ((v - 50) / 50));

// ---- fills -----------------------------------------------------------------------------------

/** Which kind of fill: a single pickup, a tidy standard one, a sixteenth-note run, or a whole-half-bar roll. */
export function fillLevel(rng, wild) {
  return rng.weighted([
    ['simple', Math.max(0.02, 80 - 1.2 * wild)],
    ['normal', Math.max(0.02, 50 - 0.8 * Math.abs(wild - 45))],
    ['wild', Math.max(0.02, wild - 25)],
    ['epic', Math.max(0, (wild - 65) * 1.5)],
  ]);
}

/** Is there a fill in this bar? Ends of choruses are likely, every fourth bar is possible. */
export function wantsFill(ctx, base) {
  const { rng, isLastBar, barIndex, kitOpts } = ctx;
  return (isLastBar && rng.chance(spread(base.last, kitOpts.fills)))
    || (barIndex % 4 === 3 && rng.chance(spread(base.mid, kitOpts.fills)));
}

// Triplet positions land exactly on the swung grid, so these are flagged `fixed` (swing must not move them again).
const trip = (voice, beat, vel) => drum(voice, beat, vel, 0.25, { fixed: true });

/** The notes of a fill in 4/4. Positions are beats from the bar start; the fill lives in the second half of the bar. */
export function fill4(flavor, level, rng) {
  const swung = flavor !== 'rock';
  const d = (voice, beat, vel) => drum(voice, beat, vel, 0.25);
  switch (level) {
    case 'simple':
      return flavor === 'rock' ? [d('snare', 3.5, 0.72), d('kick', 3.5, 0.6)] : [d('snare', 3.5, 0.64)];
    case 'wild':
      return swung
        ? [trip('snare', 2, 0.6), trip('snare', 2.333, 0.62), trip('snare', 2.667, 0.66), trip('tomHigh', 3, 0.72),
          trip('tomMid', 3.333, 0.76), trip('tomLow', 3.667, 0.82), d('kick', 3, 0.6)]
        : [d('snare', 2.5, 0.7), d('snare', 2.75, 0.72), d('snare', 3, 0.76), d('tomHigh', 3.25, 0.78),
          d('tomMid', 3.5, 0.8), d('tomLow', 3.75, 0.84), d('kick', 3, 0.7)];
    case 'epic':
      return swung
        ? [trip('snare', 1.667, 0.55), trip('snare', 2, 0.6), trip('snare', 2.333, 0.64), trip('tomHigh', 2.667, 0.7),
          trip('tomHigh', 3, 0.74), trip('tomMid', 3.333, 0.78), trip('tomLow', 3.667, 0.86), d('kick', 2, 0.6), d('kick', 3.5, 0.66)]
        : [d('snare', 2, 0.66), d('snare', 2.25, 0.68), d('snare', 2.5, 0.7), d('snare', 2.75, 0.72), d('tomHigh', 3, 0.76),
          d('tomHigh', 3.25, 0.78), d('tomMid', 3.5, 0.82), d('tomLow', 3.75, 0.88), d('kick', 3, 0.8), d('kick', 3.75, 0.8)];
    default: // normal: what each style has always played
      if (flavor === 'jazz') {
        return rng.chance(0.5)
          ? [d('snare', 2.5, 0.62), d('snare', 3, 0.72), d('snare', 3.5, 0.84), d('kick', 3.5, 0.6)]
          : [d('snare', 3, 0.7), d('tomMid', 3.5, 0.6), d('tomLow', 3.75, 0.66), d('kick', 3, 0.5)];
      }
      if (flavor === 'blues') {
        return [d('snare', 2, 0.7), d('snare', 2.5, 0.72), d('snare', 3, 0.8), d('tomLow', 3.5, 0.8)];
      }
      return [d('snare', 3, 0.78), d('snare', 3.25, 0.74), d('tomMid', 3.5, 0.76), d('tomLow', 3.75, 0.82)];
  }
}

/** A crash: on the first bar, and (with a big fill before it) on the bar after the fill. */
function crashes(ctx, { firstBase, vel, len }) {
  const { rng, isFirstBar, state, kitOpts } = ctx;
  const out = [];
  const after = state.crashNext;
  state.crashNext = false;
  if ((isFirstBar && rng.chance(Math.min(1, firstBase * gain(kitOpts.crash)))) || (after && rng.chance(Math.min(1, 0.85 * gain(kitOpts.crash))))) {
    out.push(drum('crash', 0, vel, len));
  }
  return out;
}

/** Add a fill if this bar has one; remember whether it was big enough to want a crash after it. */
function addFill(ctx, ev, flavor, base) {
  if (!wantsFill(ctx, base)) return;
  const level = fillLevel(ctx.rng, ctx.kitOpts.wild);
  ev.push(...fill4(flavor, level, ctx.rng));
  ctx.state.crashNext = level === 'wild' || level === 'epic';
}

// ---- jazz --------------------------------------------------------------------------------------

// Snare comping, the way a drummer answers the soloist: [hits, weight], each hit [beat, minVel, maxVel].
// Ghosted notes (.35-.5) fill the gaps; the louder ones (.55-.72) are the "bombs" that punctuate a phrase.
const SNARE_COMP = [
  [4, []],
  [3, [[1.5, 0.58, 0.72]]],
  [3, [[3.5, 0.58, 0.74]]],
  [3, [[1.5, 0.38, 0.5], [3.5, 0.38, 0.52]]],
  [2, [[2.5, 0.52, 0.68], [3.5, 0.4, 0.52]]],
  [2, [[0.5, 0.36, 0.48], [1.5, 0.52, 0.68], [2.5, 0.36, 0.48]]],
  [1.5, [[2, 0.5, 0.64], [2.5, 0.42, 0.54], [3.5, 0.56, 0.72]]],
].map(([weight, hits]) => [hits, weight]);

const RIDE = [[0, 0.6], [1, 0.76], [1.5, 0.48], [2, 0.6], [3, 0.76], [3.5, 0.48]];

export function jazzDrums(ctx) {
  if (ctx.meter.id !== '4/4') return oddDrums(ctx, 'jazz');
  const { rng, chorus } = ctx;
  const k = ctx.kitOpts;
  const ev = [];

  // ride: "spang-a-lang". Cymbal takes it from plain quarters (the skip notes go first) up to a full, busy ride.
  const skipKept = 0.92 * Math.min(1, gain(k.cymbal));
  for (const [b, v] of RIDE) {
    if (b % 1 !== 0 && !rng.chance(skipKept)) continue;
    ev.push(drum('ride', b, v, 0.5));
  }
  if (k.cymbal > 50) {
    for (const b of [0.5, 2.5]) if (rng.chance(((k.cymbal - 50) / 50) * 0.85)) ev.push(drum('ride', b, 0.34, 0.4));
  }
  // hi-hat foot on 2 and 4, feathered kick on the beat (only 1 and 3 when the kick is asked to stay out of the way)
  ev.push(drum('hatPedal', 1, 0.5, 0.1), drum('hatPedal', 3, 0.5, 0.1));
  for (let b = 0; b < 4; b++) {
    if (k.kick < 25 && b % 2 === 1) continue;
    ev.push(drum('kick', b, 0.16 + rng.next() * 0.06, 0.2));
  }
  // the occasional bomb, and more of them as the kick gets busier
  if (rng.chance(odds(0.1, k.kick))) ev.push(drum('kick', rng.chance(0.5) ? 2.5 : 0.5, 0.55, 0.2));
  if (k.kick > 70 && rng.chance(((k.kick - 70) / 30) * 0.45)) ev.push(drum('kick', rng.chance(0.5) ? 1.5 : 3.5, 0.46, 0.2));

  // snare comping: the Snare slider changes how many hits a bar has; Ghost notes thins or adds the quiet ones
  const s = Math.max(1, k.snare) / 50;
  const cells = SNARE_COMP.map(([hits, w]) => [hits, w * s ** hits.length]);
  const used = new Set();
  for (const [b, lo, hi] of rng.weighted(cells)) {
    const ghost = hi <= 0.55;
    if (ghost && !rng.chance(Math.min(1, gain(k.ghosts)))) continue;
    used.add(b);
    ev.push(drum('snare', b, lo + rng.next() * (hi - lo), 0.2));
  }
  if (k.ghosts > 50) {
    for (const b of [0.5, 1.5, 2.5, 3.5]) {
      if (!used.has(b) && rng.chance(((k.ghosts - 50) / 50) * 0.45)) ev.push(drum('snare', b, 0.3 + rng.next() * 0.12, 0.15));
    }
  }

  ev.push(...crashes(ctx, { firstBase: chorus > 1 ? 0.6 : 0, vel: 0.5, len: 1 }));
  addFill(ctx, ev, 'jazz', { last: 0.7, mid: 0.3 });
  return ev;
}

// ---- blues -------------------------------------------------------------------------------------

export function bluesDrums(ctx) {
  if (ctx.meter.id !== '4/4') return oddDrums(ctx, 'blues');
  const { rng, chorus } = ctx;
  const k = ctx.kitOpts;
  const ev = [];

  // shuffled hi-hat: each beat, plus the swung "and" (Cymbal thins those out, then adds an open hat on top)
  const andKept = Math.min(1, gain(k.cymbal));
  [0.72, 0.56, 0.66, 0.56].forEach((v, b) => {
    ev.push(drum('hat', b, v, 0.3));
    if (rng.chance(andKept)) ev.push(drum('hat', b + 0.5, v * 0.66, 0.3));
  });
  if (k.cymbal > 60 && rng.chance(((k.cymbal - 60) / 40) * 0.5)) ev.push(drum('hatOpen', 3.5, 0.5, 0.4));

  // kick: one and three; Kick drops the three (half-time) or adds pushes on the shuffle's "and"
  ev.push(drum('kick', 0, 0.82, 0.3));
  if (k.kick >= 25 || rng.chance(k.kick / 25)) ev.push(drum('kick', 2, 0.76, 0.3));
  if (rng.chance(odds(0.35, k.kick))) ev.push(drum('kick', 2.5, 0.55, 0.3));
  if (k.kick > 60 && rng.chance(((k.kick - 60) / 40) * 0.4)) ev.push(drum('kick', rng.chance(0.5) ? 0.5 : 3.5, 0.5, 0.3));

  // snare: the backbeat, always
  ev.push(drum('snare', 1, 0.9, 0.3), drum('snare', 3, 0.92, 0.3));
  // ghost notes on the shuffle's "a" just before each backbeat, and now and then a push into beat 1
  for (const b of [0.5, 2.5]) if (rng.chance(odds(0.4, k.ghosts))) ev.push(drum('snare', b, 0.3 + rng.next() * 0.14, 0.2));
  if (rng.chance(odds(0.2, k.snare))) ev.push(drum('snare', 3.5, 0.5 + rng.next() * 0.12, 0.2));
  if (k.snare > 60 && rng.chance(((k.snare - 60) / 40) * 0.4)) ev.push(drum('snare', rng.chance(0.5) ? 1.5 : 2, 0.5 + rng.next() * 0.1, 0.2));

  ev.push(...crashes(ctx, { firstBase: chorus > 1 ? 0.6 : 0, vel: 0.55, len: 1 }));
  addFill(ctx, ev, 'blues', { last: 0.75, mid: 0.25 });
  return ev;
}

// ---- rock --------------------------------------------------------------------------------------

const KICKS = [[0, 2], [0, 0.5, 2], [0, 2, 2.5], [0, 1.5, 2]];
const KICKS_SIMPLE = [[0, 2]];
const KICKS_BUSY = [[0, 0.5, 2, 2.5, 3.5], [0, 1.5, 2, 2.75, 3.5], [0, 0.75, 1.5, 2, 2.5], [0, 0.5, 1.75, 2, 3.5]];

export function rockDrums(ctx) {
  if (ctx.meter.id !== '4/4') return oddDrums(ctx, 'rock');
  const { rng } = ctx;
  const k = ctx.kitOpts;
  const ev = [];

  // hi-hat: quarters when Cymbal is low, eighths in the middle, with sixteenths and open hats added above that
  const offKept = Math.min(1, Math.max(0, (k.cymbal - 15) / 35));
  const openHat = rng.chance(odds(0.15, k.cymbal));
  for (let i = 0; i < 8; i++) {
    const b = i / 2;
    if (i % 2 === 1 && !rng.chance(offKept)) continue;
    if (openHat && b === 3.5) ev.push(drum('hatOpen', b, 0.6, 0.5));
    else ev.push(drum('hat', b, i % 2 === 0 ? 0.7 : 0.5, 0.2));
  }
  if (k.cymbal > 50) {
    for (let i = 0; i < 8; i++) {
      for (const off of [0.25]) if (rng.chance(((k.cymbal - 50) / 50) * 0.7)) ev.push(drum('hat', i / 2 + off, 0.34, 0.15));
    }
  }

  // kick: as simple as one and three, the usual rock patterns, or busy syncopation
  const set = rng.weighted([
    [KICKS_SIMPLE, Math.max(0, 60 - k.kick) / 20],
    [KICKS, 3 * Math.min(1, k.kick / 20)],
    [KICKS_BUSY, Math.max(0, k.kick - 40) / 15],
  ]);
  const kicks = set === KICKS ? (rng.chance(0.55) ? KICKS[0] : rng.pick(KICKS)) : rng.pick(set);
  kicks.forEach((b) => ev.push(drum('kick', b, 0.88, 0.25)));

  // snare: the backbeat, always; ghosts a sixteenth before it; extras around it
  ev.push(drum('snare', 1, 0.94, 0.3), drum('snare', 3, 0.96, 0.3));
  for (const b of [0.75, 2.75]) if (rng.chance(odds(0.3, k.ghosts))) ev.push(drum('snare', b, 0.3 + rng.next() * 0.12, 0.15));
  if (rng.chance(odds(0.22, k.snare))) ev.push(drum('snare', 3.5, 0.62 + rng.next() * 0.1, 0.2));
  if (k.snare > 60 && rng.chance(((k.snare - 60) / 40) * 0.35)) ev.push(drum('snare', rng.chance(0.5) ? 1.75 : 3.75, 0.5 + rng.next() * 0.1, 0.15));

  ev.push(...crashes(ctx, { firstBase: 1, vel: 0.7, len: 1.5 }));
  addFill(ctx, ev, 'rock', { last: 0.75, mid: 0.22 });
  return ev;
}

// ---- the /8 meters -------------------------------------------------------------------------

/**
 * How the kit plays 6/8, 7/8 and 10/8. The group downbeats are the "beats": kick on the strong ones, snare on the
 * others (a ride ping or hat for jazz). The same panel applies: cymbal density, kick pushes, extra and ghosted snares,
 * fills that grow from one hit to a run through the last groups, and crashes.
 */
export function oddDrums(ctx, flavor) {
  const { meter, rng, isFirstBar, chorus, state } = ctx;
  const k = ctx.kitOpts;
  const ev = [];
  const skipKept = Math.min(1, gain(k.cymbal));

  meter.groupSpans.forEach((g, gi) => {
    const strong = gi % 2 === 0;
    const at = (n) => g.start + n * meter.slotLen;

    if (flavor === 'jazz') {
      ev.push(drum('ride', at(0), strong ? 0.66 : 0.76, 0.5));
      if (g.slots === 3) { if (rng.chance(skipKept)) ev.push(drum('ride', at(2), 0.48, 0.5)); } // the triplet "skip"
      else if (rng.chance(0.7 * skipKept)) ev.push(drum('ride', at(1), 0.42, 0.5));
      if (!strong) ev.push(drum('hatPedal', at(0), 0.5, 0.1));
      ev.push(drum('kick', at(0), 0.16 + rng.next() * 0.06, 0.2)); // feathered
    } else {
      for (let n = 0; n < g.slots; n++) {
        if (n > 0 && !rng.chance(Math.min(1, gain(k.cymbal)))) continue;
        ev.push(drum('hat', at(n), n === 0 ? 0.7 : 0.48, 0.2));
      }
      if (strong) {
        ev.push(drum('kick', at(0), 0.85, 0.25));
        if (g.slots === 3 && rng.chance(odds(flavor === 'rock' ? 0.3 : 0.2, k.kick))) ev.push(drum('kick', at(2), 0.6, 0.25));
      } else {
        ev.push(drum('snare', at(0), 0.9, 0.3));
      }
    }
  });

  // snare: in jazz it answers the soloist, one or two hits a bar, some ghosted and some accented; elsewhere it adds ghosts
  if (flavor === 'jazz') {
    const spots = rng.shuffle(meter.slots.filter((x) => x.posInGroup > 0));
    const s = Math.max(1, k.snare) / 50;
    const hits = rng.weighted([[0, 2], [1, 4 * s], [2, 2 * s * s]]);
    for (const slot of spots.slice(0, hits)) {
      const vel = 0.38 + rng.next() * 0.32;
      if (vel < 0.5 && !rng.chance(Math.min(1, gain(k.ghosts)))) continue;
      ev.push(drum('snare', slot.start, vel, 0.2));
    }
  } else if (rng.chance(odds(0.25, k.ghosts))) {
    const slot = rng.pick(meter.slots.filter((x) => x.posInGroup > 0));
    ev.push(drum('snare', slot.start, 0.3 + rng.next() * 0.12, 0.15));
  }

  const crashBase = flavor === 'rock' ? 1 : chorus > 1 ? 0.6 : 0;
  const after = state.crashNext;
  state.crashNext = false;
  if ((isFirstBar && rng.chance(Math.min(1, crashBase * gain(k.crash)))) || (after && rng.chance(Math.min(1, 0.85 * gain(k.crash))))) {
    ev.push(drum('crash', 0, flavor === 'rock' ? 0.7 : 0.5, 1));
  }

  // fill: from a single hit on the last eighth, up to a build through the last two groups
  if (wantsFill(ctx, { last: 0.6, mid: 0.12 })) {
    const level = fillLevel(rng, k.wild);
    const groups = meter.groupSpans;
    const last = groups[groups.length - 1];
    const span = level === 'simple' ? [last.start + (last.slots - 1) * meter.slotLen] : null;
    if (span) ev.push(drum('snare', span[0], 0.65, 0.25));
    else {
      const from = level === 'normal' ? groups.length - 1 : Math.max(0, groups.length - 2);
      const slots = slotsWithin(meter, groups[from].start, meter.quarters - groups[from].start);
      slots.forEach((s, i) => {
        const tail = i >= slots.length - 2;
        ev.push(drum(tail && level !== 'normal' ? (i === slots.length - 1 ? 'tomLow' : 'tomMid') : i === slots.length - 1 ? 'tomLow' : 'snare', s.start, 0.5 + (0.4 * (i + 1)) / slots.length, 0.25));
      });
      state.crashNext = level === 'wild' || level === 'epic';
    }
  }
  return ev;
}
