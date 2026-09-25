// What the band's playing can be shaped with: the schema for every control on the Bass line, Keys and Drums panels.
//
// The schema is data, so one panel component draws all three groups, one function checks a saved value, and the
// generators (walking.js, comping.js, drumming.js, the styles) just read the resolved numbers. Adding a control means
// adding a field here and reading it where the notes are made.
//
// Every parameter can also be "mixed". A dropdown has a Mixed choice (the band picks for itself, bar by bar). A slider has
// a Mix toggle: it then wanders up to 30 either side of where it was left, drifting smoothly from bar to bar instead of
// staying put (see `resolveMix`). Which sliders are mixed is stored as `mix`, a list of their ids, in each group.
//
// Sliders run 0 to 100. Most of them are anchored so that 50 means "as the style normally plays", less is sparser or
// simpler, more is busier or richer. A few are centred at 50 by meaning: timing (behind or ahead of the beat) and feel.

import { hashSeed } from '../engine/rng.js';
import { DEFAULT_LEVELS, DRUM_PARTS } from './drumparts.js';

// ---- rhythm, approach and pattern lists ---------------------------------------------------

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
  { id: 'enclosure', name: 'Enclosure', short: 'enclosures', hint: 'a note above, then a note below, landing on the next root', styles: ['jazz', 'blues'] },
  { id: 'none', name: 'None', short: 'no approach notes', hint: 'stay on the root until the chord changes', styles: ['rock'] },
];

export const PATTERNS = [
  { id: 'mixed', name: 'Boogie, walking at turnarounds', hint: 'the eighth-note boogie, with a half-step lead into changes and a walking bar to turn the chorus around', styles: ['blues'] },
  { id: 'walk', name: 'Walking throughout', hint: 'a walking line for the whole chorus', styles: ['blues'] },
  { id: 'boogie', name: 'Boogie throughout', hint: 'the eighth-note boogie the whole way, changing figure now and then', styles: ['blues'] },
  { id: 'classic', name: 'Classic boogie', hint: 'root, third, fifth, sixth, flat seven and back down, in swung eighths', styles: ['blues'] },
  { id: 'chicago', name: 'Chicago shuffle', hint: 'root, fifth, sixth, fifth: the driving Chicago figure', styles: ['blues'] },
  { id: 'rise', name: 'Rising boogie', hint: 'a boogie that climbs through the third and fifth to the seventh', styles: ['blues'] },
  { id: 'fifths', name: 'Roots and fifths', hint: 'quarter notes alternating the root and the fifth, country-blues style', styles: ['blues'] },
  { id: 'pushed', name: 'Pushed roots', hint: 'roots that land just ahead of the beat, with the fifth to answer', styles: ['blues'] },
  { id: 'stoptime', name: 'Stop-time', hint: 'a hit on one and a stab in the second half, then space', styles: ['blues'] },
  { id: 'triplets', name: 'Slow 12/8 pulse', hint: 'roots in even triplets, for a slow blues', styles: ['blues'] },
  { id: 'mixed', name: 'Mixed rock bass', hint: 'driving eighths, octaves and pushes, changing from bar to bar', styles: ['rock'] },
  { id: 'eighths', name: 'Driving eighths', hint: 'root eighth notes, the classic rock engine', styles: ['rock'] },
  { id: 'octaves', name: 'Octaves', hint: 'root and octave, bouncing', styles: ['rock'] },
  { id: 'pushes', name: 'Pushes', hint: 'notes that anticipate the beat', styles: ['rock'] },
  { id: 'quarters', name: 'Quarter notes', hint: 'steady quarter-note roots, plain and heavy', styles: ['rock'] },
  { id: 'syncopated', name: 'Syncopated', hint: 'dotted eighths and sixteenths that lock with the kick', styles: ['rock'] },
  { id: 'melodic', name: 'Melodic line', hint: 'a moving line built from the chord, with approach notes', styles: ['rock'] },
  { id: 'boogie', name: 'Rock and roll boogie', hint: 'the boogie figure in straight eighths, root to flat seven and back', styles: ['rock'] },
  { id: 'gallop', name: 'Gallop', hint: 'an eighth and two sixteenths on every beat, the metal engine', styles: ['rock'] },
  { id: 'threethreetwo', name: 'Three-three-two', hint: 'roots in groups of three eighths, three and two', styles: ['rock'] },
  { id: 'offbeat', name: 'Off-beat pumps', hint: 'roots on the "ands" only, leaving the beat to the drums', styles: ['rock'] },
  { id: 'held', name: 'Held roots', hint: 'long half-note roots, a wall under the guitars', styles: ['rock'] },
];

