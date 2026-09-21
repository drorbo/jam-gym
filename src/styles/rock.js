// Rock: straight eighths. Backbeat drums, driving root bass, power-chord guitar.

import { guitarBar, oddChords } from './comping.js';
import { rockDrums } from './drumming.js';
import { rockBassBar, rockBassOdd } from './rockbass.js';

const chords = (ctx) => (ctx.meter.id !== '4/4' ? oddChords(ctx, 'rock') : guitarBar(ctx));
const bass = (ctx) => (ctx.meter.id !== '4/4' ? rockBassOdd(ctx) : rockBassBar(ctx));

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
  // the starting points of the Bass line, Keys and Drums panels
  bass: { rhythm: 'mixed', line: 20, tension: 20, approach: 'none', pattern: 'mixed', fills: 30, length: 50, pocket: 50, loose: 50 },
  comp: { rhythm: 'auto', density: 60, sync: 40, variety: 50, tension: 30, range: 40, spread: 50, length: 50, power: 50, pocket: 50, loose: 50 },
  kit: { cymbal: 50, kick: 50, snare: 50, ghosts: 50, fills: 50, wild: 50, crash: 50, power: 50, pocket: 50, loose: 50 },
  parts: { drums: rockDrums, bass, chords },
};
