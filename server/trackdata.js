// What a stored track is, and how untrusted input becomes one.
//
// The server reuses the app's own validators, so "valid" means exactly "the app can play it".

import { sanitize } from '../src/app/state.js';
import { tryParseChord } from '../src/theory/chord.js';
import { parseProgression } from '../src/theory/progression.js';
import { LIMITS } from './config.js';
import { bad, cleanText } from './util.js';

export const DATA_VERSION = 1;

/**
 * A chord's identity for searching: its root and pitch content (and slash bass), not how it was typed.
 * "Cm7", "C-7" and "Cmin7" are the same token; "Cm7" and "CM7" are not. Letters and digits only, so the
 * full-text tokenizer keeps it whole.
 */
export function chordToken(chord) {
  const bass = chord.bass !== null && chord.bass !== chord.root ? `b${chord.bass}` : '';
  return `r${chord.root}s${chord.pcs.join('z')}${bass}`;
}

/**
 * Validate and normalise the setup a client sends.
 * @param {unknown} raw  { v, song, config, mixer } as built by the app
 * @returns the sanitised payload plus the columns copied out of it for filtering and search
 */
export function prepareTrackData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('The track data is missing.');
  if (raw.v !== DATA_VERSION) throw bad(`Unsupported track format (expected version ${DATA_VERSION}).`);
  if (JSON.stringify(raw).length > LIMITS.dataBytes) throw bad('That track is too large.', 'too_large');

  const text = raw.song?.progressionText;
  if (typeof text !== 'string' || !text.trim()) throw bad('The track needs a chord progression.');
  if (text.length > LIMITS.progressionChars) throw bad('That progression is too long.', 'too_large');

  // sanitize() repairs odd values (out-of-range tempo, unknown style...) instead of failing, so nothing junk is stored.
  const state = sanitize({ song: raw.song, config: raw.config, mixer: raw.mixer });
  const { song, config, mixer } = state;
  const parsed = parseProgression(song.progressionText, { timeSignature: song.timeSignature });
  if (!parsed.ok) throw bad(parsed.errors[0]?.message ?? 'That progression cannot be played.');
  if (parsed.bars.length > LIMITS.maxBars) throw bad(`A track can have at most ${LIMITS.maxBars} bars.`);

  const symbols = [];
  const tokens = new Set();
  for (const bar of parsed.bars) {
    for (const seg of bar.chords) {
      if (!seg.chord) continue;
      if (!symbols.includes(seg.chord.symbol)) symbols.push(seg.chord.symbol);
      tokens.add(chordToken(seg.chord));
    }
  }

  return {
    data: { v: DATA_VERSION, song, config, mixer },
    style: config.style,
    key: song.key,
    timeSignature: song.timeSignature,
    tempo: song.tempo,
    bars: parsed.bars.length,
    chords: symbols.join(' ').slice(0, 600),
    chordTokens: [...tokens].join(' '),
  };
}

/** Title and description with the same cleaning everywhere. */
export function prepareText({ title, description }, { requireTitle = true } = {}) {
  const t = cleanText(title, LIMITS.title);
  if (requireTitle && !t) throw bad('Give the track a title.');
  return { title: t, description: cleanText(description, LIMITS.description, { multiline: true }) };
}

/**
 * Is this search word a chord symbol (as opposed to an ordinary word)? A bare root such as "A" or "Bb" is treated as
 * a word, so "Blues in A" searches titles; "Am", "G7" and "Dm7b5" are chords.
 * @returns {import('../src/theory/chord.js').Chord|null}
 */
export function asChordWord(word) {
  const r = tryParseChord(word);
  if ('error' in r) return null;
  const { chord } = r;
  return chord.suffix !== '' || chord.bass !== null ? chord : null;
}