/** The blues Pattern choices that play a fixed figure. Walking lines (Line, Tensions, Approach, Rhythm) do nothing for them. */
export const BLUES_FIGURES = ['boogie', 'classic', 'chicago', 'rise', 'fifths', 'pushed', 'stoptime', 'triplets'];
export const playsFigure = (v, styleId) => styleId === 'blues' && BLUES_FIGURES.includes(v.pattern);

// Drum grooves (Drums panel; in jazz it is Sticks or Brushes). The first, "Classic", is what each style played before there was a choice.
export const GROOVES = [
  { id: 'classic', name: 'Sticks', hint: 'the ride cymbal, hi-hat on two and four, and a feathered kick', styles: ['jazz'] },
  { id: 'brushes', name: 'Brushes: swing', hint: 'the swing pattern played with brushes on the snare, with a sweeping left hand on every beat and a soft brushed crash', styles: ['jazz'] },
  { id: 'sweep', name: 'Brushes: ballad sweeps', hint: 'slow circular sweeps carry the time, with a soft kick and hi-hat and a brushed crash now and then', styles: ['jazz'] },
  { id: 'bossa', name: 'Latin: bossa nova', hint: 'straight eighths on the hat, a two-bar clave on the cross-stick, a rocking kick; sets Swing to 50%', styles: ['jazz'], swing: 50 },
  { id: 'afro', name: 'Latin: Afro-Cuban', hint: 'a bell-like ride on the beat, cascara on the cross-stick, the foot on two and four; sets Swing to 50%', styles: ['jazz'], swing: 50 },
  { id: 'classic', name: 'Classic shuffle', hint: 'the shuffle: hat on every beat and swung "and", backbeat on two and four', styles: ['blues'] },
  { id: 'slow', name: 'Slow 12/8', hint: 'three even hat notes to every beat, the slow-blues feel', styles: ['blues'] },
  { id: 'purdie', name: 'Half-time shuffle', hint: 'one big snare on three, with ghost notes rolling through the shuffle', styles: ['blues'] },
  { id: 'chicago', name: 'Chicago', hint: 'a kick on every beat under a shuffled ride', styles: ['blues'] },
  { id: 'train', name: 'Train beat', hint: 'a brushed, chugging snare shuffle', styles: ['blues'] },
  { id: 'classic', name: 'Classic rock', hint: 'eighth-note hats, kick and snare, with the usual variations', styles: ['rock'] },
  { id: 'fourfloor', name: 'Four on the floor', hint: 'a kick on every beat, open hats on the offbeats', styles: ['rock'] },
  { id: 'half', name: 'Half-time', hint: 'the backbeat drops to one heavy snare on three', styles: ['rock'] },
  { id: 'stomp', name: 'Stomp and clap', hint: 'boom boom clap, no hats', styles: ['rock'] },
  { id: 'ride', name: 'Ride groove', hint: 'eighth notes on the ride cymbal', styles: ['rock'] },
  { id: 'funk', name: 'Funk rock', hint: 'sixteenth-note hats, ghosted snares, a syncopated kick', styles: ['rock'] },
  { id: 'diddley', name: 'Bo Diddley', hint: 'the "shave and a haircut" clave on the toms', styles: ['rock'] },
  { id: 'mixed', name: 'Mixed', hint: 'a different groove every four bars', styles: ['jazz', 'blues', 'rock'] },
];

/** The swing a groove asks for (a straight Latin groove: 50), or null if it has no opinion. */
export const grooveSwing = (styleId, grooveId) => GROOVES.find((o) => o.id === grooveId && o.styles?.includes(styleId))?.swing ?? null;

