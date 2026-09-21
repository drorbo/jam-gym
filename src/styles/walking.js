// Walking bass: how a line is chosen for each chord.
//
// A player builds a walking line in layers, and so does this module:
//
//   1. Rhythm. Which beats get a note: steady quarters, quarters with swung "skips" (ghost notes and passing
//      eighths), running eighths, or a two-feel of half notes. (`planSlots`, `planOddSlots`)
//   2. Skeleton. Beat one is the chord's root (or its slash bass). The last note leads into the next chord, and
//      that note is chosen first: a half step from above or below, a scale step, the fifth above (as if the next
//      chord were the tonic), or two notes that enclose the target from both sides. (`planApproach`)
//   3. Fill. The notes in between are found by a beam search that scores every candidate: strong beats want chord
//      tones, weak beats can pass through scale tones and (with a little courage) chromatic ones, small steps and
//      chord-tone leaps are traded off by the Line setting, colour tones (9ths, 13ths, #11...) come in with the
//      Tension setting, direction keeps going, big leaps recover, and the same shape is not repeated bar after bar.
//      A little seeded noise picks between near-equal lines, so every chorus differs but a seed replays exactly.
//   4. Ornaments (when the rhythm asks for them): a ghost note or a passing tone on the swung "and" after a beat.
//
// This file knows nothing about audio or the DOM. It returns note events like the rest of the styles do.

import { mod12, nearestMidi } from '../theory/notes.js';
import { bassPc, scaleIntervals } from './helpers.js';

export const LO = 28; // E1, the low string of a bass
export const HI = 52; // E3
const CENTER = 39;
const BEAM = 36;

// ---- settings ----------------------------------------------------------------------------

export const RHYTHMS = [
  { id: 'quarters', name: 'Steady quarters', hint: 'one note on every beat' },
  { id: 'skips', name: 'Quarters with skips', hint: 'quarter notes with swung ghost notes and passing tones' },
  { id: 'eighths', name: 'Running eighths', hint: 'a line of eighth notes' },
  { id: 'two', name: 'Two-feel', hint: 'half notes on roots and fifths' },
  { id: 'mixed', name: 'Mixed', hint: 'mostly quarters, with skips, runs of eighths and two-feel bars now and then' },
];

export const APPROACHES = [
  { id: 'mixed', name: 'Mixed', short: 'varied approaches', hint: 'a bit of everything' },
  { id: 'chromatic', name: 'Half step', short: 'half-step approaches', hint: 'a half step from below or above the next root' },
  { id: 'step', name: 'Scale step', short: 'scale-step approaches', hint: 'a whole step from below or above the next root' },
  { id: 'fifth', name: 'From the fifth', short: 'approaches from the fifth', hint: 'the fifth above the next root, as if it were a V chord' },
  { id: 'enclosure', name: 'Enclosure', short: 'enclosures', hint: 'a note above, then a note below, landing on the next root' },
];

export const PATTERNS = [
  { id: 'mixed', name: 'Boogie, walking at turnarounds', hint: 'the eighth-note boogie, walking into each chord change and at the end of the chorus' },
  { id: 'walk', name: 'Walking throughout', hint: 'a walking line for the whole chorus' },
  { id: 'boogie', name: 'Boogie throughout', hint: 'the eighth-note boogie the whole way' },
];

export const DEFAULT_BASS = Object.freeze({ rhythm: 'quarters', line: 40, tension: 25, approach: 'mixed', pattern: 'mixed' });

const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);
const oneOf = (v, list, fallback) => (list.some((x) => x.id === v) ? v : fallback);

/** Merge untrusted bass settings over a base (a style's defaults), keeping only valid values. */
export function sanitizeBass(raw, base = DEFAULT_BASS) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    rhythm: oneOf(r.rhythm, RHYTHMS, base.rhythm),
    line: clamp(r.line, 0, 100, base.line),
    tension: clamp(r.tension, 0, 100, base.tension),
    approach: oneOf(r.approach, APPROACHES, base.approach),
    pattern: oneOf(r.pattern, PATTERNS, base.pattern),
  };
}

