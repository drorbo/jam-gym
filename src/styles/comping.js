// The keyboard (and guitar) player. Each style's chord part reads the Keys panel (ctx.compOpts, see settings.js):
//
//   rhythm   Auto builds the rhythm from the sliders below; or pick a named pattern
//   density  how many chords: less leaves room for the soloist
//   sync     chords on the beat, or on the "ands" and pushed ahead of it
//   variety  keep a rhythm from bar to bar, or change it every time
//   tension  harmony: shells, rootless voicings, extended chords, upper-structure triads, altered tones
//   range    where on the keyboard
//   spread   notes packed together, or opened out
//   length   staccato to sustained
//
// Dynamics, Timing and Feel are applied afterwards, in renderBar. As with the drums, 50 is "as the style always
// played", so a style left at its defaults sounds as it did before the panel existed.

import { placeVoicing, voicingPcs } from '../engine/voicing.js';
import { slotsWithin } from '../theory/meter.js';
import { mod12 } from '../theory/notes.js';
import { capDur, note } from './helpers.js';

// ---- small mappings ------------------------------------------------------------------------

/** Tension, 0 to 100, as one of five levels. */
export const tensionLevel = (v) => Math.min(4, Math.max(0, Math.round(v / 25)));
/** Note length: 0 to 100 -> 0.35 (staccato) .. 1 (as the style plays) .. 1.55 (sustained). */
export const lengthFactor = (v) => (v <= 50 ? 0.35 + 0.013 * v : 1 + 0.011 * (v - 50));
/** Register: 0 to 100 -> the middle of the keyboard window, C3 (48) up to F#5 (78). */
export const centerFor = (range) => Math.round(48 + range * 0.3);
/** Voicing: 0 to 100 -> how far apart the top and bottom notes may be, in semitones (8 to 19). */
export const spanFor = (spread) => Math.round(8 + spread * 0.11);

const interp = (table, v) => {
  const x = Math.min(3.999, Math.max(0, v / 25));
  const i = Math.floor(x);
  return table[i] + (table[i + 1] - table[i]) * (x - i);
};
/** Average number of chord hits in a four-beat bar, by style and density. */
const MEAN_HITS = { jazz: [1, 1.6, 2.4, 3.6, 5.6], blues: [1, 1.8, 3, 4.2, 6.5], rock: [1, 2, 4, 6, 8] };

// Where a hit is likely to fall, by beat of the bar (0 is beat one). "on" = the beat, "off" = the "and" after it.
const WEIGHTS = {
  jazz: { on: [1.0, 0.75, 0.9, 0.65], off: [0.4, 1.0, 0.8, 1.0] },
  blues: { on: [1.0, 0.8, 1.0, 0.8], off: [0.5, 0.6, 0.6, 0.6] },
  rock: { on: [1.0, 0.8, 0.9, 0.8], off: [0.7, 0.7, 0.7, 0.7] },
};

// Named rhythms for a four-beat chord: [start, length, velocity] (rock adds muted?).
const PRESETS = {
  jazz: {
    charleston: [[0, 1.4, 0.74], [1.5, 0.5, 0.6]],
    ands: [[0.5, 0.5, 0.64], [2.5, 0.5, 0.66]],
    late: [[1.5, 0.5, 0.62], [3, 0.8, 0.66]],
    long: [[0, 2.4, 0.7], [2.5, 0.5, 0.58]],
    twofour: [[1, 0.8, 0.64], [3, 0.8, 0.64]],
    busy: [[0, 0.6, 0.7], [1.5, 0.5, 0.6], [3.5, 0.4, 0.62]],
  },
  blues: {
    fourbar: [[0, 0.9, 0.62], [1, 0.9, 0.5], [2, 0.9, 0.56], [3, 0.9, 0.5]],
    longshort: [[0, 1.9, 0.6], [2, 0.9, 0.55], [3.5, 0.45, 0.5]],
    pad: [[0, 3.6, 0.55]],
    stabs: [[0, 0.45, 0.64], [0.5, 0.45, 0.5], [1.5, 0.45, 0.5], [2, 0.45, 0.6], [2.5, 0.45, 0.5], [3.5, 0.45, 0.5]],
  },
  rock: {
    chug: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b) => [b, 0.4, b % 1 === 0 ? 0.78 : 0.6, false, true]),
    quarters: [0, 1, 2, 3].map((b) => [b, 0.95, 0.74, true, false]),
    stabs: [[0, 1.4, 0.8, true, false], [1.5, 0.4, 0.68, true, false], [2.5, 1.4, 0.76, true, false]],
    open: [[0, 3.9, 0.7, true, false]],
  },
};