export const COMP_RHYTHMS = [
  { id: 'auto', name: 'From the sliders', hint: 'the rhythm is built from the sliders below (How much, On or off the beat, Pattern)' },
  { id: 'mixed', name: 'Mixed', hint: 'a different rhythm each bar: the sliders, or one of the named patterns' },
  { id: 'charleston', name: 'Charleston', hint: 'a long chord on beat one and a short one on the "and" of two', styles: ['jazz'] },
  { id: 'ands', name: 'On the ands', hint: 'short chords on the "and" of one and three', styles: ['jazz'] },
  { id: 'late', name: 'Late and pushed', hint: 'the "and" of two, then beat four', styles: ['jazz'] },
  { id: 'long', name: 'Long chords', hint: 'a long chord and a late push', styles: ['jazz'] },
  { id: 'twofour', name: 'Two and four', hint: 'chords on the backbeat', styles: ['jazz'] },
  { id: 'busy', name: 'Busy', hint: 'three or four hits a bar', styles: ['jazz'] },
  { id: 'fourbar', name: 'Four to the bar', hint: 'a chord on every beat', styles: ['blues'] },
  { id: 'longshort', name: 'Long and short', hint: 'a long chord, then a short one and a pickup', styles: ['blues'] },
  { id: 'pad', name: 'Pad', hint: 'one sustained chord for the whole bar', styles: ['blues'] },
  { id: 'stabs', name: 'Shuffle stabs', hint: 'short chords that fill the shuffle', styles: ['blues', 'rock'] },
  { id: 'chug', name: 'Palm-muted chug', hint: 'muted eighth notes', styles: ['rock'] },
  { id: 'quarters', name: 'Quarter chords', hint: 'a chord on every beat', styles: ['rock'] },
  { id: 'open', name: 'Open ringing', hint: 'one chord left to ring for the bar', styles: ['rock'] },
];

// ---- 6/8, 7/8 and 10/8 -------------------------------------------------------------------------
// Some choices play exactly like another one in the /8 meters, where the groupings decide the feel. `oddAs` names that
// other choice (per style, or '*' for every style), and the panels then leave the duplicate out of the list there.

export const isOddMeter = (meterId) => Boolean(meterId) && meterId !== '4/4';

function markOdd(list, styleId, map) {
  for (const o of list) {
    if (!map[o.id] || (styleId !== '*' && !o.styles?.includes(styleId))) continue;
    o.oddAs = { ...o.oddAs, [styleId]: map[o.id] };
  }
}
const oddTarget = (o, styleId) => o.oddAs?.[styleId] ?? o.oddAs?.['*'];

markOdd(RHYTHMS, '*', { two: 'quarters' }); // two-feel has no meaning where the groups are the beats
markOdd(PATTERNS, 'blues', Object.fromEntries(['classic', 'chicago', 'rise', 'fifths', 'pushed', 'stoptime', 'triplets'].map((id) => [id, 'boogie'])));
markOdd(PATTERNS, 'rock', { octaves: 'eighths', syncopated: 'eighths', boogie: 'eighths', gallop: 'eighths', threethreetwo: 'eighths', offbeat: 'eighths', held: 'quarters' });
markOdd(COMP_RHYTHMS, '*', Object.fromEntries(COMP_RHYTHMS.filter((o) => o.id !== 'auto').map((o) => [o.id, 'auto'])));
markOdd(GROOVES, 'jazz', { bossa: 'classic', afro: 'classic' }); // Latin grooves are 4/4 only
markOdd(GROOVES, 'blues', { slow: 'classic', purdie: 'classic', chicago: 'classic', train: 'classic', mixed: 'classic' });
markOdd(GROOVES, 'rock', { fourfloor: 'classic', half: 'classic', stomp: 'classic', ride: 'classic', funk: 'classic', diddley: 'classic', mixed: 'classic' });

// ---- field builders --------------------------------------------------------------------------

const slider = (id, name, words, extra = {}) => ({ id, type: 'slider', name, words, ...extra });
const select = (id, name, options, extra = {}) => ({ id, type: 'select', name, options, ...extra });

const DYNAMICS = ['Soft', 'Gentle', 'Medium', 'Strong', 'Hard'];
const TIMING = ['Ahead', 'A little ahead', 'In the pocket', 'A little behind', 'Laid back'];
const FEEL = ['Machine tight', 'Tight', 'Natural', 'Loose', 'Sloppy'];
const OFTEN = ['None', 'Rare', 'Sometimes', 'Often', 'Constantly'];


