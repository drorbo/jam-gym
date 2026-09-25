// Fixed bass figures: a short pattern repeated on every chord, in place of a walking line. The blues figures (roots and fifths,
// stop-time, a slow 12/8 pulse) and the Latin ones (bossa nova, tumbao, bolero) are all written the same way and played here.
//
// A figure is a function from the chord to its steps: [beat, semitones above the root, length, velocity, fixed?].
//   - `fixed` steps sit on an exact grid and are not swung again (a Latin figure is always straight).
//   - the semitones can be 'next': the root of the coming chord, played early (an anticipation, as in a tumbao or bolero).
//     It is left out when the chord does not change.
// Where nothing anticipates, the last note can lead a half step into a change of chord, as the boogie does.

import { mod12, nearestMidi } from '../theory/notes.js';
import { bassPc, note } from './helpers.js';

const LO = 28;
const HI = 46;

/**
 * One bar of a fixed figure.
 * @param {object} ctx  the bar (segments, nextChord, state, rng)
 * @param {(chord: object) => Array} stepsFor
 */
export function figureBar(ctx, stepsFor) {
  const { segments, nextChord, state, rng } = ctx;
  const ev = [];
  segments.forEach((seg, k) => {
    if (!seg.chord) return;
    const upcoming = segments[k + 1] ? segments[k + 1].chord : nextChord;
    const rootPc = bassPc(seg.chord);
    const base = LO + mod12(rootPc - LO); // E1..D#2 so the figure tops out below E3
    const changes = Boolean(upcoming) && bassPc(upcoming) !== rootPc;
    const steps = stepsFor(seg.chord).filter((st) => st[0] < seg.beats && (st[1] !== 'next' || changes));
    if (!steps.length) return;

    const pitches = [];
    steps.forEach((st) => {
      pitches.push(st[1] === 'next' ? nearestMidi(bassPc(upcoming), pitches.at(-1) ?? base, LO, HI) : base + st[1]);
    });
    const n = pitches.length;
    // lead into a change of chord: the last note steps to the next root from a half step away (unless a step already anticipates it)
    if (changes && n >= 2 && !steps.some((st) => st[1] === 'next') && rng.chance(0.5)) {
      const target = bassPc(upcoming);
      const from = pitches[n - 2];
      const up = nearestMidi(mod12(target + 1), from, LO, HI);
      const down = nearestMidi(mod12(target - 1), from, LO, HI);
      pitches[n - 1] = Math.abs(up - from) <= Math.abs(down - from) ? up : down;
    }
    // a note never rings into the next chord: it is cut at the end of this one
    steps.forEach(([beat, , dur, vel, fixed], i) => ev.push(note('bass', pitches[i], seg.startBeat + beat, Math.max(0.05, Math.min(dur, seg.beats - beat)), vel, fixed ? { fixed: true } : {})));
    state.bass = pitches[n - 1];
    state.bass2 = pitches[n - 2] ?? state.bass;
  });
  return ev;
}

const fifth = (c) => c.fifth ?? 7;

/** The blues figures beyond the boogie (Pattern in the Bass line panel). */
export const BLUES_FIGURE_STEPS = {
  fifths: (c) => [[0, 0, 0.9, 0.84], [1, fifth(c), 0.9, 0.7], [2, 0, 0.9, 0.8], [3, fifth(c), 0.9, 0.7]],
  pushed: (c) => [[0, 0, 0.9, 0.86], [1.5, 0, 0.45, 0.7], [2, fifth(c), 0.9, 0.74], [3.5, 0, 0.4, 0.66]],
  stoptime: (c) => [[0, 0, 0.6, 0.92], [1.5, fifth(c), 0.4, 0.72]],
  triplets: () => Array.from({ length: 12 }, (_, i) => [i / 3, 0, 0.3, i % 3 === 0 ? 0.84 : 0.56, true]),
};

/**
 * Jazz figures that are not Latin. The first three swing with everything else (their off-beat notes sit on the swung "and");
 * the funk groove is in straight sixteenths (fixed), so it sits with a straight Swing.
 */
export const JAZZ_BASS_STEPS = {
  // a pedal point: one long root a bar, for modal tunes that stay on a chord
  pedal: () => [[0, 0, 3.7, 0.86]],
  // a modal vamp: root, an octave skip on the swung "and" of two, root, fifth
  vamp: (c) => [[0, 0, 0.9, 0.86], [1.5, 12, 0.4, 0.66], [2, 0, 0.9, 0.78], [3, fifth(c), 0.9, 0.7]],
  // sparse, half-time: a long root, then the fifth on the swung "and" of three, leaving the rest to the rhythm section
  space: (c) => [[0, 0, 1.7, 0.86], [2.5, fifth(c), 0.9, 0.72]],
  // jazz-funk: a syncopated riff in straight sixteenths, with ghosted notes between the accents
  funk: (c) => [
    [0, 0, 0.4, 0.9, true], [0.75, 0, 0.2, 0.55, true], [1.5, 12, 0.3, 0.76, true], [2, 0, 0.4, 0.86, true],
    [2.75, c.seventh === 11 ? 11 : 10, 0.25, 0.7, true], [3.25, fifth(c), 0.25, 0.62, true], [3.5, 0, 0.3, 0.78, true],
  ],
};