/** Plain-English summary of the settings, for the panel's one-line readout. */
export function describeBass(o, { blues = false } = {}) {
  if (blues && o.pattern === 'boogie') return 'Boogie throughout';
  const rhythm = RHYTHMS.find((r) => r.id === o.rhythm)?.name ?? '';
  const line = o.line < 20 ? 'scales' : o.line < 45 ? 'mostly scales' : o.line < 65 ? 'scales and arpeggios' : o.line < 85 ? 'mostly arpeggios' : 'arpeggios';
  const colour = o.tension < 15 ? 'chord tones' : o.tension < 40 ? 'a few colour tones' : o.tension < 70 ? 'colour tones' : 'lots of colour';
  const approach = APPROACHES.find((a) => a.id === o.approach)?.short ?? '';
  const lead = blues && o.pattern === 'mixed' ? 'Boogie, walking at turnarounds' : rhythm;
  return `${lead} · ${line} · ${colour} · ${approach}`;
}

// ---- what the chord offers ---------------------------------------------------------------

/**
 * Sort the twelve intervals above a chord's root into: chord tones (0), colour tones (1), other scale tones (2) and
 * chromatic notes (3). `colour` is what Tension unlocks on strong beats: the 9th, 13th, #11 and any written extension.
 */
export function analyseChord(chord, flavor = 'jazz', tension = 0.25) {
  const chordTones = new Set([0, mod12(chord.fifth ?? 7)]);
  if (chord.third !== null) chordTones.add(chord.third);
  if (chord.seventh !== null) chordTones.add(chord.seventh);
  if (chord.sixth) chordTones.add(9);

  const scale = new Set(scaleIntervals(chord).map(mod12));
  const colour = new Set();
  const addColour = (...xs) => xs.forEach((x) => { const r = mod12(x); if (!chordTones.has(r)) colour.add(r); });
  for (const e of [chord.ninth, chord.eleventh, chord.thirteenth]) if (e !== null && e !== undefined) addColour(e);

  switch (chord.family) {
    case 'major': addColour(2, 9); if (tension >= 0.6) addColour(6); break;
    case 'minor': addColour(2, 5, 9); break;
    case 'dominant': addColour(2, 9); if (tension >= 0.6) addColour(6); break;
    case 'halfdim': addColour(5, 8); if (tension >= 0.6) addColour(2); break;
    case 'dim': addColour(2, 5, 8, 11); break;
    case 'aug': addColour(2, 6); break;
    default: addColour(2, 9);
  }
  if (flavor === 'blues' && ['dominant', 'major', 'minor'].includes(chord.family)) {
    // the boogie tones (6th and flat 7th) are chord tones in the blues, and the blue notes pass through
    chordTones.add(9);
    chordTones.add(10);
    colour.delete(9);
    colour.delete(10);
    addColour(2, 5);
    scale.add(3);
    scale.add(6);
  }
  for (const c of colour) scale.add(c);
  for (const c of chordTones) scale.add(c);

  const category = (rel) => (chordTones.has(rel) ? 0 : colour.has(rel) ? 1 : scale.has(rel) ? 2 : 3);
  return { chordTones, colour, scale, category };
}

// ---- rhythm --------------------------------------------------------------------------------

/** How often each rhythm is used when the setting is "Mixed". Eighths need a tempo that can carry them. */
function pickMixedMode(rng, { beats, bpm, flavor, isLastBar }) {
  return rng.weighted([
    ['quarters', 62],
    ['skips', 22],
    ['eighths', beats >= 4 && bpm <= 170 && flavor === 'jazz' ? 9 : 0],
    ['two', beats >= 4 && flavor === 'jazz' && !isLastBar ? 7 : 0],
  ]);
}

/**
 * The notes' positions for one chord in 4/4.
 * @returns {{slots:{beat:number, dur:number, strength:1|2|3, pref?:Function, rest?:boolean}[], offs:{beat:number, owner:number}[], mode:string}}
 */