const nameOf = (list, id, styleId) => (list.find((o) => o.id === id && (!o.styles || o.styles.includes(styleId))) ?? {}).name ?? id;
const grooveName = (v, styleId) => nameOf(GROOVES, v.groove, styleId);
const patternName = (v, styleId) => nameOf(PATTERNS, v.pattern, styleId);
const ODD_TEXT = 'In 6/8, 7/8 and 10/8 the parts follow the groupings';
/** A 6/8 bar walked in quarters is two notes long (the root, then the approach): nothing left for Tensions to shape. */
const shortBar = (v, meterId) => meterId === '6/8' && ['quarters', 'skips'].includes(v.rhythm);
const figureWhy = (v, styleId) => (playsFigure(v, styleId) ? `${patternName(v, styleId)} plays a fixed figure, so this does nothing.` : null);

export const GROUPS = {
  bass: {
    title: 'Bass line',
    fields: [
      select('rhythm', 'Rhythm', RHYTHMS, { styles: ['jazz', 'blues'], inactive: (v, style) => figureWhy(v, style) }),
      select('pattern', 'Pattern', PATTERNS, { styles: ['blues', 'rock'] }),
      slider('line', 'Line', ['Scales', 'Mostly scales', 'Scales and arpeggios', 'Mostly arpeggios', 'Arpeggios'], {
        wordsByStyle: { rock: ['Root notes', 'Mostly roots', 'Some movement', 'Melodic', 'Very melodic'] },
        inactive: (v, style, meter) => figureWhy(v, style)
          ?? (style === 'rock' && v.pattern === 'boogie' && !isOddMeter(meter) ? 'Rock and roll boogie is a fixed figure, so this does nothing.' : null)
          ?? (style === 'blues' && v.pattern === 'mixed' && shortBar(v, meter) ? 'This blues only walks to turn the chorus around, and a 6/8 bar walked this way is just two notes, so this does nothing.' : null),
      }),
      slider('tension', 'Tensions', ['Chord tones', 'A few colour tones', 'Some colour', 'Colourful', 'Lots of colour'], {
        wordsByStyle: { rock: ['Plain', 'A little colour', 'Some colour', 'Colourful', 'Lots of colour'] },
        inactive: (v, style, meter) => figureWhy(v, style)
          ?? (style !== 'rock' && v.rhythm === 'two' ? 'Two-feel plays only roots and fifths, so this does nothing.' : null)
          ?? (style !== 'rock' && shortBar(v, meter) ? 'A 6/8 bar walked this way is only two notes, so this does nothing.' : null),
      }),
      select('approach', 'Approach', APPROACHES, { inactive: (v, style) => figureWhy(v, style) }),
      slider('fills', 'Bass fills', OFTEN, {
        styles: ['rock'],
        inactive: (v, style, meter) => (isOddMeter(meter) ? `${ODD_TEXT}, so there are no fills.` : v.pattern === 'melodic' ? 'The melodic line plays no fill runs, so this does nothing.' : null),
      }),
      slider('length', 'Note length', ['Staccato', 'Short', 'Natural', 'Long', 'Legato']),
      slider('pocket', 'Timing', TIMING),
      slider('loose', 'Feel', FEEL),
    ],
  },
  comp: {
    title: 'Keys',
    fields: [
      select('rhythm', 'Rhythm', COMP_RHYTHMS, { inactive: (v, style, meter) => (isOddMeter(meter) ? `${ODD_TEXT}, so there are no named rhythms.` : null) }),
      slider('density', 'How much', ['Very little', 'Sparse', 'Moderate', 'Busy', 'Constant'], {
        hint: 'How many chords: less leaves room for the soloist',
      }),
      slider('sync', 'On or off the beat', ['On the beat', 'Mostly on the beat', 'Mixed', 'Mostly off the beat', 'Off the beat'], {
        hint: 'Chords on the beat, or on the "ands" and pushed ahead of it',
      }),
      slider('variety', 'Pattern', ['Repeating', 'Mostly repeating', 'Some variation', 'Varied', 'Always new'], {
        hint: 'Stay with a rhythm from bar to bar, or change it every time',
        inactive: (v, style, meter) => (isOddMeter(meter) ? `${ODD_TEXT}, so the rhythm does not change from bar to bar.` : null),
      }),
      slider('tension', 'Harmony', ['Shells', 'Rootless', 'Extended', 'Upper structures', 'Altered'], {
        wordsByStyle: {
          blues: ['Triads', 'Sevenths', 'Ninths', 'Thirteenths', 'Blues colours'],
          rock: ['Power chords', 'Fifths and thirds', 'Full chords', 'Add 9 and sus', 'Open and ringing'],
        },
        hint: 'How many tensions: 9ths, 13ths and, at the top, upper-structure triads',
      }),
      slider('range', 'Register', ['Low', 'Lowish', 'Middle', 'Highish', 'High'], { hint: 'Where on the keyboard' }),
      slider('spread', 'Voicing', ['Close', 'Compact', 'Medium', 'Open', 'Wide'], { hint: 'Notes packed together, or spread out' }),
      slider('length', 'Note length', ['Staccato', 'Short', 'Natural', 'Long', 'Sustained']),
      slider('power', 'Dynamics', DYNAMICS),
      slider('pocket', 'Timing', TIMING),
      slider('loose', 'Feel', FEEL),
    ],
  },
  kit: {
    title: 'Drums',
    fields: [
      select('groove', 'Groove', GROOVES, {
        styles: ['jazz', 'blues', 'rock'],
        inactive: (v, style, meter) => (isOddMeter(meter) && style !== 'jazz' ? `${ODD_TEXT}, so there are no grooves.` : null),
      }),
      slider('cymbal', 'Ride and hi-hat', ['Just quarters', 'Airy', 'Standard', 'Busy', 'Full'], {
        hint: 'Quarter notes with room to breathe, or the cymbal filling every gap',
      }),
      slider('kick', 'Kick', ['On the beat', 'Mostly on the beat', 'Some syncopation', 'Syncopated', 'Busy'], {
        hint: 'Kick drum only on the beat, or dropping in off it',
        inactive: (v, style, meter) => (style === 'jazz' && isOddMeter(meter) ? 'The jazz kick is feathered on every beat, so this does nothing.'
          : style === 'rock' && !isOddMeter(meter) && ['fourfloor', 'stomp', 'diddley'].includes(v.groove) ? `${grooveName(v, style)} has its own kick pattern, so this does nothing.` : null),
      }),
      slider('snare', 'Snare', ['Backbeat only', 'Mostly backbeat', 'Some extras', 'Chatty', 'Busy'], {
        hint: 'Just the backbeat (or in jazz, no comping), or extra hits around it',
        inactive: (v, style, meter) => (style !== 'jazz' && isOddMeter(meter) ? `${ODD_TEXT}, with the snare on the group downbeats, so this does nothing.`
          : style === 'blues' && ['slow', 'chicago', 'train'].includes(v.groove) ? `${grooveName(v, style)} has its own snare pattern, so this does nothing.`
          : style === 'rock' && v.groove === 'funk' ? 'Funk rock has its own snare pattern, so this does nothing.' : null),
      }),
      slider('ghosts', 'Ghost notes', ['None', 'A few', 'Some', 'Many', 'Lots'], {
        inactive: (v, style, meter) => (isOddMeter(meter) ? null
          : (style === 'blues' && v.groove === 'train') || (style === 'rock' && ['fourfloor', 'stomp', 'ride', 'diddley'].includes(v.groove)) ? `${grooveName(v, style)} has no ghost notes, so this does nothing.` : null),
      }),
      slider('fills', 'Fills', OFTEN, { hint: 'How often a fill leads into the next phrase' }),
      slider('wild', 'Fill style', ['Simple', 'Tidy', 'Standard', 'Busy', 'Wild'], { hint: 'A single snare pickup, or sixteenth-note tom runs' }),
      slider('crash', 'Crashes', ['None', 'Rare', 'Standard', 'Often', 'Always']),
      slider('power', 'Dynamics', DYNAMICS),
      slider('pocket', 'Timing', TIMING),
      slider('loose', 'Feel', FEEL),
    ],
  },
};

