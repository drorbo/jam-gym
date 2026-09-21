// Chord symbol parsing, analysis and transposition.
//
// A parsed chord keeps its *relative* structure (intervals above the root) separate from
// its spelling, so transposing is just "move root/bass, re-spell, keep the suffix".

import { FLAT_NAMES, SHARP_NAMES, asciiAccidentals, mod12, parseNoteName } from './notes.js';

/**
 * @typedef {Object} Chord
 * @property {string} symbol      Rendered symbol, e.g. "Bbmaj7/D"
 * @property {number} root        Root pitch class
 * @property {string} rootName    Spelled root, e.g. "Bb"
 * @property {number|null} bass   Slash-bass pitch class (or null)
 * @property {string|null} bassName
 * @property {string} suffix      Quality as the user typed it, e.g. "maj7", "m7b5"
 * @property {'major'|'minor'|'dominant'|'halfdim'|'dim'|'aug'|'sus'|'power'} family
 * @property {number|null} third    semitones above root (4, 3, 2/5 for sus, null for power chords)
 * @property {number|null} fifth
 * @property {number|null} seventh  11 = major 7th, 10 = minor 7th, 9 = diminished 7th
 * @property {boolean} sixth
 * @property {number|null} ninth      13 = b9, 14 = 9, 15 = #9
 * @property {number|null} eleventh   17 = 11, 18 = #11
 * @property {number|null} thirteenth 20 = b13, 21 = 13
 * @property {number[]} pcs       Sorted pitch-class intervals above the root (0-11)
 */