export function planSlots(seg, mode, rng, { bpm = 120, flavor = 'jazz', isLastBar = false, hasTarget = true } = {}) {
  const s = seg.startBeat;
  const n = Math.max(1, Math.round(seg.beats));
  const chosen = mode === 'mixed' ? pickMixedMode(rng, { beats: n, bpm, flavor, isLastBar }) : mode;
  const strengthOn = (bb) => (bb % 2 === 0 ? 3 : bb % 1 === 0 ? 2 : 1);
  const slots = [];
  const offs = [];

  if (chosen === 'two' && n >= 3) {
    // half notes on the roots and fifths; sometimes the last beat walks into the next chord
    const withWalk = n >= 4 && hasTarget && rng.chance(0.3);
    slots.push({ beat: s, dur: withWalk ? 1.9 : Math.min(n, 2) * 0.93, strength: 3 });
    slots.push({
      beat: s + 2, dur: withWalk ? 0.93 : (n - 2) * 0.93, strength: 3,
      pref: (rel, info) => (rel === 0 ? 0.3 : info.fifth === rel ? -0.7 : info.third === rel ? 0.5 : 4),
    });
    if (withWalk) slots.push({ beat: s + 3, dur: 0.93, strength: 2 });
    // without the walking last beat, the fifth on beat three is a note in its own right, not an approach
    return { slots, offs, mode: 'two', noApproach: !withWalk };
  }
  if (chosen === 'eighths' && n >= 1) {
    for (let i = 0; i < n * 2; i++) {
      const bb = s + i / 2;
      slots.push({ beat: bb, dur: 0.47, strength: strengthOn(bb) });
    }
    // breathe: turn a weak "and" into a held note now and then
    let rests = 0;
    for (let i = 1; i < slots.length - 2; i++) {
      if (slots[i].strength === 1 && rests < 2 && !slots[i - 1].rest && rng.chance(0.1)) { slots[i].rest = true; rests++; }
    }
    return { slots, offs, mode: 'eighths' };
  }
  for (let i = 0; i < n; i++) {
    slots.push({ beat: s + i, dur: 0.93, strength: strengthOn(s + i) });
    offs.push({ beat: s + i + 0.5, owner: i });
  }
  return { slots, offs: chosen === 'skips' ? offs : [], mode: chosen === 'skips' ? 'skips' : 'quarters' };
}

/**
 * The same, for the /8 meters: one note per group, or one per eighth for "eighths". `groups` are the group spans
 * that start inside the chord, clipped to it.
 */
export function planOddSlots(meter, groups, mode, rng) {
  const chosen = mode === 'mixed' ? rng.weighted([['quarters', 70], ['skips', 20], ['eighths', 10]]) : mode;
  const slots = [];
  const offs = [];
  if (chosen === 'eighths') {
    for (const g of groups) {
      for (let k = 0; k < Math.min(g.slots, Math.round(g.len / meter.slotLen)); k++) {
        slots.push({ beat: g.start + k * meter.slotLen, dur: meter.slotLen * 0.94, strength: k === 0 ? (g === groups[0] ? 3 : 2) : 1 });
      }
    }
    return { slots, offs, mode: 'eighths' };
  }
  groups.forEach((g, i) => {
    slots.push({ beat: g.start, dur: g.len * 0.93, strength: i === 0 ? 3 : 2 });
    if (g.len >= 2 * meter.slotLen - 1e-9) offs.push({ beat: g.start + (Math.round(g.len / meter.slotLen) - 1) * meter.slotLen, owner: i });
  });
  return { slots, offs: chosen === 'skips' ? offs : [], mode: chosen === 'skips' ? 'skips' : 'quarters' };
}

// ---- the approach into the next chord ------------------------------------------------------

/**
 * Pitch classes for the last one or two notes, leading into the next chord's root.
 * @returns {number[]} empty when the chord is too short to approach anything
 */