export const GROUP_IDS = Object.keys(GROUPS);

/** Every option id a select field could hold (the styles decide which are offered). */
const allIds = (f) => f.options.map((o) => o.id);
const appliesTo = (item, styleId) => !item.styles || item.styles.includes(styleId);

/** The fields to show for a style. */
export const fieldsFor = (group, styleId) => GROUPS[group].fields.filter((f) => appliesTo(f, styleId));
/** The options of a select field that make sense for a style. */
export const optionsFor = (field, styleId) => field.options.filter((o) => appliesTo(o, styleId));
export const wordsFor = (field, styleId) => field.wordsByStyle?.[styleId] ?? field.words;

/** The word that describes a slider position. */
export const wordFor = (field, styleId, value) => {
  const words = wordsFor(field, styleId);
  return words[Math.min(words.length - 1, Math.max(0, Math.round(value / 25)))];
};

/** The options of a select for a style and meter: in 6/8, 7/8 and 10/8 the ones that sound like another are left out. */
export const optionsForMeter = (field, styleId, meterId) => optionsFor(field, styleId).filter((o) => !(isOddMeter(meterId) && oddTarget(o, styleId)));

/** The option that actually plays for a stored value in this meter (a choice that plays like another one in the /8 meters). */
export function effectiveOption(field, value, styleId, meterId) {
  if (!isOddMeter(meterId)) return value;
  const o = field.options.find((x) => x.id === value && appliesTo(x, styleId));
  return (o && oddTarget(o, styleId)) || value;
}

