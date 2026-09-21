// Jazz: medium swing. Ride cymbal, feathered kick, walking bass, rootless piano comping.

import { keysBar, oddChords } from './comping.js';
import { jazzDrums } from './drumming.js';
import { oddBass } from './oddMeters.js';
import { walkBar } from './walking.js';

const swingAt = (bpm) => Math.min(0.667, Math.max(0.56, 0.667 - (bpm - 120) * 0.0011));

function chords(ctx) {
  return ctx.meter.id !== '4/4' ? oddChords(ctx, 'jazz') : keysBar(ctx, 'jazz');
}

function bass(ctx) {
  if (ctx.meter.id !== '4/4') return oddBass(ctx, 'jazz');
  return walkBar(ctx, 'jazz');
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
  timbres: { bass: 'double', chords: 'piano', drums: 'jazz' },
  // the walking-bass panel's starting point for this style
  bass: { rhythm: 'mixed', line: 40, tension: 30, approach: 'mixed', pattern: 'walk', fills: 40, length: 50, pocket: 50, loose: 50 },
  comp: { rhythm: 'auto', density: 50, sync: 55, variety: 60, tension: 30, range: 47, spread: 40, length: 50, power: 50, pocket: 50, loose: 50 },
  kit: { cymbal: 50, kick: 50, snare: 50, ghosts: 50, fills: 50, wild: 50, crash: 50, power: 50, pocket: 50, loose: 50 },
  parts: { drums: jazzDrums, bass, chords },
};