// ---- the rhythm -----------------------------------------------------------------------------

/**
 * The chord hits for one chord in 4/4 (or a shorter chord): [{ b, len, vel, full?, mute? }], b relative to the chord.
 * @param {{startBeat:number, beats:number}} seg
 * @param {'jazz'|'blues'|'rock'} style
 */
export function compHits(seg, style, opts, rng, state) {
  const n = Math.max(1, Math.round(seg.beats));
  const fac = lengthFactor(opts.length);
  const cap = (len, b, next) => Math.max(0.1, Math.min(len * fac, (next - b) * 0.98));

  // "Mixed": each bar draws its rhythm from the sliders or from any of the style's named patterns
  const named = Object.keys(PRESETS[style] ?? {});
  const chosen = opts.rhythm === 'mixed' ? rng.pick(['auto', ...named]) : opts.rhythm;
  // a named pattern for a whole-bar chord (shorter chords are always built from the sliders)
  const preset = chosen !== 'auto' ? PRESETS[style]?.[chosen] : null;
  if (preset && n === 4) {
    return preset.map(([b, len, vel, full, mute], i) => ({ b, len: cap(len, b, preset[i + 1]?.[0] ?? n), vel, full, mute }));
  }

  state.comp ??= {};
  const memory = `${style}${n}`;
  const wantRepeat = state.comp[memory] && rng.chance((1 - opts.variety / 100) * 0.9);
  let starts;
  if (wantRepeat) starts = state.comp[memory];
  else {
    starts = pickStarts(seg, n, style, opts, rng);
    // rock guitar's staple: palm-muted eighths, more likely the busier and squarer it is asked to play
    if (style === 'rock' && n >= 2 && rng.chance(Math.min(0.9, Math.max(0, (opts.density - 40) / 50)) * (1 - opts.sync / 200))) {
      starts = Array.from({ length: n * 2 }, (_, i) => i / 2);
    }
    state.comp[memory] = starts;
  }

  return starts.map((b, i) => {
    const next = starts[i + 1] ?? n;
    const gap = next - b;
    const last = i === starts.length - 1;
    const sustained = last && starts.length === 1;
    const base = sustained ? gap * 0.9 : gap * (last ? 0.85 : 0.66);
    const off = b % 1 !== 0;
    const mute = style === 'rock' && (gap <= 0.5 || opts.length < 25);
    return {
      b,
      len: Math.max(0.1, Math.min(base * fac, gap * (sustained ? 0.98 : 1))),
      vel: (style === 'rock' ? 0.78 : style === 'blues' ? 0.58 : 0.7) * (off ? 0.88 : 1) * (i === 0 ? 1.04 : 1),
      full: style === 'rock' ? !mute : undefined,
      mute: style === 'rock' ? mute : undefined,
    };
  });
}

