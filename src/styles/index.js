// Style registry + the one function that turns a style and a bar into note events.
//
// A style is plain data plus generator functions:
//   {
//     id, name, description,
//     defaultTempo, timeSignatures: ['4/4'],
//     feel:     { name, swing: number | (bpm) => number },   // 0.5 = straight, 0.667 = triplet swing
//     humanize: { drums: {t, v, lay}, bass: {...}, chords: {...} },
//     timbres:  { drums, bass, chords },                     // sound choices for the audio layer
//     bass, comp, kit: { ... },                              // optional: starting points for the Bass line, Keys and Drums panels
//                                                            // (the fields are listed in settings.js)
//     parts:    { drums(ctx), bass(ctx), chords(ctx) },      // each returns note events
//   }
// Add a style by writing one of these and calling registerStyle(). The UI lists the registry.

import { applyFeel, clampSwing, humanize } from '../engine/feel.js';
import { getMeter } from '../theory/meter.js';
import { blues } from './blues.js';
import { jazz } from './jazz.js';
import { rock } from './rock.js';
import { DEFAULT_BASS, DEFAULT_COMP, DEFAULT_KIT, resolveMix, sanitizeBass, sanitizeComp, sanitizeKit } from './settings.js';

const registry = new Map();

export function registerStyle(style) {
  for (const key of ['id', 'name', 'defaultTempo', 'feel', 'parts', 'timbres']) {
    if (!(key in style)) throw new Error(`Style is missing "${key}"`);
  }
  registry.set(style.id, style);
  return style;
}

/** Sounds a user can pick for drums, bass and the chord instrument. `sampled` ones are recordings (see ./samples). */
export const DRUM_SOUNDS = [
  { id: 'jazz', name: 'Jazz kit', sampled: true },
  { id: 'rock', name: 'Rock kit', sampled: true },
  { id: 'electronic', name: 'Electronic drums', sampled: false },
];
export const BASS_SOUNDS = [
  { id: 'double', name: 'Double bass', sampled: true },
  { id: 'guitar', name: 'Bass guitar', sampled: true },
  { id: 'bright', name: 'Bass guitar (bright)', sampled: true },
  { id: 'upright', name: 'Upright (synth)', sampled: false },
  { id: 'electric', name: 'Electric bass (synth)', sampled: false },
  { id: 'pick', name: 'Pick bass (synth)', sampled: false },
];
export const KEY_SOUNDS = [
  { id: 'piano', name: 'Grand piano', sampled: true },
  { id: 'wurli', name: 'Wurlitzer', sampled: true },
  { id: 'epiano', name: 'Electric piano (synth)', sampled: false },
  { id: 'organ', name: 'Organ (synth)', sampled: false },
  { id: 'guitar', name: 'Guitar (synth)', sampled: false },
];

/**
 * The timbres to play with: the style's defaults, overridden by the user's choices.
 * @param {{drums?: string, bass?: string, keys?: string}} [sounds]  'auto' (or missing) means "the style's own"
 */
export function resolveTimbres(style, sounds = {}) {
  const pick = (choice, list, fallback) => (list.some((s) => s.id === choice) ? choice : fallback);
  return {
    ...style.timbres,
    drums: pick(sounds.drums, DRUM_SOUNDS, style.timbres.drums),
    bass: pick(sounds.bass, BASS_SOUNDS, style.timbres.bass),
    chords: pick(sounds.keys, KEY_SOUNDS, style.timbres.chords),
  };
}

/**
 * The swing percentage a style starts with (what choosing the style sets the slider to).
 * Jazz eases off as the tempo rises, so this depends on the tempo it will be played at.
 */
export function defaultSwing(style, bpm) {
  const ratio = typeof style.feel.swing === 'function' ? style.feel.swing(bpm) : style.feel.swing;
  return clampSwing(ratio * 100);
}

/** The settings a style starts with (what choosing the style sets each panel to). */
export const defaultBass = (style) => sanitizeBass(style.bass, DEFAULT_BASS);
export const defaultComp = (style) => sanitizeComp(style.comp, DEFAULT_COMP);
export const defaultKit = (style) => sanitizeKit(style.kit, DEFAULT_KIT);

export const getStyle = (id) => registry.get(id) ?? registry.get('jazz');
export const listStyles = () => [...registry.values()];

[jazz, blues, rock].forEach(registerStyle);

/**
 * @typedef {Object} BarContext
 * @property {import('../theory/progression.js').Segment[]} segments chords in this bar
 * @property {import('../theory/chord.js').Chord|null} nextChord  first chord of the following bar (if any)
 * @property {number} barIndex 0-based bar within the chorus
 * @property {number} barCount
 * @property {boolean} isFirstBar
 * @property {boolean} isLastBar
 * @property {number} chorus 1-based
 * @property {number} bpm
 * @property {import('../theory/meter.js').Meter} meter
 * @property {number} beatsPerBar  bar length in quarter notes
 * @property {object} state  per-run memory owned by the style (voice-leading etc.)
 * @property {Record<string,string>} [timbres] sound choices (defaults to the style's own)
 * @property {number} [swing] user swing, 0.5 (straight) to 0.75 (hard); omitted = the style's own feel. 4/4 only.
 * @property {object} [bass] user bass-line settings; omitted = the style's own (fields in settings.js)
 * @property {object} [comp] user keys settings, the same way
 * @property {object} [kit] user drums settings, the same way
 * @property {number} [seed] the run's seed, so mixed sliders wander differently in different runs
 * @property {ReturnType<typeof defaultBass>} [bassOpts] the settings above, checked and merged over the style's defaults
 * @property {ReturnType<typeof defaultComp>} [compOpts]
 * @property {ReturnType<typeof defaultKit>} [kitOpts]
 * @property {ReturnType<import('../engine/rng.js').createRng>} rng
 */