/** The Latin figures for jazz. All straight (fixed), so they sit with the Latin drum grooves. */
export const LATIN_BASS_STEPS = {
  // bossa nova: the dotted pulse, root, fifth and root, in three, three and two eighths
  bossa: (c) => [[0, 0, 1.3, 0.86, true], [1.5, fifth(c), 1.2, 0.72, true], [3, 0, 0.85, 0.7, true]],
  // tumbao: the "and" of two, then four, then the next chord's root a half beat early
  tumbao: (c) => [[1.5, 0, 1.2, 0.8, true], [3, fifth(c), 0.48, 0.86, true], [3.5, 'next', 0.45, 0.76, true]],
  // bolero: long roots for a slow Latin ballad, the fifth on three, and the next root anticipated
  bolero: (c) => [[0, 0, 1.9, 0.85, true], [2, fifth(c), 1.35, 0.7, true], [3.5, 'next', 0.45, 0.72, true]],
};

// ---- the /8 meters ----------------------------------------------------------------------------
// Figures built from the groups (3+3, 3+2+2, 3+3+2+2 eighths) instead of from beats, so one figure works in every odd meter.
// A step is [eighth within the group, semitones above the root, length in eighths, velocity]. The semitones can also be
//   'lead'      a half step into the next chord's root (when the chord is about to change; otherwise the neighbour below)
//   'neighbor'  the note just below the root (a step up from E1 on the lowest string, so it stays on the bass)

/** The groups that start inside a chord, with their length clipped to it, in eighths. */
function groupsOf(meter, seg) {
  return meter.groupSpans
    .filter((g) => g.start >= seg.startBeat - 1e-9 && g.start < seg.startBeat + seg.beats - 1e-9)
    .map((g) => ({ ...g, eighths: Math.max(1, Math.round(Math.min(g.len, seg.startBeat + seg.beats - g.start) / meter.slotLen)) }));
}

export function oddFigureBar(ctx, stepsFor) {
  const { meter, segments, nextChord, state } = ctx;
  const ev = [];
  segments.forEach((seg, k) => {
    if (!seg.chord) return;
    const upcoming = segments[k + 1] ? segments[k + 1].chord : nextChord;
    const base = LO + mod12(bassPc(seg.chord) - LO);
    const changes = Boolean(upcoming) && bassPc(upcoming) !== bassPc(seg.chord);
    const groups = groupsOf(meter, seg);
    let run = 0; // eighths since the chord began: an arpeggio runs on across the groups
    let previous = base;
    groups.forEach((g, gi) => {
      const isLast = gi === groups.length - 1;
      const steps = stepsFor({ chord: seg.chord, slots: g.eighths, first: gi === 0, last: isLast, run, upcoming: isLast && changes ? upcoming : null });
      steps.forEach(([slot, semi, eighths, vel]) => {
        let midi;
        if (semi === 'lead' && isLast && changes) {
          const target = bassPc(upcoming);
          const up = nearestMidi(mod12(target + 1), previous, LO, HI);
          const down = nearestMidi(mod12(target - 1), previous, LO, HI);
          midi = Math.abs(up - previous) <= Math.abs(down - previous) ? up : down;
        } else if (semi === 'lead' || semi === 'neighbor') {
          midi = base === LO ? base + 1 : base - 1;
        } else {
          midi = base + semi;
        }
        const start = g.start + slot * meter.slotLen;
        const dur = Math.max(0.05, Math.min(eighths * meter.slotLen, seg.startBeat + seg.beats - start));
        ev.push(note('bass', midi, start, dur, vel));
        previous = midi;
      });
      run += g.eighths;
    });
    state.bass = previous;
  });
  return ev;
}

export const ODD_FIGURE_STEPS = {
  // a long root on every group, holding it to the next
  grouproots: ({ slots }) => [[0, 0, slots * 0.94, 0.84]],
  // the root on each group and the fifth on its last eighth
  bounce: ({ slots, chord }) => (slots >= 2 ? [[0, 0, (slots - 1) * 0.94, 0.84], [slots - 1, fifth(chord), 0.9, 0.7]] : [[0, 0, 0.9, 0.84]]),
  // an eighth-note arpeggio that runs on across the groups: root, third, fifth, seventh (or the octave)
  arp: ({ slots, chord, run }) => {
    const tones = [0, chord.third ?? 4, fifth(chord), chord.seventh ?? 12];
    return Array.from({ length: slots }, (_, i) => [i, tones[(run + i) % tones.length], 0.9, i === 0 ? 0.84 : 0.66]);
  },
  // the root on each group and a step on its last eighth: into the next chord, or a neighbour below the root
  stepin: ({ slots, last, upcoming }) => (slots >= 2
    ? [[0, 0, (slots - 1) * 0.94, 0.84], [slots - 1, last && upcoming ? 'lead' : 'neighbor', 0.9, 0.7]]
    : [[0, 0, 0.9, 0.84]]),
};

/** The figure for a bar of a /8 meter if one is chosen, else null (the style's usual line plays). */
export function oddFigure(ctx) {
  const steps = ODD_FIGURE_STEPS[ctx.bassOpts.pattern];
  return steps ? oddFigureBar(ctx, steps) : null;
}
