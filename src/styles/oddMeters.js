// How the styles play in 6/8, 7/8 and 10/8.
//
// These meters are felt in groups: 6/8 = 3+3, 7/8 = 3+2+2, 10/8 = 3+3+2+2 eighths. So the group
// downbeats play the part of "beats": kick on the strong ones, snare on the others, a ride ping or a
// walking-bass step on each, chord hits on each. Style flavours ('jazz' | 'blues' | 'rock') decide
// the details. Positions are quarter notes; an eighth is 0.5.

import { guitarChord, placeVoicing, voicingPcs } from '../engine/voicing.js';
import { slotsWithin } from '../theory/meter.js';
import { mod12 } from '../theory/notes.js';
import { bassPc, boogieSteps, capDur, drum, note } from './helpers.js';
import { DEFAULT_BASS, walkOddBar } from './walking.js';

/** Group spans that start inside a chord's span, clipped to it. */
function groupsIn(meter, seg) {
  return meter.groupSpans
    .filter((g) => g.start >= seg.startBeat - 1e-9 && g.start < seg.startBeat + seg.beats - 1e-9)
    .map((g) => ({ ...g, len: Math.min(g.len, seg.startBeat + seg.beats - g.start) }));
}

// ---- drums -----------------------------------------------------------------------------

export function oddDrums(ctx, flavor) {
  const { meter, rng, isLastBar, isFirstBar, chorus, barIndex } = ctx;
  const ev = [];

  meter.groupSpans.forEach((g, gi) => {
    const strong = gi % 2 === 0;
    const at = (k) => g.start + k * meter.slotLen;

    if (flavor === 'jazz') {
      ev.push(drum('ride', at(0), strong ? 0.66 : 0.76, 0.5));
      if (g.slots === 3) ev.push(drum('ride', at(2), 0.48, 0.5)); // the triplet "skip"
      else if (rng.chance(0.7)) ev.push(drum('ride', at(1), 0.42, 0.5));
      if (!strong) ev.push(drum('hatPedal', at(0), 0.5, 0.1));
      ev.push(drum('kick', at(0), 0.16 + rng.next() * 0.06, 0.2)); // feathered
    } else {
      for (let k = 0; k < g.slots; k++) ev.push(drum('hat', at(k), k === 0 ? 0.7 : 0.48, 0.2));
      if (strong) {
        ev.push(drum('kick', at(0), 0.85, 0.25));
        if (g.slots === 3 && rng.chance(flavor === 'rock' ? 0.3 : 0.2)) ev.push(drum('kick', at(2), 0.6, 0.25));
      } else {
        ev.push(drum('snare', at(0), 0.9, 0.3));
      }
    }
  });

  if (flavor === 'jazz') {
    // the snare answers the soloist: one or two comping hits per bar, some ghosted and some accented
    const spots = rng.shuffle(meter.slots.filter((x) => x.posInGroup > 0));
    const hits = rng.weighted([[0, 2], [1, 4], [2, 2]]);
    for (const s of spots.slice(0, hits)) ev.push(drum('snare', s.start, 0.38 + rng.next() * 0.32, 0.2));
  }
  if (isFirstBar && (flavor === 'rock' || (chorus > 1 && rng.chance(0.6)))) ev.push(drum('crash', 0, flavor === 'rock' ? 0.7 : 0.5, 1));

  // fill: the last group of the last bar, one hit per eighth, building up
  if ((isLastBar && rng.chance(0.6)) || (barIndex % 4 === 3 && rng.chance(0.12))) {
    const g = meter.groupSpans[meter.groupSpans.length - 1];
    for (let k = 0; k < g.slots; k++) {
      ev.push(drum(k === g.slots - 1 ? 'tomLow' : 'snare', g.start + k * meter.slotLen, 0.5 + 0.12 * k, 0.25));
    }
  }
  return ev;
}

// ---- bass ------------------------------------------------------------------------------

