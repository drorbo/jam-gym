// Rock: straight eighths. Backbeat drums, driving root bass, power-chord guitar.

import { guitarChord } from '../engine/voicing.js';
import { mod12 } from '../theory/notes.js';
import { bassPc, capDur, drum, note } from './helpers.js';
import { oddBass, oddChords, oddDrums } from './oddMeters.js';

const KICKS = [[0, 2], [0, 0.5, 2], [0, 2, 2.5], [0, 1.5, 2]];

// Bass patterns in beats within a segment; `o` marks an octave-up note.
const BASS = {
  eighths: Array.from({ length: 8 }, (_, i) => ({ b: i / 2 })),
  octaves: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b, i) => ({ b, o: i % 4 === 2 })),
  push: [0, 1, 2, 2.5, 3, 3.5].map((b) => ({ b })),
};

// Guitar parts: [startBeat, length, velocity, full?, muted?]
const GUITAR = {
  chug: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b) => [b, 0.4, b % 1 === 0 ? 0.78 : 0.6, false, true]),
  quarters: [0, 1, 2, 3].map((b) => [b, 0.95, 0.74, true, false]),
  stabs: [[0, 1.4, 0.8, true, false], [1.5, 0.4, 0.68, true, false], [2.5, 1.4, 0.76, true, false]],
  open: [[0, 3.9, 0.7, true, false]],
};

function drums(ctx) {
  if (ctx.meter.id !== '4/4') return oddDrums(ctx, 'rock');
  const { rng, isLastBar, isFirstBar, barIndex } = ctx;
  const ev = [];
  const openHat = rng.chance(0.15);

  for (let i = 0; i < 8; i++) {
    const b = i / 2;
    if (openHat && b === 3.5) ev.push(drum('hatOpen', b, 0.6, 0.5));
    else ev.push(drum('hat', b, i % 2 === 0 ? 0.7 : 0.5, 0.2));
  }
  const kicks = rng.chance(0.55) ? KICKS[0] : rng.pick(KICKS);
  kicks.forEach((b) => ev.push(drum('kick', b, 0.88, 0.25)));
  ev.push(drum('snare', 1, 0.94, 0.3), drum('snare', 3, 0.96, 0.3));
  // ghost notes a sixteenth before a backbeat, and now and then a second hit after beat 4
  for (const b of [0.75, 2.75]) if (rng.chance(0.3)) ev.push(drum('snare', b, 0.3 + rng.next() * 0.12, 0.15));
  if (rng.chance(0.22)) ev.push(drum('snare', 3.5, 0.62 + rng.next() * 0.1, 0.2));
  if (isFirstBar) ev.push(drum('crash', 0, 0.7, 1.5));

  if ((isLastBar && rng.chance(0.75)) || (barIndex % 4 === 3 && rng.chance(0.22))) {
    ev.push(
      drum('snare', 3, 0.78, 0.2), drum('snare', 3.25, 0.74, 0.2),
      drum('tomMid', 3.5, 0.76, 0.2), drum('tomLow', 3.75, 0.82, 0.2),
    );
  }
  return ev;
}

function bass(ctx) {
  if (ctx.meter.id !== '4/4') return oddBass(ctx, 'rock');
  const { segments, state, rng, barIndex } = ctx;
  const ev = [];
  const pattern = BASS[barIndex % 4 === 3 ? 'push' : rng.weighted([['eighths', 5], ['octaves', 3], ['push', 2]])];
  for (const seg of segments) {
    if (!seg.chord) continue;
    const root = 28 + mod12(bassPc(seg.chord) - 28);
    for (const step of pattern) {
      if (step.b >= seg.beats) continue;
      const midi = root + (step.o ? 12 : 0);
      ev.push(note('bass', midi, seg.startBeat + step.b, 0.42, step.b % 1 === 0 ? 0.82 : 0.68));
      state.bass = midi;
    }
  }
  return ev;
}

function chords(ctx) {
  if (ctx.meter.id !== '4/4') return oddChords(ctx, 'rock');
  const { segments, rng, barIndex } = ctx;
  const ev = [];
  const name = barIndex % 4 === 3
    ? 'stabs'
    : rng.weighted([['chug', 5], ['quarters', 2], ['stabs', 2], ['open', 1]]);
  for (const seg of segments) {
    if (!seg.chord) continue;
    const end = seg.startBeat + seg.beats;
    const power = guitarChord(seg.chord, { full: false });
    const full = guitarChord(seg.chord, { full: true });
    for (const [b, len, vel, isFull, muted] of GUITAR[name]) {
      const beat = seg.startBeat + b;
      if (beat >= end) continue;
      const notes = isFull && seg.beats >= 2 ? full : power;
      notes.forEach((midi, i) => {
        ev.push(note('chords', midi, beat, capDur(len, beat, end), vel * (0.95 + rng.next() * 0.1), {
          dt: i * (muted ? 0.002 : 0.011),
          art: muted ? 'mute' : undefined,
        }));
      });
    }
  }
  return ev;
}

export const rock = {
  id: 'rock',
  name: 'Rock',
  description: 'Straight eighths. Backbeat drums, driving bass and power-chord guitar.',
  defaultTempo: 120,
  timeSignatures: ['4/4', '6/8', '7/8', '10/8'],
  feel: { name: 'straight', swing: 0.5 },
  humanize: {
    drums: { t: 0.003, v: 0.07 },
    bass: { t: 0.002, v: 0.05 },
    chords: { t: 0.004, v: 0.07 },
  },
  timbres: { bass: 'bright', chords: 'guitar', drums: 'rock' },
  parts: { drums, bass, chords },
};