/** Dynamics: 0 to 100 -> a velocity multiplier (1 at the middle, 0.7 softest, 1.3 hardest). */
const dynamics = (v) => 0.7 + 0.006 * v;

/** Bass note length: 0 to 100 -> 0.35 (staccato) .. 1 (as written) .. 1.55 (legato). */
const lengthFactor = (v) => (v <= 50 ? 0.35 + 0.013 * v : 1 + 0.011 * (v - 50));

/**
 * The settings that apply to whole instruments after the parts have played: how hard (drums, keys) and how long
 * (bass notes). Both are 1 at the middle, so a style at its defaults is untouched.
 */
function shapeEvents(events, ctx) {
  const { kitOpts, compOpts, bassOpts } = ctx;
  const vel = { drums: kitOpts.power, chords: compOpts.power };
  let out = events.map((e) => (vel[e.inst] !== undefined && vel[e.inst] !== 50
    ? { ...e, vel: Math.min(1, Math.max(0.02, e.vel * dynamics(vel[e.inst]))) } : e));
  if (bassOpts.length !== 50) {
    const f = lengthFactor(bassOpts.length);
    const bar = ctx.beatsPerBar ?? 4;
    const bass = out.filter((e) => e.inst === 'bass').sort((a, b) => a.beat - b.beat);
    const changed = new Map();
    bass.forEach((e, i) => {
      if (e.ghost) return;
      const next = bass.slice(i + 1).find((n) => n.beat > e.beat + 1e-6);
      const room = (next ? next.beat : bar + 0.5) - e.beat;
      const dur = f < 1 ? Math.max(0.06, e.dur * f) : Math.max(e.dur, Math.min(e.dur * f, room));
      changed.set(e, { ...e, dur });
    });
    out = out.map((e) => changed.get(e) ?? e);
  }
  return out;
}

/** Humanising per instrument: the style's own, widened or narrowed by Feel, and shifted by Timing (behind or ahead). */
function humanizeFor(style, ctx) {
  const cfg = {};
  for (const [inst, o] of [['drums', ctx.kitOpts], ['bass', ctx.bassOpts], ['chords', ctx.compOpts]]) {
    const base = style.humanize?.[inst];
    if (!base && o.loose === 50 && o.pocket === 50) continue;
    const looseness = o.loose / 50;
    cfg[inst] = {
      t: (base?.t ?? 0.003) * looseness,
      v: (base?.v ?? 0.06) * looseness,
      lay: (base?.lay ?? 0) + (o.pocket - 50) * 0.0003, // +late: up to 15 ms either way
    };
  }
  return cfg;
}

/**
 * Note events for one bar. Beats are floats from the bar start, already swung and humanised.
 * @param {ReturnType<typeof getStyle>} style
 * @param {BarContext} ctx
 */
export function renderBar(style, ctx) {
  if (!ctx.meter) ctx = { ...ctx, meter: getMeter('4/4') }; // callers may omit the meter: 4/4 is the default
  // Swing re-times eighths inside a beat. The /8 meters get their lilt from their 3+2 groupings instead.
  // The user's swing percentage (ctx.swing, 0.5-0.75) wins; without one the style's own feel applies.
  const isFour = !ctx.meter || ctx.meter.id === '4/4';
  const styleSwing = typeof style.feel.swing === 'function' ? style.feel.swing(ctx.bpm) : style.feel.swing;
  const swing = !isFour ? 0.5 : Number.isFinite(ctx.swing) ? clampSwing(ctx.swing * 100) / 100 : styleSwing;
  // the settings this bar is played with: checked, then any mixed sliders moved to where they have wandered to by now
  const where = { chorus: ctx.chorus, barIndex: ctx.barIndex, barCount: ctx.barCount, seed: ctx.seed };
  ctx = {
    ...ctx,
    bassOpts: resolveMix('bass', sanitizeBass(ctx.bass, defaultBass(style)), where),
    compOpts: resolveMix('comp', sanitizeComp(ctx.comp, defaultComp(style)), where),
    kitOpts: resolveMix('kit', sanitizeKit(ctx.kit, defaultKit(style)), where),
  };
  let events = [];
  for (const part of Object.values(style.parts)) events.push(...part(ctx));
  events = applyFeel(events, swing);
  events = shapeEvents(events, ctx);
  events = humanize(events, humanizeFor(style, ctx), ctx.rng);
  const timbres = ctx.timbres ?? style.timbres;
  events = events.map((e) => ({ ...e, timbre: timbres[e.inst] }));
  return events.sort((a, b) => a.beat - b.beat);
}
