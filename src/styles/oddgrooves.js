// Drum grooves for 6/8, 7/8 and 10/8, built from the meter's groups (3+3, 3+2+2, 3+3+2+2 eighths), so each one works in every
// meter it is offered in (see oddoptions.js). Each takes the bar and the style ('jazz' | 'blues' | 'rock') and returns the
// notes before crashes and fills, which drumming.js adds. Positions are in quarter notes; an eighth is 0.5. The /8 meters are
// not swung.
//
// Every groove reads the same Drums panel as the classic one: Ride and hi-hat (cymbal) thins or adds the light notes, Kick the
// pushes, Snare the extra hits, Ghost notes the quiet ones.

import { drum } from './helpers.js';
import { gain, odds } from './settings.js';

const at = (ctx, g, n) => g.start + n * ctx.meter.slotLen;
const lastOf = (ctx, g) => at(ctx, g, g.slots - 1);
/** The cymbal voice: a ride in jazz, a hi-hat elsewhere. */
const timekeeper = (flavor) => (flavor === 'jazz' ? 'ride' : 'hat');
/** Light notes between the group downbeats: none at the bottom of Cymbal, all from the middle up. */
const lightKept = (k) => Math.min(1, Math.max(0, (k.cymbal - 15) / 35));

export const ODD_GROOVES = {
  // the kick leans on the last eighth of each group, into the next downbeat; the snare (a cross-stick in jazz) answers on every other group
  pushgroups(ctx, flavor) {
    const { rng, meter } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const tk = timekeeper(flavor);
    meter.groupSpans.forEach((g, gi) => {
      for (let n = 0; n < g.slots; n++) {
        if (n > 0 && !rng.chance(lightKept(k))) continue;
        ev.push(drum(tk, at(ctx, g, n), n === 0 ? 0.7 : 0.46, 0.3));
      }
      if (gi === 0) ev.push(drum('kick', g.start, 0.86, 0.3));
      if (rng.chance(odds(0.9, k.kick))) ev.push(drum('kick', lastOf(ctx, g), 0.62, 0.25));
      if (gi % 2 === 1) ev.push(drum(flavor === 'jazz' ? 'rim' : 'snare', g.start, flavor === 'jazz' ? 0.62 : 0.9, 0.3));
      if (g.slots > 1 && rng.chance(odds(0.3, k.ghosts))) ev.push(drum('snare', at(ctx, g, 1), 0.3 + rng.next() * 0.1, 0.15));
    });
    if (rng.chance(odds(0.25, k.snare))) ev.push(drum(flavor === 'jazz' ? 'rim' : 'snare', lastOf(ctx, meter.groupSpans.at(-1)), 0.55, 0.2));
    return ev;
  },

  // half-time: one heavy snare in the middle of the bar, the kick under the first group
  halfgroups(ctx, flavor) {
    const { rng, meter } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const gs = meter.groupSpans;
    const mid = Math.floor(gs.length / 2);
    gs.forEach((g, gi) => {
      ev.push(drum('hat', g.start, 0.62, 0.3));
      for (let n = 1; n < g.slots; n++) if (rng.chance(lightKept(k) * 0.55)) ev.push(drum('hat', at(ctx, g, n), 0.4, 0.2));
      if (gi === 0) ev.push(drum('kick', g.start, 0.9, 0.3));
      if (gi === mid - 1 && rng.chance(odds(0.5, k.kick))) ev.push(drum('kick', lastOf(ctx, g), 0.6, 0.25));
      if (gi === 0 && g.slots > 2 && rng.chance(odds(0.35, k.kick))) ev.push(drum('kick', at(ctx, g, 2), 0.55, 0.25));
    });
    ev.push(drum('snare', gs[mid].start, 0.98, 0.35));
    if (rng.chance(odds(0.3, k.ghosts))) ev.push(drum('snare', lastOf(ctx, gs[mid - 1]), 0.3 + rng.next() * 0.1, 0.15));
    if (rng.chance(odds(0.2, k.snare))) ev.push(drum('snare', lastOf(ctx, gs.at(-1)), 0.6, 0.2));
    return ev;
  },

  // tribal: low and middle toms on every group, a kick on the bar line
  tomdrive(ctx) {
    const { rng, meter } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const gs = meter.groupSpans;
    gs.forEach((g, gi) => {
      ev.push(drum(gi % 2 === 0 ? 'tomLow' : 'tomMid', g.start, 0.8, 0.3));
      ev.push(drum('hat', g.start, 0.5, 0.2));
      for (let n = 1; n < g.slots; n++) if (rng.chance(lightKept(k) * 0.5)) ev.push(drum('hat', at(ctx, g, n), 0.34, 0.15));
      if (gi === 0) ev.push(drum('kick', g.start, 0.88, 0.3));
      else if (rng.chance(odds(0.35, k.kick))) ev.push(drum('kick', lastOf(ctx, g), 0.55, 0.25));
      if (g.slots > 1 && rng.chance(odds(0.3, k.ghosts))) ev.push(drum('tomMid', at(ctx, g, 1), 0.28, 0.15));
    });
    if (rng.chance(odds(0.6, k.snare))) ev.push(drum('tomHigh', lastOf(ctx, gs.at(-1)), 0.7, 0.25));
    return ev;
  },

  // a bell-like ride on each group and its last eighth, the foot on every other group
  bell(ctx) {
    const { rng, meter } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const kept = Math.min(1, gain(k.cymbal));
    meter.groupSpans.forEach((g, gi) => {
      ev.push(drum('ride', g.start, gi % 2 === 0 ? 0.72 : 0.62, 0.4));
      const second = g.slots > 2 ? 2 : 1; // the last eighth of the group
      if (rng.chance(kept)) ev.push(drum('ride', at(ctx, g, second), 0.5, 0.4));
      if (g.slots > 2 && k.cymbal > 60 && rng.chance(((k.cymbal - 60) / 40) * 0.6)) ev.push(drum('ride', at(ctx, g, 1), 0.34, 0.3));
      if (gi % 2 === 1) ev.push(drum('hatPedal', g.start, 0.45, 0.1));
      if (gi === 0) ev.push(drum('kick', g.start, 0.7, 0.3));
      else if (gi === Math.floor(meter.groupSpans.length / 2) && rng.chance(odds(0.4, k.kick))) ev.push(drum('kick', g.start, 0.55, 0.3)); // the middle group
      if (g.slots > 1 && rng.chance(odds(0.25, k.ghosts))) ev.push(drum('snare', at(ctx, g, 1), 0.28, 0.15));
    });
    if (rng.chance(odds(0.25, k.snare))) ev.push(drum('rim', lastOf(ctx, meter.groupSpans.at(-1)), 0.45, 0.15));
    return ev;
  },

  // the standard Afro-Cuban bell pattern (bembé) across two bars of 6/8: x.x.xx.x.x.x in twelve eighths
  bembe(ctx) {
    const { rng, meter, barIndex } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const bell = barIndex % 2 === 0 ? [0, 2, 4, 5] : [1, 3, 5];
    bell.forEach((n) => ev.push(drum('ride', n * meter.slotLen, n === 0 ? 0.7 : 0.58, 0.4)));
    for (let n = 0; n < 6; n++) if (!bell.includes(n) && rng.chance(lightKept(k) * 0.7)) ev.push(drum('hat', n * meter.slotLen, 0.28, 0.15));
    ev.push(drum('kick', 0, 0.78, 0.3), drum('kick', 3 * meter.slotLen, 0.6, 0.3));
    ev.push(drum('hatPedal', 3 * meter.slotLen, 0.45, 0.1));
    if (rng.chance(odds(0.25, k.snare))) ev.push(drum('rim', rng.pick([1, 4]) * meter.slotLen, 0.42, 0.15));
    if (rng.chance(odds(0.3, k.ghosts))) ev.push(drum('tomMid', 2 * meter.slotLen, 0.26, 0.2));
    if (rng.chance(odds(0.3, k.kick))) ev.push(drum('kick', 5 * meter.slotLen, 0.5, 0.25));
    return ev;
  },

  // a cross-stick on every group, a light ride on the last eighths
  rimgroups(ctx, flavor) {
    const { rng, meter } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const kept = Math.min(1, gain(k.cymbal));
    meter.groupSpans.forEach((g, gi) => {
      ev.push(drum('rim', g.start, gi === 0 ? 0.68 : 0.58, 0.15));
      if (rng.chance(kept)) ev.push(drum('ride', lastOf(ctx, g), 0.4, 0.3));
      if (gi === 0) ev.push(drum('kick', g.start, flavor === 'jazz' ? 0.3 : 0.6, 0.3));
      else if (gi === 1 && rng.chance(odds(0.35, k.kick))) ev.push(drum('kick', at(ctx, g, Math.min(2, g.slots - 1)), 0.4, 0.25));
      if (gi % 2 === 1) ev.push(drum('hatPedal', g.start, 0.42, 0.1));
      if (g.slots > 1 && rng.chance(odds(0.25, k.ghosts))) ev.push(drum('snare', at(ctx, g, 1), 0.28, 0.15));
    });
    if (rng.chance(odds(0.3, k.snare))) ev.push(drum('rim', rng.pick(meter.slots.filter((s) => s.posInGroup > 0)).start, 0.4, 0.12));
    return ev;
  },

  // a brushed train: a chugging snare on every eighth, leaning on the group downbeats
  traingroups(ctx) {
    const { rng, meter } = ctx;
    const k = ctx.kitOpts;
    const ev = [];
    const quietKept = Math.min(1, 0.55 + 0.45 * gain(k.ghosts));
    meter.groupSpans.forEach((g, gi) => {
      ev.push(drum('snare', g.start, gi % 2 === 1 ? 0.86 : 0.62, 0.25));
      for (let n = 1; n < g.slots; n++) if (rng.chance(quietKept)) ev.push(drum('snare', at(ctx, g, n), 0.34, 0.2));
      if (gi === 0) ev.push(drum('kick', g.start, 0.74, 0.3));
      if (gi % 2 === 1) ev.push(drum('hatPedal', g.start, 0.44, 0.1));
      if (k.cymbal > 50) for (let n = 0; n < g.slots; n++) if (rng.chance(((k.cymbal - 50) / 50) * 0.7)) ev.push(drum('hat', at(ctx, g, n), 0.3, 0.15));
    });
    if (rng.chance(odds(0.3, k.kick))) ev.push(drum('kick', lastOf(ctx, meter.groupSpans.at(-1)), 0.5, 0.25));
    if (rng.chance(odds(0.3, k.snare))) ev.push(drum('snare', lastOf(ctx, meter.groupSpans.at(-1)), 0.7, 0.2));
    return ev;
  },
};
