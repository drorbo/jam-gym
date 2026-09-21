// Keys: a tonic pitch class plus major/minor mode. String form is "Eb" or "Ebm".

import { FLAT_NAMES, SHARP_NAMES, mod12, parseNoteName } from './notes.js';

export const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const MINOR_KEYS = MAJOR_KEYS.map((k) => `${k}m`);

// Keys whose signature is spelled with flats. F#/Gb is spelled with sharps.
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]);
const FLAT_MINOR = new Set([0, 2, 5, 7, 10, 3]);

/**
 * @param {string} key e.g. "C", "Bb", "F#m"
 * @returns {{pc:number, minor:boolean}|null}
 */
export function parseKey(key) {
  const m = /^([A-Ga-g][#♯b♭]?)(m|min|minor)?$/.exec(String(key).trim());
  if (!m) return null;
  const pc = parseNoteName(m[1]);
  return pc === null ? null : { pc, minor: Boolean(m[2]) };
}

export function keyPrefersFlats(pc, minor = false) {
  return (minor ? FLAT_MINOR : FLAT_MAJOR).has(mod12(pc));
}

export function formatKey(pc, minor = false) {
  const name = (keyPrefersFlats(pc, minor) ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
  return minor ? `${name}m` : name;
}

export function transposeKey(key, semitones) {
  const k = parseKey(key);
  if (!k) throw new Error(`Invalid key: ${key}`);
  return formatKey(k.pc + semitones, k.minor);
}
