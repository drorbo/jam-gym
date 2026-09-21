// How the styles play in 6/8, 7/8 and 10/8.
//
// These meters are felt in groups: 6/8 = 3+3, 7/8 = 3+2+2, 10/8 = 3+3+2+2 eighths. So the group
// downbeats play the part of "beats": kick on the strong ones, snare on the others, a ride ping or a
// walking-bass step on each, chord hits on each. Style flavours ('jazz' | 'blues' | 'rock') decide
// the details. Positions are quarter notes; an eighth is 0.5.

import { slotsWithin } from '../theory/meter.js';
import { mod12 } from '../theory/notes.js';
import { bassPc, boogieSteps, note } from './helpers.js';
import { DEFAULT_BASS, walkOddBar } from './walking.js';

/** Group spans that start inside a chord's span, clipped to it. */
function groupsIn(meter, seg) {
  return meter.groupSpans
    .filter((g) => g.start >= seg.startBeat - 1e-9 && g.start < seg.startBeat + seg.beats - 1e-9)
    .map((g) => ({ ...g, len: Math.min(g.len, seg.startBeat + seg.beats - g.start) }));
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
  });
  return ev;
}
