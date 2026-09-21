// Progression text <-> structured bars.
//
// Text format:  "Cmaj7 | Am7 | Dm7 G7 | %"
//   |  or a newline  separates bars           (repeat signs like |: :| are tolerated)
//   spaces separate chords inside a bar     (chords share the bar's beats evenly)
//   %                                        repeat the previous bar
//   NC / N.C.                                no chord (drums keep going)

import { transposeChord, tryParseChord } from './chord.js';
import { getMeter } from './meter.js';

/**
 * @typedef {Object} Segment   One chord occupying part of a bar.
 * @property {import('./chord.js').Chord|null} chord  null = no chord
 * @property {number} startBeat  position within the bar, in quarter notes
 * @property {number} beats      length, in quarter notes
 *
 * @typedef {Object} Bar
 * @property {number} index
 * @property {string} source     text form of the bar ("Dm7 G7", or "%")
 * @property {Segment[]} chords
 */

/** Split `beatsPerBar` beats across `n` chords; the earliest chords get the extra beats. */
export function allocateBeats(n, beatsPerBar) {
  const base = Math.floor(beatsPerBar / n);
  const extra = beatsPerBar - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Where each of `n` chords sits in a bar: chords share the bar's beat groups, earlier chords getting the extras.
 * 4/4 (four groups of one beat): 3 chords -> 2+1+1 beats.  7/8 (3+2+2): 2 chords -> 3+2 | 2 eighths.
 * @returns {{startBeat:number, beats:number}[]} in quarter notes
 */
export function allocateSegments(n, meter) {
  let g = 0;
  return allocateBeats(n, meter.groups.length).map((count) => {
    const spans = meter.groupSpans.slice(g, g + count);
    g += count;
    return { startBeat: spans[0].start, beats: spans.reduce((sum, x) => sum + x.len, 0) };
  });
}

const isNoChord = (t) => /^(n\.?c\.?|nc)$/i.test(t);

/** Split raw text into bar strings. */
export function splitBars(input) {
  const text = Array.isArray(input) ? input.join(' | ') : String(input ?? '');
  return text
    .replace(/[‖:]/g, '|')
    .split(/[|\r\n]+/)
    .map((s) => s.replace(/,/g, ' ').trim())
    .filter(Boolean);
}

export const formatSegments = (segments) =>
  segments.map((s) => (s.chord ? s.chord.symbol : 'NC')).join(' ');

/**
 * @param {string|string[]} input progression text, or an array of bar strings
 * @param {{timeSignature?: string}} [opts]
 * @returns {{bars: Bar[], errors: {bar:number, token:string, message:string}[], ok: boolean}}
 */
export function parseProgression(input, { timeSignature = '4/4' } = {}) {
  const meter = getMeter(timeSignature);
  const maxChords = meter.groups.length;
  /** @type {Bar[]} */
  const bars = [];
  const errors = [];

  splitBars(input).forEach((source) => {
    const index = bars.length;
    const tokens = source.split(/\s+/);

    if (tokens.length === 1 && tokens[0] === '%') {
      const prev = bars[index - 1];
      if (!prev) {
        errors.push({ bar: index, token: '%', message: 'The first bar cannot repeat a previous bar' });
        return;
      }
      bars.push({ index, source: '%', chords: prev.chords.map((s) => ({ ...s })) });
      return;
    }
    if (tokens.length > maxChords) {
      errors.push({
        bar: index, token: source,
        message: `Bar ${index + 1} has ${tokens.length} chords, but ${timeSignature} fits at most ${maxChords}`,
      });
      return;
    }

    const chords = [];
    let ok = true;
    for (const token of tokens) {
      if (isNoChord(token)) { chords.push(null); continue; }
      const r = tryParseChord(token);
      if ('error' in r) {
        errors.push({ bar: index, token, message: `Bar ${index + 1}: ${r.error}` });
        ok = false;
        break;
      }
      chords.push(r.chord);
    }
    if (!ok) return;

    const places = allocateSegments(chords.length, meter);
    const segments = chords.map((chord, i) => ({ chord, ...places[i] }));
    bars.push({ index, source: formatSegments(segments), chords: segments });
  });

  return { bars, errors, ok: errors.length === 0 && bars.length > 0 };
}

/** Transpose parsed bars. Returns new bars; the input is not modified. */
export function transposeBars(bars, semitones, preferFlats = false) {
  return bars.map((bar) => {
    const chords = bar.chords.map((s) => ({
      ...s,
      chord: s.chord ? transposeChord(s.chord, semitones, preferFlats) : null,
    }));
    return { ...bar, chords, source: bar.source === '%' ? '%' : formatSegments(chords) };
  });
}

/**
 * Transpose progression *text*, leaving layout (bar lines, line breaks, spacing) and
 * anything that isn't a chord untouched. Used when the user changes the starting key.
 */
export function transposeProgressionText(text, semitones, preferFlats = false) {
  return text.replace(/[^\s|,‖:]+/g, (token) => {
    const r = tryParseChord(token);
    return 'error' in r ? token : transposeChord(r.chord, semitones, preferFlats).symbol;
  });
}