/** Choose where the hits fall inside a chord. The first hit always lands within the first beat, so a change is marked. */
function pickStarts(seg, n, style, opts, rng) {
  const sync = opts.sync / 100;
  const w = WEIGHTS[style];
  const barBeat = (p) => Math.floor(seg.startBeat + p + 1e-9) % 4;
  const candidates = [];
  for (let p = 0; p < n; p += 0.5) {
    const off = p % 1 !== 0;
    const weight = off ? w.off[barBeat(p)] * sync + 0.05 : w.on[barBeat(p)] * (1 - sync) + 0.05;
    candidates.push({ p, weight });
  }
  const target = Math.max(1, Math.round(interp(MEAN_HITS[style], opts.density) * (n / 4) + rng.jitter(0.5)));
  const count = Math.min(target, style === 'rock' ? n * 2 : n * 2 - 1);

  // the first hit: at the change, or a half beat / beat late (the more off-beat, the later)
  const firsts = candidates.filter((c) => c.p <= 1).map((c) => ({ ...c, weight: c.weight * (c.p === 0 ? 1.4 : 1) }));
  const first = rng.weighted(firsts.map((c) => [c.p, c.weight]));
  const chosen = [first];
  const minGap = 0.5;
  while (chosen.length < count) {
    const free = candidates.filter((c) => chosen.every((q) => Math.abs(q - c.p) >= minGap - 1e-9));
    if (!free.length) break;
    chosen.push(rng.weighted(free.map((c) => [c.p, c.weight])));
  }
  return chosen.sort((a, b) => a - b);
}

// ---- the voicings ---------------------------------------------------------------------------

/**
 * Pitch classes for a keyboard chord in a style at a tension level (0 to 4).
 * Jazz plays without the root (the bass has it); the blues keeps the root under the organ. `rng` is only for the things the
 * Altered level does "sometimes" (a #11); without it they never happen.
 */
export function keyPcs(chord, style, level, rng = null) {
  return style === 'blues' ? bluesPcs(chord, level) : jazzPcs(chord, level, rng);
}

const abs = (c, offsets) => [...new Set(offsets.map((i) => mod12(c.root + i)))];

/**
 * The tensions a chord symbol spells out (pitch classes above the root): every tone it names beyond the root, the guide tones
 * (third, seventh or sixth) and a natural fifth. "F79" spells the 9, "F7#9b13" the #9 and the b13, "F7alt" the b9, #9, b5 and b13.
 */
export function writtenTensions(c) {
  const seventh = c.seventh ?? (c.sixth ? 9 : null);
  return c.pcs.filter((pc) => pc !== 0 && pc !== c.third && pc !== seventh && !(pc === 7 && (c.fifth ?? 7) === 7));
}

/**
 * Make a voicing keep to what the symbol says. Whatever the Harmony setting picked, every tension the symbol spells out is
 * played, and no other tension of the same kind is added on top of it: a written 9 (natural, flat or sharp) keeps out every
 * other 9, a written 13 or #5 every other 13, a written 11 or #11 every other 11, and a written altered fifth the natural one.
 * @param {number[]} generic pitch classes above the root chosen by the level
 */
function reconcile(c, generic) {
  const written = writtenTensions(c);
  const seventh = c.seventh ?? (c.sixth ? 9 : null);
  const guide = new Set([c.third, seventh].filter((x) => x !== null && x !== undefined));
  const alt = /alt/.test(c.suffix);
  const drop = new Set();
  if (c.ninth !== null) [1, 2, 3].forEach((x) => drop.add(x));
  if (c.thirteenth !== null || c.fifth === 8 || alt) [8, 9].forEach((x) => drop.add(x));
  if (c.eleventh !== null || alt) [5, 6].forEach((x) => drop.add(x)); // (a written b5 keeps the natural 11 of a half-diminished chord)
  if ((c.fifth ?? 7) !== 7) drop.add(7);
  const kept = generic.filter((x) => guide.has(x) || !drop.has(x) || written.includes(x));
  return [...new Set([...kept, ...written])];
}