export function planApproach({ mode, targetPc, chord, count, prevMidi, rng }) {
  if (count < 2) return [];
  if (targetPc === null) return [mod12(chord.root + (chord.fifth ?? 7))]; // nowhere to go: settle on the fifth
  const above = (k) => mod12(targetPc + k);
  const below = (k) => mod12(targetPc - k);
  // between two options, usually take the one nearer to where the line is now
  const closer = (x, y) => {
    const dx = Math.abs(nearestMidi(x, prevMidi, LO, HI) - prevMidi);
    const dy = Math.abs(nearestMidi(y, prevMidi, LO, HI) - prevMidi);
    const [first, second] = dx <= dy ? [x, y] : [y, x];
    return rng.chance(0.72) ? first : second;
  };
  let kind = mode;
  if (mode === 'mixed') {
    kind = rng.weighted([['chromatic', 5], ['step', 1.4], ['fifth', 1.6], ['enclosure', count >= 4 ? 1.4 : 0], ['double', count >= 4 ? 0.8 : 0]]);
  }
  if ((kind === 'enclosure' || kind === 'double') && count < 4) kind = 'chromatic';
  switch (kind) {
    case 'step': return [closer(above(2), below(2))];
    case 'fifth': return [above(7)];
    case 'enclosure': return [above(rng.chance(0.7) ? 2 : 1), below(1)];
    case 'double': return rng.chance(0.5) ? [below(2), below(1)] : [above(2), above(1)];
    default: return [closer(above(1), below(1))];
  }
}

// ---- the search ---------------------------------------------------------------------------

/** Cost of moving `d` semitones. Steps are cheap for scale lines, thirds and fifths for arpeggios (a: 0 to 1). */
function moveCost(d, a) {
  if (d === 0) return 3.2;
  if (d <= 2) return 0.9 * a;
  if (d <= 4) return 0.1 + 0.9 * (1 - a);
  if (d <= 7) return 0.4 + 1.3 * (1 - a);
  if (d <= 9) return 2.4 - 0.6 * a;
  if (d <= 12) return 3.2 - 0.8 * a;
  return 9;
}

/** Cost of a note by its category (0 chord tone, 1 colour, 2 scale, 3 chromatic) on a strong, medium or weak beat. */
function toneCost(cat, strength, T, a) {
  let c;
  if (strength === 3) c = [0, 2.4 * (1 - T) + 0.3, 3.4, 6][cat];
  else if (strength === 2) c = [0, 1.1 * (1 - T) + 0.15, 0.6, 2.6 - 1.2 * T][cat];
  else c = [0.15, 0.4 * (1 - T) + 0.05, 0, 1.3 - 0.7 * T][cat];
  if (strength < 3) {
    // arpeggio lines lean on chord tones everywhere; scale lines are happy on scale tones
    if (cat === 0) c -= 0.7 * a;
    else if (cat === 2) c += 0.5 * a - 0.25 * (1 - a);
    else if (cat === 1) c += 0.2 * a;
  }
  return c;
}

/**
 * Choose the pitches for a run of slots. Slot 0 and any approach slots have their pitch class fixed; the rest are free.
 * @param {{strength:number, pcs:number[]|null, pref?:Function}[]} specs
 * @returns {{midis:number[], cost:number}[]} the best few lines, best first
 */
function search({ specs, info, chord, prev, prev2, dir, T, a, rng, sigPenalty }) {
  const noise = specs.map(() => Array.from({ length: HI - LO + 1 }, () => rng.next() * 0.9));
  const fifth = mod12(chord.fifth ?? 7);
  let beam = [{ midis: [], cost: 0, p: prev, pp: prev2 }];

  specs.forEach((spec, i) => {
    const cands = [];
    for (let m = LO; m <= HI; m++) if (!spec.pcs || spec.pcs.includes(mod12(m))) cands.push(m);
    const node = new Map();
    for (const m of cands) {
      const rel = mod12(m - chord.root);
      let c = noise[i][m - LO];
      if (!spec.pcs) {
        c += toneCost(info.category(rel), spec.strength, T, a);
        if (spec.pref) c += spec.pref(rel, { fifth, third: chord.third });
      }
      node.set(m, c);
    }
    const next = [];
    for (const path of beam) {
      for (const m of cands) {
        const d = Math.abs(m - path.p);
        const s = Math.sign(m - path.p);
        const ps = Math.sign(path.p - path.pp);
        let c = path.cost + node.get(m) + moveCost(d, a);
        if (s !== 0) c += s === dir ? -0.3 : 0.15;
        if (s !== 0 && ps !== 0 && s !== ps && Math.abs(path.p - path.pp) <= 2 && d <= 2) c += 0.45; // wobbling
        if (Math.abs(path.p - path.pp) >= 5) {
          if (s === ps) c += 1.3; // after a leap, turn back
          if (d >= 5) c += 1.2;
        }
        // a chromatic note has to resolve by half step in the direction it was heading
        if (i > 0 && info.category(mod12(path.p - chord.root)) === 3 && !spec.pcs && !(d === 1 && s === ps)) c += 2.2;
        c += 0.07 * Math.max(0, Math.abs(m - CENTER) - 8) + (m < LO + 1 || m > HI - 1 ? 0.8 : 0);
        next.push({ midis: [...path.midis, m], cost: c, p: m, pp: path.p });
      }
    }
    next.sort((x, y) => x.cost - y.cost);
    beam = next.slice(0, BEAM);
  });

  return beam
    .map((p) => ({ midis: p.midis, cost: p.cost + (sigPenalty(p.midis) ? 2.5 : 0) }))
    .sort((x, y) => x.cost - y.cost)
    .slice(0, 5);
}