/** A group's values as they play in this meter: every select mapped through `effectiveOption`. */
export function effectiveValues(group, values, styleId, meterId) {
  const out = { ...values };
  for (const f of GROUPS[group].fields) if (f.type === 'select' && f.id in out) out[f.id] = effectiveOption(f, out[f.id], styleId, meterId);
  return out;
}

/**
 * The controls that do nothing right now, with why: `{ kick: 'Four on the floor has its own kick pattern, ...' }`.
 * The panels grey these out and show the reason.
 */
export function inactiveControls(group, values, styleId, meterId = '4/4') {
  const eff = effectiveValues(group, values, styleId, meterId);
  const out = {};
  for (const f of fieldsFor(group, styleId)) {
    const why = f.inactive?.(eff, styleId, meterId);
    if (why) out[f.id] = why;
  }
  return out;
}

// ---- defaults and checking -------------------------------------------------------------------

const NEUTRAL = {
  bass: { rhythm: 'quarters', line: 40, tension: 25, approach: 'mixed', pattern: 'mixed', fills: 40, length: 50, pocket: 50, loose: 50, mix: [] },
  comp: { rhythm: 'auto', density: 50, sync: 50, variety: 50, tension: 40, range: 45, spread: 40, length: 50, power: 50, pocket: 50, loose: 50, mix: [] },
  kit: { levels: DEFAULT_LEVELS, groove: 'classic', cymbal: 50, kick: 50, snare: 50, ghosts: 50, fills: 50, wild: 50, crash: 50, power: 50, pocket: 50, loose: 50, mix: [] },
};
export const DEFAULT_BASS = Object.freeze({ ...NEUTRAL.bass });
export const DEFAULT_COMP = Object.freeze({ ...NEUTRAL.comp });
export const DEFAULT_KIT = Object.freeze({ ...NEUTRAL.kit });
const BASES = { bass: DEFAULT_BASS, comp: DEFAULT_COMP, kit: DEFAULT_KIT };

/**
 * Merge untrusted values over a base (a style's defaults), keeping only valid ones.
 * Sliders are whole numbers 0 to 100; selects must name a known option.
 */
