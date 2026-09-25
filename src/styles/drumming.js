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
import { hashSeed } from '../engine/rng.js';
import { ODD_GROOVES } from './oddgrooves.js';
import { oddGrooveIds } from './oddoptions.js';
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

/**
 * Turn the stick jazz kit into brushes. The ride pattern and the snare comping are played with brush taps, the crash
 * becomes a brushed crash (a soft swell), the open hat goes, and a left-hand sweep is added: a swish on each beat, leaning on two and four. In "sweep" (the ballad
 * sound) the ride pattern goes too and the sweep carries the time on its own.
 */
function brushify(ctx, ev, mode) {
  const { rng, kitOpts: k } = ctx;
  const out = [];
  for (const e of ev) {
    if (e.voice === 'hatOpen') continue;
    if (mode === 'sweep' && e.voice === 'ride') continue;
    if (e.voice === 'ride') out.push({ ...e, voice: 'brush', vel: Math.min(1, e.vel * 1.1) });
    else if (e.voice === 'crash') out.push({ ...e, voice: 'brushCrash', vel: Math.min(1, e.vel * 0.85), dur: Math.max(e.dur, 1.2) });
    else if (e.voice === 'snare') out.push({ ...e, voice: 'brush', vel: Math.min(1, e.vel * 1.15) });
    else out.push(e);
  }
  const at = ctx.meter.id === '4/4' ? [0, 1, 2, 3] : ctx.meter.groupSpans.map((g) => g.start);
  at.forEach((b, i) => {
    const back = i % 2 === 1;
    if (mode === 'sweep') {
      out.push(drum('swish', b, (back ? 0.5 : 0.4) + rng.next() * 0.1, 0.5));
      if (k.cymbal > 50 && rng.chance(((k.cymbal - 50) / 50) * 0.6)) out.push(drum('swish', b + 0.5, 0.3, 0.4));
    } else if (back || rng.chance(0.5 * Math.min(1, gain(k.cymbal)))) {
      out.push(drum('swish', b, back ? 0.5 + rng.next() * 0.08 : 0.3, 0.4));
    }
  });
  return out;
}

// ---- Latin jazz --------------------------------------------------------------------------------
// Straight eighths whatever the Swing slider says (every note is `fixed`; choosing one of these grooves sets Swing to 50%
// so the bass and keys agree). The cross-stick plays the clave that runs through the groove. 4/4 only.

const straight = (voice, beat, vel, dur = 0.2) => drum(voice, beat, vel, dur, { fixed: true });

/**
 * The claves, one bar at a time (beats from the start of the bar). Every clave is two bars, a "three side" with three hits and
 * a "two side" with two:
 *   son    1, "and" of 2, 4          |  2, 3            the clave of Afro-Cuban music
 *   rumba  1, "and" of 2, "and" of 4 |  2, 3            the last hit of the three side falls an eighth later
 *   bossa  1, "and" of 2, 4          |  2, "and" of 3   the bossa nova clave: the two side's second hit falls an eighth later
 * "3-2" plays the three side first, "2-3" starts on the two side.
 */
export const CLAVES = {
  son: [[0, 1.5, 3], [1, 2]],
  rumba: [[0, 1.5, 3.5], [1, 2]],
  bossa: [[0, 1.5, 3], [1, 2.5]],
};
export const CLAVE_IDS = Object.keys(CLAVES).flatMap((name) => [`${name}32`, `${name}23`]);

/** The clave hits for a bar of the chorus. `id` is like "son32" or "bossa23". */
export function claveBar(id, barIndex) {
  const sides = CLAVES[id.slice(0, -2)];
  const start = id.endsWith('23') ? 1 : 0;
  return sides[(barIndex + start) % 2];
}

/** Each Latin groove has a clave of its own; the Clave setting overrides it. */
const OWN_CLAVE = { bossa: 'bossa32', afro: 'son32', latinballad: 'son32' };
function claveFor(ctx, groove) {
  const c = ctx.kitOpts.clave;
  if (c === 'mixed') return CLAVE_IDS[hashSeed(ctx.seed ?? 0, ctx.chorus ?? 1, Math.floor(ctx.barIndex / 4) + 77) % CLAVE_IDS.length]; // a new clave every four bars
  return CLAVE_IDS.includes(c) ? c : OWN_CLAVE[groove];
}