function jazzPcs(c, level, rng) {
  const rel = (pcs) => pcs.map((pc) => mod12(pc - c.root));
  const third = c.third ?? 7;
  const fifth = c.fifth ?? 7;
  const seventh = c.seventh ?? (c.sixth ? 9 : null);
  const guide = [third, seventh ?? 0];
  // a chord that spells out a natural 9 or 13 is not an altered chord, so the Altered level does not alter it
  const natural = c.ninth === 14 || c.thirteenth === 21;
  const sometimes = (p) => !natural && rng !== null && rng.chance(p);
  let tones;
  switch (c.family) {
    case 'dominant': {
      const sev = seventh ?? 10;
      if (level === 0) tones = [third, sev];
      else if (level === 1) tones = rel(voicingPcs(c, 'rootless'));
      else if (level === 2) tones = [third, sev, 2, 9, 7];
      else if (level === 3 || natural) tones = [third, sev, 2, 9];
      else tones = [third, sev, 1, sometimes(0.4) ? 6 : 3, 8]; // altered: b9, #9 (sometimes a #11 instead), b13
      break;
    }
    case 'major': {
      const sev = seventh ?? 9;
      if (level === 0) tones = [third, sev];
      else if (level === 1) tones = rel(voicingPcs(c, 'rootless'));
      else if (level === 2) tones = [third, sev, 2, 9, fifth];
      else if (level === 3) tones = [third, sev, 2, 9]; // 9 and 13, never an 11 or a #11
      else tones = [third, sev, 2, 9, ...(sometimes(0.35) ? [6] : [])]; // altered: now and then a #11
      break;
    }
    case 'minor': {
      const sev = seventh ?? 9;
      if (level === 0) tones = [third, sev];
      else if (level === 1) tones = rel(voicingPcs(c, 'rootless'));
      else if (level === 2) tones = [third, sev, 2, 5];
      else if (level === 3) tones = [third, sev, 2, 5, fifth];
      else tones = [third, sev, 5, fifth, 9];
      break;
    }
    case 'halfdim':
      if (level === 0) tones = [3, 10];
      else if (level === 1) tones = rel(voicingPcs(c, 'rootless'));
      else if (level === 4) tones = [3, 10, 5, 8];
      else tones = [3, 10, 6, 5, 8];
      break;
    default:
      tones = level === 0 ? guide.filter((x) => x !== null) : rel(voicingPcs(c, 'rootless'));
  }
  return abs(c, reconcile(c, tones));
}

function bluesPcs(c, level) {
  const third = c.third ?? 7;
  const fifth = c.fifth ?? 7;
  const seventh = c.seventh ?? 10;
  const minor = c.family === 'minor';
  const natural = c.ninth === 14 || c.thirteenth === 21;
  let tones;
  switch (level) {
    case 0: tones = [0, third, fifth]; break;
    case 1: tones = [0, third, fifth, ...(c.seventh !== null || c.sixth ? [c.seventh ?? 9] : [])]; break;
    case 2: tones = [0, third, seventh, 2]; break;
    case 3: tones = [third, seventh, 2, 9]; break;
    default: tones = minor || natural ? [0, third, seventh, 2] : [0, third, seventh, 3]; // the "Hendrix" sharp nine, unless a natural 9 is written
  }
  return abs(c, reconcile(c, tones));
}

/** A guitar chord at a tension level: power chord, thirds, full, add 9, open and ringing. `shift` moves it up an octave. */
export function rockNotes(chord, level, { muted = false, shift = 0, spread = 50 } = {}) {
  const notes = rockShape(chord, level, { muted, shift });
  const r = 40 + mod12(chord.root - 40) + shift;
  // Voicing: a compact grip keeps to one octave above the root; a wide one doubles the root two octaves up
  if (spread < 25) return notes.filter((m) => m - r <= 12 || m === notes[0]);
  if (spread >= 70 && !notes.includes(r + 24)) return [...notes, r + 24];
  return notes;
}

function rockShape(chord, level, { muted, shift }) {
  const notes = rockShapeBase(chord, level, { muted, shift });
  if (muted) return notes;
  // a tension written in the symbol (C9, C7#9, Cadd9...) is played, an octave above the root, whatever the Harmony setting
  const r = 40 + mod12(chord.root - 40) + shift;
  const extra = writtenTensions(chord).map((pc) => r + 12 + pc).filter((m) => !notes.includes(m));
  return [...notes, ...extra].sort((a, b) => a - b);
}

