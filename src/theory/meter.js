// Time signatures.
//
// The scheduler counts in "slots": one quarter note in 4/4, one eighth note in the /8 meters.
// Slots are grouped, and the grouping is what gives odd meters their feel:
//     4/4   1+1+1+1      6/8   3+3      7/8   3+2+2      10/8   3+3+2+2   (slots per group)
//
// Positions and lengths everywhere else (chords, note events) are in quarter notes, and the tempo is
// always quarter-note BPM. So going 4/4 -> 7/8 at the same BPM keeps the eighth-note pace unchanged.

/**
 * @typedef {Object} Slot
 * @property {number} index       0-based slot in the bar
 * @property {number} start       position in quarter notes from the bar start
 * @property {number} len         length in quarter notes
 * @property {number} group       0-based group index
 * @property {number} posInGroup  0-based slot within its group (0 = the group's downbeat)
 *
 * @typedef {Object} Meter
 * @property {string} id
 * @property {number[]} groups     slots per group
 * @property {Slot[]} slots
 * @property {number} quarters     bar length in quarter notes
 * @property {number} slotLen      slot length in quarter notes
 * @property {number} tapQuarters  quarter notes per tap when tapping the tempo
 * @property {string} tapHint
 * @property {{start:number, len:number, first:number, slots:number}[]} groupSpans
 */

function build(id, groups, slotLen, extras) {
  const slots = [];
  const groupSpans = [];
  let start = 0;
  groups.forEach((n, g) => {
    groupSpans.push({ start, len: n * slotLen, first: slots.length, slots: n });
    for (let i = 0; i < n; i++) {
      slots.push({ index: slots.length, start, len: slotLen, group: g, posInGroup: i });
      start += slotLen;
    }
  });
  return Object.freeze({ id, groups, slots, quarters: start, slotLen, groupSpans, ...extras });
}

export const METERS = Object.freeze({
  '4/4': build('4/4', [1, 1, 1, 1], 1, {
    label: '4/4', tapQuarters: 1, tapHint: 'Tap the quarter-note beat',
    describeTempo: () => '',
  }),
  '6/8': build('6/8', [3, 3], 0.5, {
    label: '6/8 (3+3)', tapQuarters: 1.5, tapHint: 'Tap the two big beats (dotted quarters)',
    describeTempo: (bpm) => `Dotted-quarter beat: ${Math.round(bpm * 2 / 3)} per minute`,
  }),
  '7/8': build('7/8', [3, 2, 2], 0.5, {
    label: '7/8 (3+2+2)', tapQuarters: 1, tapHint: 'Tap in quarter notes (two eighths)',
    describeTempo: (bpm) => `Eighth notes: ${bpm * 2} per minute`,
  }),
  '10/8': build('10/8', [3, 3, 2, 2], 0.5, {
    label: '10/8 (3+3+2+2)', tapQuarters: 1, tapHint: 'Tap in quarter notes (two eighths)',
    describeTempo: (bpm) => `Eighth notes: ${bpm * 2} per minute`,
  }),
});

export const METER_IDS = Object.keys(METERS);

/** @returns {Meter} */
export function getMeter(id = '4/4') {
  const m = METERS[id];
  if (!m) throw new Error(`Unsupported time signature: ${id}`);
  return m;
}

/** Slots whose start lies inside [start, start + length) quarter notes: e.g. the slots a chord covers. */
export function slotsWithin(meter, start, length) {
  return meter.slots.filter((s) => s.start >= start - 1e-9 && s.start < start + length - 1e-9);
}

/** The first slot of each group inside a span (the "beats" of an odd meter). */
export const groupStartsWithin = (meter, start, length) => slotsWithin(meter, start, length).filter((s) => s.posInGroup === 0);