const LATIN = {
  // bossa nova: eighth-note hat, the clave on the cross-stick, a kick that rocks between one, the "and" of two, three
  bossa(ctx) {
    const { rng, barIndex } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const offKept = Math.min(1, gain(k.cymbal));
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 1 && !rng.chance(offKept)) continue;
      ev.push(straight('hat', i / 2, i % 2 === 0 ? 0.52 : 0.36, 0.15));
    }
    ev.push(straight('hatPedal', 1, 0.42, 0.1), straight('hatPedal', 3, 0.42, 0.1));
    ev.push(straight('kick', 0, 0.8, 0.25), straight('kick', 2, 0.72, 0.25));
    if (rng.chance(odds(0.85, k.kick))) ev.push(straight('kick', 1.5, 0.6, 0.25));
    if (rng.chance(odds(0.8, k.kick))) ev.push(straight('kick', 3.5, 0.58, 0.25));
    for (const b of claveBar(claveFor(ctx, 'bossa'), barIndex)) ev.push(straight('rim', b, 0.62, 0.15));
    if (rng.chance(odds(0.2, k.snare))) ev.push(straight('rim', rng.pick([0.5, 2.5, 3.5]), 0.4, 0.12));
    for (const b of [0.5, 1.5, 2.5, 3.5]) if (rng.chance(odds(0.25, k.ghosts))) ev.push(straight('snare', b, 0.26 + rng.next() * 0.1, 0.12));
    return ev;
  },

  // Afro-Cuban: a bell-like ride on the beat, the clave on the cross-stick, a cascara on the hat, the foot on two and four
  afro(ctx) {
    const { rng, barIndex } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    for (let b = 0; b < 4; b++) ev.push(straight('ride', b, b % 2 === 0 ? 0.6 : 0.72, 0.4));
    if (k.cymbal > 60) for (let b = 0; b < 4; b++) if (rng.chance(((k.cymbal - 60) / 40) * 0.6)) ev.push(straight('ride', b + 0.5, 0.36, 0.3));
    const clave = claveBar(claveFor(ctx, 'afro'), barIndex);
    for (const b of clave) ev.push(straight('rim', b, 0.62, 0.15));
    // the cascara leans the same way as the clave: a fuller pattern against the three side, a sparser one against the two side
    const keep = Math.min(1, 0.6 + 0.4 * gain(k.cymbal));
    (clave.length === 3 ? [0, 0.5, 1.5, 2, 3] : [0, 1, 1.5, 2.5, 3]).forEach((b, i) => { if (i === 0 || rng.chance(keep)) ev.push(straight('hat', b, 0.36, 0.12)); });
    if (rng.chance(odds(0.25, k.snare))) ev.push(straight('rim', rng.pick([0.5, 2.5, 3.5]), 0.4, 0.12));
    ev.push(straight('hatPedal', 1, 0.55, 0.1), straight('hatPedal', 3, 0.55, 0.1));
    ev.push(straight('kick', 3, 0.7, 0.25));
    if (rng.chance(odds(0.9, k.kick))) ev.push(straight('kick', 1.5, 0.62, 0.25));
    if (rng.chance(odds(0.5, k.kick))) ev.push(straight('kick', 0, 0.6, 0.25));
    if (rng.chance(odds(0.3, k.kick))) ev.push(straight('kick', 2.5, 0.5, 0.25));
    for (const b of [0.5, 2.5, 3.5]) if (rng.chance(odds(0.3, k.ghosts))) ev.push(straight('tomMid', b, 0.28 + rng.next() * 0.1, 0.2));
    return ev;
  },

  // a slow Latin ballad (a bolero) on brushes: a sweep on every beat, a soft clave on the cross-stick, a gentle kick
  latinballad(ctx) {
    const { rng, barIndex } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    for (let b = 0; b < 4; b++) {
      ev.push(straight('swish', b, (b % 2 === 1 ? 0.5 : 0.38) + rng.next() * 0.06, 0.5));
      if (k.cymbal > 50 && rng.chance(((k.cymbal - 50) / 50) * 0.55)) ev.push(straight('swish', b + 0.5, 0.28, 0.4));
    }
    ev.push(straight('hatPedal', 1, 0.36, 0.1), straight('hatPedal', 3, 0.36, 0.1));
    ev.push(straight('kick', 0, 0.55, 0.3));
    if (rng.chance(odds(0.8, k.kick))) ev.push(straight('kick', 2, 0.45, 0.3));
    if (rng.chance(odds(0.45, k.kick))) ev.push(straight('kick', 3.5, 0.4, 0.3));
    for (const b of claveBar(claveFor(ctx, 'latinballad'), barIndex)) ev.push(straight('rim', b, 0.42, 0.15));
    if (rng.chance(odds(0.25, k.snare))) ev.push(straight('brush', rng.pick([0.5, 1.5, 2.5, 3.5]), 0.36, 0.2));
    for (const b of [0.5, 1.5, 2.5, 3.5]) if (rng.chance(odds(0.22, k.ghosts))) ev.push(straight('brush', b, 0.24 + rng.next() * 0.08, 0.15));
    return ev;
  },
};