const signature = (midis) => midis.slice(1).map((m, i) => m - midis[i]).join(',');

// ---- one chord ----------------------------------------------------------------------------

/**
 * A walking line for one chord.
 * @param {Object} o
 * @param {import('../theory/chord.js').Chord} o.chord
 * @param {import('../theory/chord.js').Chord|null} o.upcoming the chord this one leads into (null: none)
 * @param {{slots:object[], offs:object[], mode:string}} o.plan from planSlots / planOddSlots
 * @param {object} o.state per-run memory: state.bass (last pitch), state.bass2, state.dir, state.walkSig
 * @param {{rhythm:string,line:number,tension:number,approach:string}} o.opts
 * @returns {{beat:number, midi:number, dur:number, vel:number, ghost?:boolean}[]}
 */
export function walkChord({ chord, upcoming, plan, state, rng, opts, flavor = 'jazz' }) {
  const { slots, offs } = plan;
  const T = opts.tension / 100;
  const a = opts.line / 100;
  const info = analyseChord(chord, flavor, T);
  const prev = state.bass ?? CENTER;
  const prev2 = state.bass2 ?? prev;
  const n = slots.length;

  // which way this bar heads: away from the edges, otherwise a coin flip that favours turning around
  let dir = state.dir ?? 1;
  if (prev > CENTER + 6) dir = -1;
  else if (prev < CENTER - 6) dir = 1;
  else if (rng.chance(0.55)) dir = -dir;

  const targetPc = upcoming ? bassPc(upcoming) : null;
  const tail = plan.noApproach ? [] : planApproach({ mode: opts.approach, targetPc, chord, count: n, prevMidi: prev, rng });
  const specs = slots.map((s) => ({ strength: s.strength, pcs: null, pref: s.pref }));
  specs[0].pcs = [bassPc(chord)];
  specs[0].strength = 3;
  tail.forEach((pc, j) => { specs[n - tail.length + j].pcs = [pc]; });

  const lines = search({
    specs, info, chord, prev, prev2, dir, T, a, rng,
    sigPenalty: (midis) => signature(midis) === state.walkSig,
  });
  // usually the best line, sometimes a near-equal one
  const best = lines[0].cost;
  const midis = rng.weighted(lines.map((l) => [l.midis, Math.exp(-(l.cost - best) / 0.55)]));

  const isBlues = flavor === 'blues';
  const notes = slots.map((s, i) => ({
    beat: s.beat,
    midi: midis[i],
    dur: s.dur,
    vel: isBlues ? 0.78 : s.strength === 3 ? 0.74 : 0.78,
    rest: s.rest,
  }));

  // a held note where a weak "and" was left out
  for (let i = notes.length - 1; i > 0; i--) if (notes[i].rest) notes[i - 1].dur += 0.5;
  const played = notes.filter((x) => !x.rest).map(({ rest, ...x }) => x);

  if (plan.mode === 'skips') addOrnaments({ played, offs: offs.filter((o) => !slots[o.owner].rest), tail: tail.length, targetPc, info, chord, rng });

  state.bass2 = played.length > 1 ? played[played.length - 2].midi : state.bass ?? prev;
  state.bass = played[played.length - 1].midi;
  state.dir = Math.sign(state.bass - state.bass2) || dir;
  state.walkSig = signature(midis);
  return played;
}

