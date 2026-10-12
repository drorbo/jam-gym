// Usernames and passwords. A password is never stored: only a salted scrypt hash of it (Node's own crypto, no packages).
// Checking one always does the same amount of work, whether or not the username exists, so the answer time does not
// reveal which usernames are taken.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { bad } from './util.js';

const scryptAsync = promisify(scrypt);
const N = 16384; // memory-hard: about 16 MB and a few dozen milliseconds per check
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** The username as it will be kept (the person's own capitalisation), or a 400. Names are unique ignoring case. */
export function checkUsername(value) {
  const name = String(value ?? '').trim();
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw bad(`A username is ${USERNAME_MIN}–${USERNAME_MAX} letters, numbers, dots, dashes or underscores.`, 'bad_username');
  }
  return name;
}

/** The password, or a 400 saying what is wrong with it. */
export function checkPassword(value, username = '') {
  if (typeof value !== 'string' || [...value].length < PASSWORD_MIN) throw bad(`A password needs at least ${PASSWORD_MIN} characters.`, 'bad_password');
  if ([...value].length > PASSWORD_MAX) throw bad(`A password can be up to ${PASSWORD_MAX} characters.`, 'bad_password');
  if (username && value.toLowerCase() === username.toLowerCase()) throw bad('The password cannot be the same as the username.', 'bad_password');
  return value;
}

/** "scrypt$N$r$p$salt$hash", everything needed to check the password later. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

let dummy = null; // what to check against when there is no such username, so that case takes as long as a real one

/** True when `password` matches `stored` (a hash from hashPassword). A null `stored` still costs a full check, then fails. */
export async function verifyPassword(password, stored) {
  if (!stored) dummy ??= await hashPassword('no such user');
  const [scheme, n, r, p, salt, hash] = (stored || dummy).split('$');
  if (scheme !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scryptAsync(String(password).slice(0, 4 * PASSWORD_MAX).normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(got, want) && Boolean(stored);
}