export function sanitizeGroup(group, raw, base = BASES[group]) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const f of GROUPS[group].fields) {
    const fallback = base[f.id] ?? BASES[group][f.id];
    const v = r[f.id];
    if (f.type === 'slider') out[f.id] = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : fallback;
    else out[f.id] = allIds(f).includes(v) ? v : fallback;
  }
  // the Drums panel's mini mixer: one level per drum, each 0 to 100 (50 is unity)
  if (group === 'kit') {
    const lv = r.levels && typeof r.levels === 'object' ? r.levels : {};
    const from = base.levels ?? DEFAULT_LEVELS;
    out.levels = Object.fromEntries(DRUM_PARTS.map((p) => [p.id, Number.isFinite(lv[p.id]) ? Math.min(100, Math.max(0, Math.round(lv[p.id]))) : (from[p.id] ?? 50)]));
  }
  // which sliders are mixed: known slider ids only, once each, in the panel's order
  const wanted = Array.isArray(r.mix) ? r.mix : Array.isArray(base.mix) ? base.mix : [];
  out.mix = GROUPS[group].fields.filter((f) => f.type === 'slider' && wanted.includes(f.id)).map((f) => f.id);
  return out;
}
export const sanitizeBass = (raw, base = DEFAULT_BASS) => sanitizeGroup('bass', raw, base);
export const sanitizeComp = (raw, base = DEFAULT_COMP) => sanitizeGroup('comp', raw, base);
export const sanitizeKit = (raw, base = DEFAULT_KIT) => sanitizeGroup('kit', raw, base);

/** A short line for the panel header: what is not at the style's default, or "Style default". */
export function describeGroup(group, values, defaults, styleId) {
  const parts = [];
  for (const f of fieldsFor(group, styleId)) {
    const v = values[f.id];
    const mixed = values.mix?.includes(f.id);
    if (mixed) { parts.push(`${f.name}: mixed`); continue; }
    if (v === defaults[f.id]) continue;
    if (f.type === 'select') parts.push(optionsFor(f, styleId).find((o) => o.id === v)?.name ?? v);
    else parts.push(`${f.name}: ${wordFor(f, styleId, v).toLowerCase()}`);
  }
  if (group === 'kit' && values.levels && DRUM_PARTS.some((p) => values.levels[p.id] !== (defaults.levels ?? {})[p.id])) parts.push('Drum mixer');
  if (!parts.length) return 'Style default';
  return parts.length > 3 ? `${parts.slice(0, 3).join(' · ')} · +${parts.length - 3} more` : parts.join(' · ');
}

// ---- mapping a slider to a number generators use ----------------------------------------------

/** 0 to 100 -> a multiplier: 0 at zero, 1 at the middle (the style's normal), 2 at the top. */
export const gain = (v) => Math.max(0, v) / 50;
/** A probability that is `base` at the middle setting, none at zero and at most 1. */
export const odds = (base, v) => Math.min(1, base * gain(v));

// ---- mixed sliders -----------------------------------------------------------------------------

/** How far a mixed slider wanders either side of where it was left. */
export const MIX_SPREAD = 30;
/** A mixed slider drifts to a new random target every this many bars, gliding between targets. */
const MIX_BARS = 4;

const hash01 = (seed, key, n) => {
  let k = 0;
  for (let i = 0; i < key.length; i++) k = (k * 31 + key.charCodeAt(i)) | 0;
  return (hashSeed(seed, k, n) % 10000) / 10000;
};

/** The value a mixed slider has in bar `t` of a run: smooth value noise around `center`, so the band drifts rather than jumps. */
export function wander(center, key, t, seed = 0) {
  const i = Math.floor(t / MIX_BARS);
  const f = (t - i * MIX_BARS) / MIX_BARS;
  const s = f * f * (3 - 2 * f);
  const r = hash01(seed, key, i) * (1 - s) + hash01(seed, key, i + 1) * s;
  return Math.min(100, Math.max(0, Math.round(center + (r * 2 - 1) * MIX_SPREAD)));
}

/**
 * The values to play a bar with: each mixed slider replaced by where it has wandered to by this bar. Everything else is
 * untouched, and so is the stored setting.
 * @param {{chorus?:number, barIndex?:number, barCount?:number, seed?:number}} where
 */
export function resolveMix(group, values, { chorus = 1, barIndex = 0, barCount = 1, seed = 0 } = {}) {
  if (!values.mix?.length) return values;
  const t = (chorus - 1) * barCount + barIndex;
  const out = { ...values };
  for (const id of values.mix) if (typeof values[id] === 'number') out[id] = wander(values[id], `${group}.${id}`, t, seed);
  return out;
}
