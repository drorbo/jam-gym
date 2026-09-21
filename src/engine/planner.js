// Chorus planner: decides the key and tempo of each chorus.
//
// It is a pure function of (previous chorus state, settings, seed) so that
//   - the UI can preview "what's coming next" without side effects,
//   - random modes are reproducible in tests,
//   - key changes and tempo ramps combine freely (they are evaluated independently).

import { createRng, hashSeed } from './rng.js';

export const MIN_BPM = 40;
export const MAX_BPM = 220;

/** Semitone -> interval name (upwards). */
export const INTERVAL_NAMES = {
  0: 'unison',
  1: 'minor 2nd',
  2: 'major 2nd',
  3: 'minor 3rd',
  4: 'major 3rd',
  5: 'perfect 4th',
  6: 'tritone',
  7: 'perfect 5th',
  8: 'minor 6th',
  9: 'major 6th',
  10: 'minor 7th',
  11: 'major 7th',
};

export const RANDOM_MODES = [
  { id: 'no-repeat', label: 'Random, never the same twice' },
  { id: 'any', label: 'Completely random' },
  { id: 'shuffle', label: 'All 12 keys in random order' },
  { id: 'fifths', label: 'Circle of fifths' },
  { id: 'fourths', label: 'Circle of fourths' },
  { id: 'chromatic', label: 'Chromatic (up a semitone)' },
];

/** Describe a signed semitone interval, e.g. 2 -> "+2 semitones (major 2nd up)". */
export function describeInterval(semitones) {
  const abs = Math.abs(semitones);
  const name = INTERVAL_NAMES[abs % 12] ?? `${abs} semitones`;
  const dir = semitones < 0 ? 'down' : 'up';
  const sign = semitones < 0 ? '−' : '+';
  return `${sign}${abs} semitone${abs === 1 ? '' : 's'} (${name} ${dir})`;
}

export const clampBpm = (bpm) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));

/**
 * @typedef {Object} ChorusState
 * @property {number} chorus  1-based chorus number
 * @property {number} keyPc   tonic pitch class of this chorus
 * @property {number} bpm
 * @property {number[]|null} bag  remaining keys in "shuffle" mode
 */

/** @returns {ChorusState} */
export const initialChorusState = (keyPc, bpm) => ({ chorus: 1, keyPc, bpm: clampBpm(bpm), bag: null });

function pickRandomKey(mode, state, rng) {
  const cur = state.keyPc;
  switch (mode) {
    case 'any':
      return { keyPc: rng.int(12), bag: state.bag };
    case 'shuffle': {
      let bag;
      if (state.bag === null) {
        // first round: the starting key has already been played
        bag = rng.shuffle([...Array(12).keys()].filter((k) => k !== cur));
      } else if (state.bag.length === 0) {
        // later rounds: all 12, but never open on the key we're already in
        bag = rng.shuffle([...Array(12).keys()]);
        if (bag[0] === cur) [bag[0], bag[11]] = [bag[11], bag[0]];
      } else {
        bag = [...state.bag];
      }
      const keyPc = bag.shift();
      return { keyPc, bag };
    }
    case 'fifths': return { keyPc: (cur + 7) % 12, bag: state.bag };
    case 'fourths': return { keyPc: (cur + 5) % 12, bag: state.bag };
    case 'chromatic': return { keyPc: (cur + 1) % 12, bag: state.bag };
    case 'no-repeat':
    default: {
      const keyPc = (cur + 1 + rng.int(11)) % 12;
      return { keyPc, bag: state.bag };
    }
  }
}

/**
 * Compute the state of the chorus that follows `state`.
 *
 * @param {ChorusState} state  the chorus that just finished
 * @param {{modulation: object, tempoRamp: object}} settings
 * @param {number} seed        session seed
 * @returns {ChorusState}
 */
export function nextChorusState(state, settings, seed) {
  const done = state.chorus; // number of choruses completed
  const { modulation: mod, tempoRamp: ramp } = settings;
  let { keyPc, bpm, bag } = state;

  const every = (n) => done % Math.max(1, Math.floor(n || 1)) === 0;

  if (mod && mod.type !== 'off' && every(mod.everyLoops)) {
    if (mod.type === 'interval') {
      keyPc = (((keyPc + (mod.interval || 0)) % 12) + 12) % 12;
    } else if (mod.type === 'random') {
      const rng = createRng(hashSeed(seed, done, 0x6b657931));
      ({ keyPc, bag } = pickRandomKey(mod.randomMode, state, rng));
    }
  }

  if (ramp && ramp.enabled && every(ramp.everyLoops)) {
    // never slows down: if we're already past the cap, the ramp simply holds the tempo
    bpm = clampBpm(Math.max(bpm, Math.min(ramp.maxBpm ?? MAX_BPM, bpm + (ramp.increment || 0))));
  }

  return { chorus: done + 1, keyPc, bpm, bag };
}

/** Convenience for tests and previews: the first `count` chorus states. */
export function simulateChoruses(start, settings, seed, count) {
  const out = [start];
  for (let i = 1; i < count; i++) out.push(nextChorusState(out[i - 1], settings, seed));
  return out;
}