const ROOT_RE = /^([A-Ga-g])([#♯b♭]?)/;
const BASS_RE = /\/([A-Ga-g][#♯b♭]?)$/;

function normalizeSuffix(raw) {
  let s = raw.replace(/[()\s]/g, '');
  s = asciiAccidentals(s).replace(/−/g, '-');
  s = s.replace(/6\/9/g, '69').replace(/ø7?/g, 'm7b5').replace(/°/g, 'dim');
  s = s.replace(/^o(?=\d|$)/, 'dim').replace(/\+/g, 'aug');
  return s;
}

/** Parse the quality part of a chord symbol (everything after the root, before any slash). */
function analyzeSuffix(raw) {
  const st = {
    third: 4, fifth: 7, seventh: null, sixth: false,
    ninth: null, eleventh: null, thirteenth: null,
    maj: false, dim: false, alt: false,
  };
  let s = normalizeSuffix(raw);
  let m;
  const eat = () => { s = s.slice(m[0].length); };
  const impliedSeventh = () => {
    if (st.seventh === null && !st.sixth) st.seventh = st.maj ? 11 : st.dim ? 9 : 10;
  };

  while (s.length) {
    if ((m = /^(maj|Maj|MAJ|M|Δ|\^)/.exec(s))) {
      st.maj = true; eat();
      if ((m[1] === 'Δ' || m[1] === '^') && !/^\d/.test(s)) st.seventh = 11;
    } else if ((m = /^(min|mi|m|-)/.exec(s))) {
      st.third = 3; eat();
    } else if ((m = /^dim/.exec(s))) {
      st.third = 3; st.fifth = 6; st.dim = true; eat();
    } else if ((m = /^aug/.exec(s))) {
      st.fifth = 8; eat();
    } else if ((m = /^sus(2|4)?/.exec(s))) {
      st.third = m[1] === '2' ? 2 : 5; eat();
    } else if ((m = /^add(2|4|6|9|11|13)/.exec(s))) {
      const n = Number(m[1]);
      if (n === 2 || n === 9) st.ninth = st.ninth ?? 14;
      else if (n === 4 || n === 11) st.eleventh = st.eleventh ?? 17;
      else if (n === 6) st.sixth = true;
      else st.thirteenth = st.thirteenth ?? 21;
      eat();
    } else if ((m = /^alt/.exec(s))) {
      st.alt = true; st.seventh = st.seventh ?? 10; st.fifth = 6; st.ninth = 13; eat();
    } else if ((m = /^(#|b)(5|9|11|13)/.exec(s))) {
      const sharp = m[1] === '#';
      const n = Number(m[2]);
      if (n === 5) st.fifth = sharp ? 8 : 6;
      else if (n === 9) st.ninth = sharp ? 15 : 13;
      else if (n === 11 && sharp) st.eleventh = 18;
      else if (n === 13 && !sharp) st.thirteenth = 20;
      else return { error: `Unsupported alteration "${m[0]}"` };
      eat();
    } else if ((m = /^(13|11|9|7|6|5)/.exec(s))) {
      const n = Number(m[1]);
      if (n === 5) st.third = null;
      else if (n === 6) st.sixth = true;
      else if (n === 7) impliedSeventh();
      else {
        impliedSeventh();
        if (n === 9) st.ninth = st.ninth ?? 14;
        if (n === 11) { st.ninth = st.ninth ?? 14; st.eleventh = st.eleventh ?? 17; }
        if (n === 13) { st.ninth = st.ninth ?? 14; st.thirteenth = st.thirteenth ?? 21; }
      }
      eat();
    } else {
      return { error: `Unrecognised chord quality "${s}"` };
    }
  }
  return { st };
}

function familyOf(st) {
  if (st.third === null) return 'power';
  if (st.third === 2 || st.third === 5) return 'sus';
  if (st.third === 3) {
    if (st.fifth === 6) return st.seventh === 10 ? 'halfdim' : 'dim';
    return 'minor';
  }
  if (st.seventh === 10) return 'dominant';
  if (st.fifth === 8 && st.seventh === null) return 'aug';
  return 'major';
}

function spell(pc, flats) {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

export function renderChordSymbol(rootName, suffix, bassName) {
  return `${rootName}${suffix}${bassName ? `/${bassName}` : ''}`;
}

/**
 * Parse a chord symbol.
 * @param {string} input e.g. "Cmaj7", "F#m7b5", "D7#9/F#", "Bb6/9"
 * @returns {{chord: Chord}|{error: string}}
 */
export function tryParseChord(input) {
  const text = String(input).trim();
  if (!text) return { error: 'Empty chord' };
  const flat69 = text.replace(/6\/9/g, '69');

  let body = flat69;
  let bassName = null;
  let bass = null;
  const bm = BASS_RE.exec(body);
  if (bm) {
    bass = parseNoteName(bm[1]);
    bassName = bm[1][0].toUpperCase() + asciiAccidentals(bm[1].slice(1));
    body = body.slice(0, bm.index);
  }

  const rm = ROOT_RE.exec(body);
  if (!rm) return { error: `"${text}" doesn't start with a note name (A-G)` };
  const rootName = rm[1].toUpperCase() + asciiAccidentals(rm[2]);
  const root = parseNoteName(rootName);
  const suffix = body.slice(rm[0].length).trim();

  const parsed = analyzeSuffix(suffix);
  if (parsed.error) return { error: `${parsed.error} in "${text}"` };
  const { st } = parsed;

  const pcs = new Set([0]);
  if (st.third !== null) pcs.add(st.third);
  pcs.add(st.fifth);
  if (st.sixth) pcs.add(9);
  if (st.seventh !== null) pcs.add(st.seventh);
  for (const v of [st.ninth, st.eleventh, st.thirteenth]) if (v !== null) pcs.add(v % 12);
  if (st.alt) { pcs.add(3); pcs.add(8); }

  /** @type {Chord} */
  const chord = {
    symbol: renderChordSymbol(rootName, suffix, bassName),
    root, rootName, bass, bassName, suffix,
    family: familyOf(st),
    third: st.third, fifth: st.fifth, seventh: st.seventh, sixth: st.sixth,
    ninth: st.ninth, eleventh: st.eleventh, thirteenth: st.thirteenth,
    pcs: [...pcs].sort((a, b) => a - b),
  };
  return { chord };
}

/** Like tryParseChord but throws. Handy in tests and scripts. */
export function parseChord(input) {
  const r = tryParseChord(input);
  if ('error' in r) throw new Error(r.error);
  return r.chord;
}

/**
 * Transpose a chord musically: the structure is untouched, the root/bass move and are re-spelled.
 * A zero shift keeps the spelling the user typed.
 * @param {Chord} chord
 * @param {number} semitones
 * @param {boolean} preferFlats spell accidentals as flats (usually derived from the destination key)
 */
export function transposeChord(chord, semitones, preferFlats = false) {
  if (mod12(semitones) === 0) return chord;
  const root = mod12(chord.root + semitones);
  const rootName = spell(root, preferFlats);
  const bass = chord.bass === null ? null : mod12(chord.bass + semitones);
  const bassName = bass === null ? null : spell(bass, preferFlats);
  return {
    ...chord,
    root, rootName, bass, bassName,
    symbol: renderChordSymbol(rootName, chord.suffix, bassName),
  };
}

/** Absolute pitch classes (0-11) of the chord tones. */
export const absolutePcs = (chord) => chord.pcs.map((i) => mod12(chord.root + i));

/** Split a chord into display parts, with typographic accidentals. */
export function chordParts(chord) {
  const pretty = (s) => s.replace(/b(?=\d)/g, '♭').replace(/#/g, '♯');
  const acc = (name) => name.slice(1).replace('b', '♭').replace('#', '♯');
  return {
    letter: chord.rootName[0],
    accidental: acc(chord.rootName),
    suffix: pretty(chord.suffix),
    bassLetter: chord.bassName ? chord.bassName[0] : '',
    bassAccidental: chord.bassName ? acc(chord.bassName) : '',
  };
}