// jazz-funk, made to lock with the jazz-funk bass riff (bass figure `funk`, hits on 1, the "a" of 1, the "and" of 2, 3, the "a" of 3,
// the "e" of 4 and the "and" of 4): the kick sits on the same accents, the backbeat is on two and four, sixteenth hats and ghosts fill in
LATIN.jazzfunk = function jazzfunk(ctx) {
  const { rng } = ctx;
  const k = ctx.kitOpts;
  const ev = [];
  const kept = Math.min(1, Math.max(0.35, gain(k.cymbal)));
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 1 && !rng.chance(kept)) continue;
    ev.push(straight('hat', i / 4, i % 4 === 0 ? 0.66 : i % 2 === 0 ? 0.48 : 0.3, 0.12));
  }
  if (rng.chance(odds(0.3, k.cymbal))) ev.push(straight('hatOpen', 3.5, 0.55, 0.3));
  // the kick: the riff's main accents always, its ghosted notes as Kick allows
  ev.push(straight('kick', 0, 0.9, 0.25), straight('kick', 1.5, 0.76, 0.2), straight('kick', 2.75, 0.7, 0.2));
  for (const b of [0.75, 2, 3.5]) if (rng.chance(odds(0.55, k.kick))) ev.push(straight('kick', b, b === 2 ? 0.66 : 0.6, 0.2));
  ev.push(straight('snare', 1, 0.92, 0.3), straight('snare', 3, 0.94, 0.3));
  for (const b of [0.25, 1.75, 2.25, 3.75]) if (rng.chance(odds(0.4, k.ghosts))) ev.push(straight('snare', b, 0.26 + rng.next() * 0.1, 0.12));
  if (rng.chance(odds(0.25, k.snare))) ev.push(straight('snare', 3.25, 0.5 + rng.next() * 0.1, 0.15));
  return ev;
};

// a fast straight ride, in the manner of Pat Metheny's groups: an even, unswung eighth-note ride (the beats a little stronger), the
// hi-hat foot on two and four, a feathered kick with syncopated bombs, and a busy, interactive snare that comments around the
// soloist on the sixteenth-note grid, some hits ghosted and some accented
const STRAIGHT_COMP = [
  [3, []],
  [3, [[1.5, 0.55, 0.72]]],
  [2.5, [[0.75, 0.5, 0.68], [2.5, 0.36, 0.5]]],
  [2.5, [[1.75, 0.36, 0.5], [3.5, 0.55, 0.72]]],
  [2, [[0.5, 0.34, 0.48], [1.75, 0.55, 0.7], [3.25, 0.34, 0.48]]],
  [2, [[2.75, 0.55, 0.72], [3.5, 0.34, 0.48]]],
  [1.5, [[0.75, 0.34, 0.48], [1.5, 0.55, 0.7], [2.25, 0.34, 0.48], [3.5, 0.6, 0.74]]],
].map(([weight, hits]) => [hits, weight]);