function rockShapeBase(chord, level, { muted, shift }) {
  const r = 40 + mod12(chord.root - 40) + shift;
  const fifth = chord.fifth ?? 7;
  const power = [r, r + fifth, r + 12];
  const third = chord.third;
  const seventh = chord.seventh !== null && chord.family !== 'dim' ? r + 12 + chord.seventh : r + 12 + fifth;
  if (level === 0 || third === null) return power;
  if (level === 1) return muted ? power : [...power, r + 12 + third, seventh];
  if (level === 2) return [...power, r + 12 + third, seventh];
  if (level === 3) return [...power, r + 12 + third, r + 26];
  return [...power, r + 12 + third, r + 12 + fifth, r + 24];
}

// ---- 4/4 chord parts ------------------------------------------------------------------------

/** Keyboard comping for one bar in 4/4: 'jazz' (piano, rootless) or 'blues' (organ or electric piano, block chords). */
export function keysBar(ctx, style) {
  const { segments, state, rng } = ctx;
  const o = ctx.compOpts;
  const ev = [];
  const level = tensionLevel(o.tension);
  const center = centerFor(o.range);
  const win = { lo: center - 10, hi: center + 10, center, maxSpan: spanFor(o.spread) };
  for (const seg of segments) {
    if (!seg.chord) continue;
    const hits = compHits(seg, style, o, rng, state);
    state.voicing = placeVoicing(keyPcs(seg.chord, style, level, rng), state.voicing, win);
    const end = seg.startBeat + seg.beats;
    for (const h of hits) {
      const beat = seg.startBeat + h.b;
      if (beat >= end) continue;
      state.voicing.forEach((midi, i) => {
        ev.push(note('chords', midi, beat, capDur(h.len, beat, end), h.vel * (0.95 + rng.next() * 0.1), { dt: i * (style === 'jazz' ? 0.004 : 0.003) }));
      });
    }
  }
  return ev;
}

/** Guitar for one bar of rock in 4/4. */
export function guitarBar(ctx) {
  const { segments, rng, state } = ctx;
  const o = ctx.compOpts;
  const ev = [];
  const level = tensionLevel(o.tension);
  const shift = o.range >= 72 ? 12 : 0;
  for (const seg of segments) {
    if (!seg.chord) continue;
    const end = seg.startBeat + seg.beats;
    for (const h of compHits(seg, 'rock', o, rng, state)) {
      const beat = seg.startBeat + h.b;
      if (beat >= end) continue;
      const muted = Boolean(h.mute);
      // a chord of one beat is always a power chord; longer ones follow the Harmony setting
      const notes = rockNotes(seg.chord, seg.beats < 2 ? 0 : level, { muted, shift, spread: o.spread });
      notes.forEach((midi, i) => {
        ev.push(note('chords', midi, beat, capDur(h.len, beat, end), h.vel * (0.95 + rng.next() * 0.1), {
          dt: i * (muted ? 0.002 : 0.011),
          art: muted ? 'mute' : undefined,
        }));
      });
    }
  }
  return ev;
}

// ---- the /8 meters --------------------------------------------------------------------------

/**
 * How the keys play 6/8, 7/8 and 10/8. Hits fall on group downbeats (on the beat) or on the skip at the end of a
 * 3-group (off the beat); the same sliders apply: how many, on or off, how tense, where, how long.
 */
