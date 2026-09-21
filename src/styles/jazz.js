// Jazz: medium swing. Ride cymbal, feathered kick, walking bass, rootless piano comping.

import { placeVoicing, voicingPcs } from '../engine/voicing.js';
import { capDur, drum, note, walkSegment } from './helpers.js';
import { oddBass, oddChords, oddDrums } from './oddMeters.js';

// Comping rhythms per segment length: [startBeat, length, velocity]. Straight-grid positions;
// the style's swing re-times the "ands".
const COMP = {
  4: [
    [[0, 1.4, 0.74], [1.5, 0.5, 0.6]],                    // Charleston
    [[0.5, 0.5, 0.64], [2.5, 0.5, 0.66]],                 // "and of 1", "and of 3"
    [[1.5, 0.5, 0.62], [3, 0.8, 0.66]],                   // "and of 2", 4
    [[0, 2.4, 0.7], [2.5, 0.5, 0.58]],                    // long chord, late push
    [[1, 0.8, 0.64], [3, 0.8, 0.64]],                     // 2 and 4
    [[0, 0.6, 0.7], [1.5, 0.5, 0.6], [3.5, 0.4, 0.62]],   // busier
  ],
  2: [
    [[0, 1.4, 0.72]],
    [[0.5, 0.5, 0.64], [1.5, 0.4, 0.58]],
    [[0, 0.7, 0.7], [1.5, 0.4, 0.58]],
  ],
  1: [[[0, 0.8, 0.7]]],
  3: [[[0, 1.6, 0.72], [2, 0.8, 0.6]], [[0.5, 0.5, 0.64], [2, 0.8, 0.62]]],
};

const swingAt = (bpm) => Math.min(0.667, Math.max(0.56, 0.667 - (bpm - 120) * 0.0011));

function drums(ctx) {
  if (ctx.meter.id !== '4/4') return oddDrums(ctx, 'jazz');
  const { rng, isLastBar, isFirstBar, chorus, barIndex } = ctx;
  const ev = [];

  // ride: "spang-a-lang"
  for (const [b, v] of [[0, 0.6], [1, 0.76], [1.5, 0.48], [2, 0.6], [3, 0.76], [3.5, 0.48]]) {
    if (b % 1 !== 0 && rng.chance(0.08)) continue; // now and then, leave a skip note out
    ev.push(drum('ride', b, v, 0.5));
  }
  // hi-hat foot on 2 and 4, feathered kick on every beat
  ev.push(drum('hatPedal', 1, 0.5, 0.1), drum('hatPedal', 3, 0.5, 0.1));
  for (let b = 0; b < 4; b++) ev.push(drum('kick', b, 0.16 + rng.next() * 0.06, 0.2));

  // comping: ghost snares and the occasional bomb
  let used = 0;
  for (const [b, p] of [[0.5, 0.08], [1.5, 0.16], [2.5, 0.12], [3.5, 0.16]]) {
    if (used < 2 && rng.chance(p)) { ev.push(drum('snare', b, 0.28 + rng.next() * 0.2, 0.2)); used++; }
  }
  if (rng.chance(0.1)) ev.push(drum('kick', rng.chance(0.5) ? 2.5 : 0.5, 0.55, 0.2));

  if (isFirstBar && chorus > 1 && rng.chance(0.6)) ev.push(drum('crash', 0, 0.5, 1));

  // fills: at the end of the chorus, and now and then every fourth bar
  if ((isLastBar && rng.chance(0.55)) || (barIndex % 4 === 3 && rng.chance(0.18))) {
    if (rng.chance(0.5)) {
      ev.push(drum('snare', 2.5, 0.5), drum('snare', 3, 0.6), drum('snare', 3.5, 0.72), drum('kick', 3.5, 0.6));
    } else {
      ev.push(drum('snare', 3, 0.55), drum('tomMid', 3.5, 0.6), drum('tomLow', 3.75, 0.66), drum('kick', 3, 0.5));
    }
  }
  return ev;
}

function bass(ctx) {
  if (ctx.meter.id !== '4/4') return oddBass(ctx, 'jazz');
  const { segments, nextChord, state, rng } = ctx;
  const ev = [];
  segments.forEach((seg, k) => {
    if (!seg.chord) return;
    const nextSeg = segments[k + 1];
    const nextChordHere = nextSeg ? nextSeg.chord : nextChord;
    const nextRoot = nextChordHere ? (nextChordHere.bass ?? nextChordHere.root) : null;
    for (const n of walkSegment(seg, nextRoot, state, rng)) {
      const accent = n.beat % 2 === 1 ? 0.78 : 0.72;
      ev.push(note('bass', n.midi, n.beat, 0.92, accent));
    }
  });
  return ev;
}

function chords(ctx) {
  if (ctx.meter.id !== '4/4') return oddChords(ctx, 'jazz');
  const { segments, state, rng } = ctx;
  const ev = [];
  for (const seg of segments) {
    if (!seg.chord) continue;
    const table = COMP[seg.beats] ?? COMP[seg.beats >= 4 ? 4 : 1];
    const pattern = rng.pick(table);
    state.voicing = placeVoicing(voicingPcs(seg.chord, 'rootless'), state.voicing, { lo: 52, hi: 72, center: 62 });
    const end = seg.startBeat + seg.beats;
    for (const [b, len, vel] of pattern) {
      const beat = seg.startBeat + b;
      if (beat >= end) continue;
      state.voicing.forEach((midi, i) => {
        ev.push(note('chords', midi, beat, capDur(len, beat, end), vel * (0.95 + rng.next() * 0.1), { dt: i * 0.004 }));
      });
    }
  }
  return ev;
}

export const jazz = {
  id: 'jazz',
  name: 'Jazz',
  description: 'Medium swing. Ride cymbal, walking bass and rootless piano comping.',
  defaultTempo: 132,
  timeSignatures: ['4/4', '6/8', '7/8', '10/8'],
  feel: { name: 'swing', swing: swingAt },
  humanize: {
    drums: { t: 0.004, v: 0.1, lay: 0.003 },
    bass: { t: 0.003, v: 0.06 },
    chords: { t: 0.008, v: 0.1, lay: 0.004 },
  },
  timbres: { bass: 'upright', chords: 'piano', drums: 'jazz' },
  parts: { drums, bass, chords },
};