LATIN.straightride = function straightride(ctx) {
  const { rng } = ctx;
  const k = ctx.kitOpts;
  const ev = [];
  // the ride: even eighths, the beats a little stronger; Cymbal thins the "ands" away, and at the top adds a flutter of sixteenths
  const offKept = Math.min(1, gain(k.cymbal));
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 1 && !rng.chance(offKept)) continue;
    ev.push(straight('ride', i / 2, i % 2 === 0 ? 0.68 : 0.46, 0.3));
  }
  if (k.cymbal > 60) for (const b of [0.25, 1.25, 2.25, 3.25]) if (rng.chance(((k.cymbal - 60) / 40) * 0.4)) ev.push(straight('ride', b, 0.3, 0.15));
  ev.push(straight('hatPedal', 1, 0.5, 0.1), straight('hatPedal', 3, 0.5, 0.1));
  // the kick: feathered on one and three, and syncopated bombs as Kick allows
  ev.push(straight('kick', 0, 0.34, 0.2), straight('kick', 2, 0.3, 0.2));
  for (const b of [0.75, 1.5, 2.75, 3.5]) if (rng.chance(odds(0.22, k.kick))) ev.push(straight('kick', b, 0.55 + rng.next() * 0.1, 0.2));
  // the snare: one comping phrase a bar, more hits as Snare rises; the quiet ones follow Ghost notes
  const s = Math.max(1, k.snare) / 50;
  const cells = STRAIGHT_COMP.map(([hits, w]) => [hits, w * s ** hits.length]);
  for (const [b, lo, hi] of rng.weighted(cells)) {
    if (hi <= 0.55 && !rng.chance(Math.min(1, gain(k.ghosts)))) continue;
    ev.push(straight('snare', b, lo + rng.next() * (hi - lo), 0.15));
  }
  return ev;
};
const LATIN_IDS = Object.keys(LATIN);
/** The straight (unswung) jazz grooves fill in straight sixteenths; the rest fill in triplets. */
const STRAIGHT_FILLS = ['jazzfunk', 'straightride'];

function latinJazz(ctx, id) {
  let ev = LATIN[id](ctx);
  ev.push(...crashes(ctx, { firstBase: ctx.chorus > 1 ? 0.6 : 0, vel: 0.5, len: 1 }));
  const before = ev.length;
  addFill(ctx, ev, STRAIGHT_FILLS.includes(id) ? 'rock' : 'jazz', { last: 0.7, mid: 0.3 });
  for (let i = before; i < ev.length; i++) ev[i] = { ...ev[i], fixed: true }; // these grooves are unswung, and so are their fills
  if (id === 'latinballad') { // it is all brushes: a fill is brushed and a crash is a brushed crash
    ev = ev.map((e) => {
      if (e.voice === 'crash') return { ...e, voice: 'brushCrash', vel: Math.min(1, e.vel * 0.85), dur: Math.max(e.dur, 1.2) };
      if (e.voice === 'snare') return { ...e, voice: 'brush', vel: Math.min(1, e.vel * 1.15) };
      return e;
    });
  }
  return ev;
}

/**
 * The Snare sound setting: play the snare part as the snare drum (as it is), as a cross-stick (a stick laid across the head
 * and struck on the rim), or as a woody stick click. The cross-stick clave of the Latin grooves follows too: it becomes a
 * stick click with "Sticks". Brushes are left alone.
 */
export function applySnareSound(events, sound, ctx = {}) {
  if (sound === 'mixed') sound = ['snare', 'rim', 'stick'][hashSeed(ctx.seed ?? 0, ctx.chorus ?? 1, (ctx.barIndex ?? 0) + 501) % 3]; // a different one each bar
  if (sound !== 'rim' && sound !== 'stick') return events;
  return events.map((e) => (e.inst === 'drums' && (e.voice === 'snare' || (sound === 'stick' && e.voice === 'rim')) ? { ...e, voice: sound } : e));
}

export function jazzDrums(ctx) {
  // Latin grooves are 4/4 grooves: in the /8 meters they fall back to sticks, like the blues and rock grooves do
  const odd = ctx.meter.id !== '4/4';
  const own = odd ? oddGrooveIds('jazz', ctx.meter.id) : [];
  const g = grooveFor(ctx, ['classic', 'brushes', 'sweep', ...own], ['classic', 'brushes', 'sweep', ...LATIN_IDS, ...own]);
  if (LATIN[g] && !odd) return latinJazz(ctx, g);
  const ev = odd ? oddDrums(ctx, 'jazz', own.includes(g) ? g : 'classic') : stickJazz(ctx);
  return g === 'brushes' || g === 'sweep' ? brushify(ctx, ev, g) : ev;
}

