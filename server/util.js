// Small helpers: ids, hashing, time, JSON. No dependencies.

import { createHash, randomBytes } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// Crockford base32: no I, L, O, U, so codes are easy to read out and type.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A random URL-safe id of `length` characters (unbiased: rejection sampling on bytes). */
export function randomId(length = 10, alphabet = BASE62) {
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

/** A 160-bit session secret as 32 Crockford base32 characters. */
export function newSecret() {
  return randomId(32, CROCKFORD);
}

/** Normalise what a user typed as a recovery code: strip separators and spaces, upper-case, fix look-alikes. */
export function normalizeSecret(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export const isSecret = (s) => typeof s === 'string' && s.length === 32 && [...s].every((c) => CROCKFORD.includes(c));

/** "ABCD-EFGH-..." for showing a secret to a person. */
export const formatSecret = (s) => s.match(/.{1,4}/g).join('-');

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export const now = () => Date.now();

/** Trim, collapse whitespace, drop control characters, and cap the length (by characters, not bytes). */
export function cleanText(value, max, { multiline = false } = {}) {
  let s = String(value ?? '').normalize('NFC');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '');
  s = multiline ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return [...s.trim()].slice(0, max).join('');
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (message, code = 'bad_request') => new HttpError(400, code, message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