export function oddChords(ctx, flavor) {
  const { meter, segments, state, rng } = ctx;
  const o = ctx.compOpts;
  const style = flavor;
  const ev = [];
  const level = tensionLevel(o.tension);
  const center = centerFor(o.range);
  const win = { lo: center - 10, hi: center + 10, center, maxSpan: spanFor(o.spread) };
  const fac = lengthFactor(o.length);
  const sync = o.sync / 100;
  const dens = Math.max(0, o.density) / 50;

  for (const seg of segments) {
    if (!seg.chord) continue;
    const end = seg.startBeat + seg.beats;
    const slots = slotsWithin(meter, seg.startBeat, seg.beats);
    const groups = meter.groupSpans
      .filter((g) => g.start >= seg.startBeat - 1e-9 && g.start < seg.startBeat + seg.beats - 1e-9)
      .map((g) => ({ ...g, len: Math.min(g.len, seg.startBeat + seg.beats - g.start) }));
    const hits = []; // { beat, len, vel, muted?, full? }
    const downbeats = groups.slice(1).map((g) => g.start);
    const skips = groups.filter((g) => g.slots === 3).map((g) => g.start + 2 * meter.slotLen);

    if (style === 'jazz') {
      hits.push({ beat: seg.startBeat + (sync > 0.7 && rng.chance(sync - 0.4) ? meter.slotLen : 0), len: Math.min(seg.beats * 0.6, 1.6), vel: 0.72 });
      const options = [...downbeats.map((b) => [b, 1 - sync + 0.1]), ...skips.map((b) => [b, sync + 0.1])].filter(([b]) => b > seg.startBeat + 0.6);
      if (options.length && rng.chance(Math.min(1, 0.8 * dens))) hits.push({ beat: rng.weighted(options), len: 0.9, vel: 0.62 });
      if (slots.length > 4 && rng.chance(Math.min(1, 0.3 * dens))) {
        const free = slots.map((s) => s.start).filter((b) => hits.every((h) => Math.abs(h.beat - b) > 0.6));
        if (free.length) hits.push({ beat: rng.pick(free), len: 0.5, vel: 0.58 });
      }
    } else if (style === 'blues') {
      if (dens < 0.35 || rng.chance(Math.max(0, 0.5 - dens * 0.25))) hits.push({ beat: seg.startBeat, len: seg.beats * 0.95, vel: 0.55 });
      else {
        groups.forEach((g, i) => { if (i === 0 || rng.chance(Math.min(1, 0.9 * dens))) hits.push({ beat: g.start, len: g.len * 0.9, vel: i === 0 ? 0.62 : 0.5 }); });
        for (const b of skips) if (b < end && rng.chance(Math.min(1, sync * 0.8 * dens))) hits.push({ beat: b, len: 0.4, vel: 0.45 });
      }
    } else if (dens < 0.3 || rng.chance(Math.max(0, 0.2 - dens * 0.1))) {
      hits.push({ beat: seg.startBeat, len: seg.beats * 0.95, vel: 0.74, full: true });
    } else if (dens >= 0.9 && !rng.chance(0.3)) {
      slots.forEach((s, i) => { if (i === 0 || rng.chance(Math.min(1, dens * 0.6))) hits.push({ beat: s.start, len: 0.4, vel: s.posInGroup === 0 ? 0.78 : 0.6, muted: true }); });
    } else {
      groups.forEach((g) => hits.push({ beat: g.start, len: g.len * 0.95, vel: 0.74, full: true }));
      if (sync > 0.5 && rng.chance(sync * 0.6)) hits.push({ beat: end - meter.slotLen, len: 0.4, vel: 0.68, full: true });
    }

    if (style !== 'rock') state.voicing = placeVoicing(keyPcs(seg.chord, style, level, rng), state.voicing, win);
    hits.sort((a, b) => a.beat - b.beat);
    hits.forEach((h, i) => {
      if (h.beat >= end - 1e-9) return;
      const room = (hits[i + 1]?.beat ?? end) - h.beat;
      const len = capDur(Math.min(h.len * fac, room), h.beat, end);
      const vel = h.vel * (0.95 + rng.next() * 0.1);
      const notes = style === 'rock'
        ? rockNotes(seg.chord, h.muted && level < 2 ? 0 : level, { muted: h.muted, shift: o.range >= 72 ? 12 : 0, spread: o.spread })
        : state.voicing;
      notes.forEach((midi, k) => {
        ev.push(note('chords', midi, h.beat, len, vel, {
          dt: style === 'rock' ? k * (h.muted ? 0.002 : 0.011) : k * (style === 'jazz' ? 0.004 : 0.003),
          art: h.muted ? 'mute' : undefined,
        }));
      });
    });
  }
  return ev;
}