function stickJazz(ctx) {
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

/**
 * Which groove this bar plays. "Mixed" changes groove every four bars, differently in each run. A groove the style
 * does not have (a track loaded from another style) plays the style's classic one.
 */
function grooveFor(ctx, ids, valid = ids) {
  const g = ctx.kitOpts.groove;
  if (g === 'mixed') return ids[hashSeed(ctx.seed ?? 0, ctx.chorus ?? 1, Math.floor(ctx.barIndex / 4)) % ids.length];
  return valid.includes(g) ? g : 'classic';
}

/** Quiet snare notes at the given beats, as often as the Ghost notes slider allows. */
function sprinkle(ctx, ev, spots, base = 0.3) {
  const { rng, kitOpts: k } = ctx;
  for (const b of spots) if (rng.chance(odds(base, k.ghosts))) ev.push(drum('snare', b, 0.3 + rng.next() * 0.14, 0.15));
}

// The blues grooves. Each returns the bar's notes before crashes and fills. Positions are beats; 0.5 is the swung "and".
const BLUES_GROOVES = {
  // the shuffle it has always played
  classic(ctx) {
    const { rng } = ctx;
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
    sprinkle(ctx, ev, [0.5, 2.5], 0.4);
    if (rng.chance(odds(0.2, k.snare))) ev.push(drum('snare', 3.5, 0.5 + rng.next() * 0.12, 0.2));
    if (k.snare > 60 && rng.chance(((k.snare - 60) / 40) * 0.4)) ev.push(drum('snare', rng.chance(0.5) ? 1.5 : 2, 0.5 + rng.next() * 0.1, 0.2));
    return ev;
  },

  // slow blues in 12/8: every beat is three even notes on the hat, backbeat on two and four
  slow(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const t = (voice, beat, vel, dur = 0.25) => drum(voice, beat, vel, dur, { fixed: true });
    const middleKept = Math.min(1, gain(k.cymbal));
    for (let b = 0; b < 4; b++) {
      ev.push(t('hat', b, b % 2 === 0 ? 0.7 : 0.58), t('hat', b + 2 / 3, 0.5));
      if (rng.chance(middleKept)) ev.push(t('hat', b + 1 / 3, 0.36));
    }
    ev.push(drum('kick', 0, 0.84, 0.3), drum('kick', 2, 0.78, 0.3));
    if (rng.chance(odds(0.3, k.kick))) ev.push(t('kick', 2 + 2 / 3, 0.56, 0.3));
    if (k.kick > 60 && rng.chance(((k.kick - 60) / 40) * 0.4)) ev.push(t('kick', 1 + 2 / 3, 0.5, 0.3));
    ev.push(drum('snare', 1, 0.9, 0.3), drum('snare', 3, 0.92, 0.3));
    for (const b of [2 / 3, 2 + 2 / 3]) if (rng.chance(odds(0.35, k.ghosts))) ev.push(t('snare', b, 0.3 + rng.next() * 0.12, 0.15));
    return ev;
  },

  // the half-time shuffle (Purdie, "Home at Last"): one big snare on three, ghost notes rolling through the shuffle
  purdie(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const andKept = Math.min(1, gain(k.cymbal));
    [0.74, 0.5, 0.66, 0.5].forEach((v, b) => {
      ev.push(drum('hat', b, v, 0.3));
      if (rng.chance(andKept)) ev.push(drum('hat', b + 0.5, v * 0.66, 0.3));
    });
    ev.push(drum('kick', 0, 0.86, 0.3));
    if (rng.chance(0.75)) ev.push(drum('kick', 1.5, 0.66, 0.3));
    if (rng.chance(odds(0.3, k.kick))) ev.push(drum('kick', 2.5, 0.56, 0.3));
    if (k.kick > 60 && rng.chance(((k.kick - 60) / 40) * 0.5)) ev.push(drum('kick', 3.5, 0.52, 0.3));
    ev.push(drum('snare', 2, 0.96, 0.3));
    sprinkle(ctx, ev, [0.5, 1, 1.5, 2.5, 3.5], 0.55); // the ghosts that make it swing
    if (rng.chance(odds(0.2, k.snare))) ev.push(drum('snare', 3, 0.5 + rng.next() * 0.1, 0.2));
    return ev;
  },

  // Chicago: a kick on every beat under a shuffled ride and the backbeat
  chicago(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const andKept = Math.min(1, gain(k.cymbal));
    for (let b = 0; b < 4; b++) {
      ev.push(drum('ride', b, b % 2 === 0 ? 0.64 : 0.74, 0.4));
      if (rng.chance(andKept)) ev.push(drum('ride', b + 0.5, 0.44, 0.4));
      ev.push(drum('kick', b, b % 2 === 0 ? 0.62 : 0.5, 0.25));
    }
    ev.push(drum('snare', 1, 0.9, 0.3), drum('snare', 3, 0.92, 0.3));
    sprinkle(ctx, ev, [0.5, 2.5], 0.3);
    if (rng.chance(odds(0.25, k.kick))) ev.push(drum('kick', 3.5, 0.55, 0.25));
    return ev;
  },

  // the train beat: brushed-snare shuffle, quiet on every note, accented on the backbeat
  train(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const skipKept = Math.min(1, gain(k.cymbal));
    for (let b = 0; b < 4; b++) {
      const back = b % 2 === 1;
      ev.push(drum('snare', b, back ? 0.86 : 0.42, 0.25));
      if (rng.chance(skipKept)) ev.push(drum('snare', b + 0.5, back ? 0.5 : 0.34, 0.2));
    }
    ev.push(drum('kick', 0, 0.74, 0.3), drum('kick', 2, 0.68, 0.3));
    if (rng.chance(odds(0.3, k.kick))) ev.push(drum('kick', 3.5, 0.5, 0.3));
    ev.push(drum('hatPedal', 1, 0.44, 0.1), drum('hatPedal', 3, 0.44, 0.1));
    return ev;
  },
};
const BLUES_GROOVE_IDS = Object.keys(BLUES_GROOVES);

export function bluesDrums(ctx) {
  if (ctx.meter.id !== '4/4') return oddDrums(ctx, 'blues');
  const { chorus } = ctx;
  const ev = BLUES_GROOVES[grooveFor(ctx, BLUES_GROOVE_IDS)](ctx);
  ev.push(...crashes(ctx, { firstBase: chorus > 1 ? 0.6 : 0, vel: 0.55, len: 1 }));
  addFill(ctx, ev, 'blues', { last: 0.75, mid: 0.25 });
  return ev;
}

// ---- rock --------------------------------------------------------------------------------------

const KICKS = [[0, 2], [0, 0.5, 2], [0, 2, 2.5], [0, 1.5, 2]];
const KICKS_SIMPLE = [[0, 2]];
const KICKS_BUSY = [[0, 0.5, 2, 2.5, 3.5], [0, 1.5, 2, 2.75, 3.5], [0, 0.75, 1.5, 2, 2.5], [0, 0.5, 1.75, 2, 3.5]];

/** Straight-eighth hi-hat: quarters when Cymbal is low, eighths in the middle, sixteenths and an open hat above that. */
function rockHats(ctx, ev, { open = true } = {}) {
  const { rng } = ctx;
  const k = ctx.kitOpts;
  const offKept = Math.min(1, Math.max(0, (k.cymbal - 15) / 35));
  const openHat = open && rng.chance(odds(0.15, k.cymbal));
  for (let i = 0; i < 8; i++) {
    const b = i / 2;
    if (i % 2 === 1 && !rng.chance(offKept)) continue;
    if (openHat && b === 3.5) ev.push(drum('hatOpen', b, 0.6, 0.5));
    else ev.push(drum('hat', b, i % 2 === 0 ? 0.7 : 0.5, 0.2));
  }
  if (k.cymbal > 50) {
    for (let i = 0; i < 8; i++) if (rng.chance(((k.cymbal - 50) / 50) * 0.7)) ev.push(drum('hat', i / 2 + 0.25, 0.34, 0.15));
  }
}

const backbeat = (ev, a = 0.94, b = 0.96) => ev.push(drum('snare', 1, a, 0.3), drum('snare', 3, b, 0.3));

// The rock grooves. Each returns the bar's notes before crashes and fills.
const ROCK_GROOVES = {
  // the rock beat it has always played
  classic(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    rockHats(ctx, ev);
    // kick: as simple as one and three, the usual rock patterns, or busy syncopation
    const set = rng.weighted([
      [KICKS_SIMPLE, Math.max(0, 60 - k.kick) / 20],
      [KICKS, 3 * Math.min(1, k.kick / 20)],
      [KICKS_BUSY, Math.max(0, k.kick - 40) / 15],
    ]);
    const kicks = set === KICKS ? (rng.chance(0.55) ? KICKS[0] : rng.pick(KICKS)) : rng.pick(set);
    kicks.forEach((b) => ev.push(drum('kick', b, 0.88, 0.25)));
    // snare: the backbeat, always; ghosts a sixteenth before it; extras around it
    backbeat(ev);
    for (const b of [0.75, 2.75]) if (rng.chance(odds(0.3, k.ghosts))) ev.push(drum('snare', b, 0.3 + rng.next() * 0.12, 0.15));
    if (rng.chance(odds(0.22, k.snare))) ev.push(drum('snare', 3.5, 0.62 + rng.next() * 0.1, 0.2));
    if (k.snare > 60 && rng.chance(((k.snare - 60) / 40) * 0.35)) ev.push(drum('snare', rng.chance(0.5) ? 1.75 : 3.75, 0.5 + rng.next() * 0.1, 0.15));
    return ev;
  },

  // four on the floor: a kick on every beat, open hats on the offbeats, the backbeat on top
  fourfloor(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    for (let b = 0; b < 4; b++) {
      ev.push(drum('kick', b, 0.86, 0.25), drum('hat', b, 0.5, 0.15));
      if (rng.chance(Math.min(1, gain(k.cymbal)))) ev.push(drum('hatOpen', b + 0.5, 0.62, 0.3));
    }
    if (k.cymbal > 60) for (let b = 0; b < 4; b++) if (rng.chance(((k.cymbal - 60) / 40) * 0.5)) ev.push(drum('hat', b + 0.75, 0.32, 0.12));
    backbeat(ev, 0.9, 0.92);
    if (rng.chance(odds(0.2, k.snare))) ev.push(drum('snare', 3.75, 0.5 + rng.next() * 0.1, 0.15));
    return ev;
  },

  // half-time: the backbeat drops to a single heavy snare on three
  half(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    rockHats(ctx, ev, { open: false });
    const kicks = rng.weighted([
      [[0], Math.max(0.1, 50 - k.kick) / 20],
      [[0, 1.5], 3],
      [[0, 1.75], 2],
      [[0, 0.5, 1.5], 1 + k.kick / 40],
      [[0, 1.5, 3.5], k.kick / 30],
    ]);
    kicks.forEach((b) => ev.push(drum('kick', b, 0.9, 0.3)));
    ev.push(drum('snare', 2, 0.98, 0.35));
    for (const b of [1.75, 3.75]) if (rng.chance(odds(0.25, k.ghosts))) ev.push(drum('snare', b, 0.3 + rng.next() * 0.12, 0.15));
    if (rng.chance(odds(0.15, k.snare))) ev.push(drum('snare', 3.5, 0.6, 0.2));
    return ev;
  },

  // "boom boom clap": kick, kick, snare, twice, with the hats left out
  stomp(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    for (const [a, b] of [[0, 1], [2, 3]]) {
      ev.push(drum('kick', a, 0.92, 0.3), drum('kick', a + 0.5, 0.88, 0.3), drum('snare', b, 0.96, 0.3));
    }
    if (k.cymbal > 55) for (const b of [0, 1, 2, 3]) if (rng.chance(((k.cymbal - 55) / 45) * 0.9)) ev.push(drum('hat', b, 0.5, 0.15));
    if (rng.chance(odds(0.2, k.snare))) ev.push(drum('snare', 1.5, 0.66, 0.2));
    return ev;
  },

  // hard rock on the ride: eighth notes on the cymbal, big kick and snare underneath
  ride(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const offKept = Math.min(1, Math.max(0, (k.cymbal - 15) / 35));
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 1 && !rng.chance(offKept)) continue;
      ev.push(drum('ride', i / 2, i % 2 === 0 ? 0.74 : 0.5, 0.4));
    }
    const kicks = rng.weighted([[KICKS[0], 3], [KICKS[1], 2], [KICKS[2], 2], [KICKS_BUSY[0], Math.max(0, k.kick - 40) / 15]]);
    kicks.forEach((b) => ev.push(drum('kick', b, 0.9, 0.25)));
    backbeat(ev, 0.96, 0.98);
    if (rng.chance(odds(0.22, k.snare))) ev.push(drum('snare', 3.5, 0.62 + rng.next() * 0.1, 0.2));
    return ev;
  },

  // funk rock: sixteenth-note hats, ghosted snares, a syncopated kick
  funk(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const kept = Math.min(1, Math.max(0.35, gain(k.cymbal)));
    for (let i = 0; i < 16; i++) {
      if (i % 2 === 1 && !rng.chance(kept)) continue;
      ev.push(drum('hat', i / 4, i % 4 === 0 ? 0.68 : i % 2 === 0 ? 0.5 : 0.32, 0.12));
    }
    const kicks = rng.weighted([[[0, 0.75, 2, 2.5], 3], [[0, 1.75, 2.5], 2], [[0, 0.75, 1.5, 2.75], 1 + k.kick / 40], [[0, 2, 3.75], 2]]);
    kicks.forEach((b) => ev.push(drum('kick', b, 0.86, 0.2)));
    backbeat(ev, 0.92, 0.94);
    for (const b of [0.75, 1.25, 1.75, 2.75, 3.25, 3.75]) if (rng.chance(odds(0.4, k.ghosts))) ev.push(drum('snare', b, 0.28 + rng.next() * 0.12, 0.12));
    return ev;
  },

  // Bo Diddley: the "shave and a haircut" clave on the toms, eighth-note hats, kick on one and three
  diddley(ctx) {
    const { rng } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    rockHats(ctx, ev, { open: false });
    [[0, 'tomLow'], [0.75, 'tomMid'], [1.5, 'tomLow'], [2.5, 'tomMid'], [3, 'tomLow']].forEach(([b, voice]) => ev.push(drum(voice, b, 0.82, 0.3)));
    ev.push(drum('kick', 0, 0.86, 0.3), drum('kick', 2, 0.82, 0.3));
    if (rng.chance(odds(0.3, k.snare))) ev.push(drum('snare', 3.5, 0.6, 0.2));
    return ev;
  },
};
const ROCK_GROOVE_IDS = Object.keys(ROCK_GROOVES);