/** Ghost notes and passing tones on the swung "and" after a beat: the skips that make a line swing. */
function addOrnaments({ played, offs, tail, targetPc, info, chord, rng }) {
  let added = 0;
  const extra = [];
  for (const off of rng.shuffle(offs)) {
    if (added >= 2) break;
    const owner = played[off.owner];
    if (!owner) continue;
    const next = played[off.owner + 1];
    const isLast = !next;
    if (isLast) {
      // an enclosure's second half: the other side of the target, tucked in after the approach note
      if (tail !== 1 || targetPc === null || !rng.chance(0.14)) continue;
      const side = mod12(owner.midi - targetPc);
      if (side !== 1 && side !== 11) continue; // only a half-step approach has an obvious other side
      owner.dur = 0.5;
      extra.push({ beat: off.beat, midi: nearestMidi(mod12(targetPc + (side === 1 ? -1 : 1)), owner.midi, LO, HI), dur: 0.4, vel: 0.6 });
      added++;
      continue;
    }
    if (!rng.chance(0.22)) continue;
    const gap = Math.abs(next.midi - owner.midi);
    let ornament = null;
    if (gap >= 3 && rng.chance(0.45)) {
      const lo = Math.min(owner.midi, next.midi);
      const hi = Math.max(owner.midi, next.midi);
      const mid = (lo + hi) / 2;
      let best = null;
      for (let m = lo + 1; m < hi; m++) {
        if (info.category(mod12(m - chord.root)) > 2) continue;
        if (best === null || Math.abs(m - mid) < Math.abs(best - mid)) best = m;
      }
      if (best !== null) ornament = { beat: off.beat, midi: best, dur: 0.4, vel: 0.55 };
    }
    ornament ??= { beat: off.beat, midi: owner.midi, dur: 0.14, vel: 0.3 + rng.next() * 0.08, ghost: true };
    owner.dur = 0.5;
    extra.push(ornament);
    added++;
  }
  played.push(...extra);
  played.sort((x, y) => x.beat - y.beat);
}

// ---- a whole bar --------------------------------------------------------------------------

/**
 * Walking bass events for one bar in 4/4.
 * @param {import('./index.js').BarContext & {bassOpts:object}} ctx
 * @param {'jazz'|'blues'} flavor
 */
export function walkBar(ctx, flavor = 'jazz') {
  const { segments, nextChord, state, rng, bpm, isLastBar } = ctx;
  const opts = ctx.bassOpts;
  const out = [];
  segments.forEach((seg, k) => {
    if (!seg.chord) return;
    const upcoming = segments[k + 1] ? segments[k + 1].chord : nextChord;
    const plan = planSlots(seg, opts.rhythm, rng, { bpm, flavor, isLastBar, hasTarget: Boolean(upcoming) });
    for (const n of walkChord({ chord: seg.chord, upcoming, plan, state, rng, opts, flavor })) {
      out.push({ inst: 'bass', midi: n.midi, beat: n.beat, dur: n.dur, vel: n.vel, ...(n.ghost ? { ghost: true } : {}) });
    }
  });
  return out;
}

/** Walking bass events for one bar in a /8 meter: a line per chord, one note per group (or per eighth). */
export function walkOddBar(ctx, flavor = 'jazz') {
  const { meter, segments, nextChord, state, rng } = ctx;
  const opts = ctx.bassOpts;
  const out = [];
  segments.forEach((seg, k) => {
    if (!seg.chord) return;
    const upcoming = segments[k + 1] ? segments[k + 1].chord : nextChord;
    const groups = meter.groupSpans
      .filter((g) => g.start >= seg.startBeat - 1e-9 && g.start < seg.startBeat + seg.beats - 1e-9)
      .map((g) => ({ ...g, len: Math.min(g.len, seg.startBeat + seg.beats - g.start) }));
    if (!groups.length) return;
    // two-feel has no meaning here (the groups are the beats), so it walks like quarters
    const mode = opts.rhythm === 'two' ? 'quarters' : opts.rhythm;
    const plan = planOddSlots(meter, groups, mode, rng);
    for (const n of walkChord({ chord: seg.chord, upcoming, plan, state, rng, opts, flavor })) {
      out.push({ inst: 'bass', midi: n.midi, beat: n.beat, dur: n.dur, vel: n.vel, ...(n.ghost ? { ghost: true } : {}) });
    }
  });
  return out;
}