export function oddBass(ctx, flavor) {
  const { meter, segments, state, rng, isLastBar } = ctx;
  const pattern = (ctx.bassOpts ?? DEFAULT_BASS).pattern;
  // jazz always walks; the blues walks when asked, and to turn the chorus around
  if (flavor === 'jazz' || (flavor === 'blues' && (pattern === 'walk' || (pattern === 'mixed' && isLastBar)))) {
    return walkOddBar(ctx, flavor);
  }
  const ev = [];
  const rockVariant = flavor === 'rock' ? rng.weighted([['eighths', 5], ['pushes', 3]]) : null;

  segments.forEach((seg) => {
    if (!seg.chord) return;
    const slots = slotsWithin(meter, seg.startBeat, seg.beats);

    const base = 28 + mod12(bassPc(seg.chord) - 28);
    if (flavor === 'blues') {
      const steps = boogieSteps(seg.chord);
      slots.forEach((s, i) => {
        const midi = base + steps[i % steps.length];
        ev.push(note('bass', midi, s.start, 0.42, s.posInGroup === 0 ? 0.8 : 0.62));
        state.bass = midi;
      });
      return;
    }
    // rock: driving eighths, or pushes that skip the middle of each 3-group
    slots.forEach((s) => {
      const groupSlots = meter.groups[s.group];
      if (rockVariant === 'pushes' && groupSlots === 3 && s.posInGroup === 1) return;
      ev.push(note('bass', base, s.start, 0.42, s.posInGroup === 0 ? 0.82 : 0.68));
      state.bass = base;
    });
  });
  return ev;
}

// ---- chords ----------------------------------------------------------------------------

export function oddChords(ctx, flavor) {
  const { meter, segments, state, rng } = ctx;
  const ev = [];

  for (const seg of segments) {
    if (!seg.chord) continue;
    const end = seg.startBeat + seg.beats;
    const slots = slotsWithin(meter, seg.startBeat, seg.beats);
    const groups = groupsIn(meter, seg);
    const hits = []; // {beat, len, vel, muted?, full?}

    if (flavor === 'jazz') {
      hits.push({ beat: seg.startBeat, len: Math.min(seg.beats * 0.6, 1.6), vel: 0.72 });
      // a second hit on a later group downbeat, or on the "skip" at the end of a 3-group
      const later = groups.slice(1).map((g) => g.start);
      const skips = groups.filter((g) => g.slots === 3).map((g) => g.start + 2 * meter.slotLen);
      const options = [...later, ...skips].filter((b) => b > seg.startBeat + 0.6);
      if (options.length && rng.chance(0.8)) hits.push({ beat: rng.pick(options), len: 0.9, vel: 0.62 });
      if (slots.length > 4 && rng.chance(0.3)) {
        const free = slots.map((s) => s.start).filter((b) => hits.every((h) => Math.abs(h.beat - b) > 0.6));
        if (free.length) hits.push({ beat: rng.pick(free), len: 0.5, vel: 0.58 });
      }
      state.voicing = placeVoicing(voicingPcs(seg.chord, 'rootless'), state.voicing, { lo: 52, hi: 72, center: 62 });
    } else if (flavor === 'blues') {
      const style = rng.weighted([['groups', 5], ['pad', 2], ['skips', 3]]);
      if (style === 'pad') hits.push({ beat: seg.startBeat, len: seg.beats * 0.95, vel: 0.55 });
      else {
        groups.forEach((g, i) => hits.push({ beat: g.start, len: g.len * 0.9, vel: i === 0 ? 0.62 : 0.5 }));
        if (style === 'skips') groups.filter((g) => g.slots === 3).forEach((g) => hits.push({ beat: g.start + 2 * meter.slotLen, len: 0.4, vel: 0.45 }));
      }
      state.voicing = placeVoicing(voicingPcs(seg.chord, 'block'), state.voicing, { lo: 50, hi: 70, center: 60, maxSpan: 14 });
    } else {
      const style = rng.weighted([['chug', 5], ['groups', 3], ['push', 2]]);
      if (style === 'chug') {
        slots.forEach((s) => hits.push({ beat: s.start, len: 0.4, vel: s.posInGroup === 0 ? 0.78 : 0.6, muted: true }));
      } else {
        groups.forEach((g) => hits.push({ beat: g.start, len: g.len * 0.95, vel: 0.74, full: true }));
        if (style === 'push') hits.push({ beat: end - meter.slotLen, len: 0.4, vel: 0.68, full: true });
      }
    }

    for (const h of hits) {
      if (h.beat >= end - 1e-9) continue;
      const len = capDur(h.len, h.beat, end);
      const vel = h.vel * (0.95 + rng.next() * 0.1);
      const notes = flavor === 'rock'
        ? guitarChord(seg.chord, { full: Boolean(h.full) && seg.beats >= 1 })
        : state.voicing;
      notes.forEach((midi, i) => {
        ev.push(note('chords', midi, h.beat, len, vel, {
          dt: flavor === 'rock' ? i * (h.muted ? 0.002 : 0.011) : i * (flavor === 'jazz' ? 0.004 : 0.003),
          art: h.muted ? 'mute' : undefined,
        }));
      });
    }
  }
  return ev;
}