export function rockDrums(ctx) {
  if (ctx.meter.id !== '4/4') return oddDrums(ctx, 'rock');
  const ev = ROCK_GROOVES[grooveFor(ctx, ROCK_GROOVE_IDS)](ctx);
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
export function oddDrums(ctx, flavor, groove) {
  const g = groove ?? oddGrooveFor(ctx, flavor);
  const ev = ODD_GROOVES[g] ? ODD_GROOVES[g](ctx, flavor) : classicOdd(ctx, flavor);
  return oddFinish(ctx, ev, flavor);
}

/** Which groove a bar of a /8 meter plays: the chosen one if this style has it here, else the classic one. "Mixed" changes every four bars. */
function oddGrooveFor(ctx, flavor) {
  const ids = oddGrooveIds(flavor, ctx.meter.id);
  const g = ctx.kitOpts.groove;
  if (g === 'mixed') {
    const pool = ['classic', ...ids];
    return pool[hashSeed(ctx.seed ?? 0, ctx.chorus ?? 1, Math.floor(ctx.barIndex / 4) + 55) % pool.length];
  }
  return ids.includes(g) ? g : 'classic';
}

/** The classic /8 groove (what each style always played): kick, snare and ride or hat on the group downbeats. */
function classicOdd(ctx, flavor) {
  const { meter, rng } = ctx;
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

  return ev;
}

/** Crashes and fills for a bar of a /8 meter, whichever groove it plays. */
function oddFinish(ctx, ev, flavor) {
  const { meter, rng, isFirstBar, chorus, state } = ctx;
  const k = ctx.kitOpts;
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
