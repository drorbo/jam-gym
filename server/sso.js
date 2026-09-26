// "Sign in with eardle": the token eardle hands back after it has checked who someone is.
//
// eardle (https://eardle.com, the sibling project) owns the accounts; Jam Gym never sees a password or an email. After
// eardle has signed the person in it redirects here with a short-lived signed token that says "this is eardle user N".
// The token is an HMAC-SHA256 over its payload with a secret both sites hold (EARDLE_SSO_SECRET here, JAMGYM_SSO_SECRET
// there, the same value). The eardle side is `lib/jamGymSso.ts` in the eardle repo: keep the two formats identical.
//
//   token   = "v1." + base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, "v1." + base64url(JSON payload)))
//   payload = { aud: "jam-gym", sub: "<eardle user id>", name?: "<nickname>", state: "<from us>", iat, exp }  (times in seconds)

import { createHmac, timingSafeEqual } from 'node:crypto';

const AUDIENCE = 'jam-gym';
const MAX_LIFETIME = 10 * 60; // seconds; eardle issues 2-minute tokens, anything claiming longer is refused
const SKEW = 60;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const mac = (secret, text) => createHmac('sha256', secret).update(text).digest();

/** Make a token. Used by tests; eardle has its own copy of this in TypeScript. */
export function signToken(secret, { sub, name, state, iat = Math.floor(Date.now() / 1000), ttl = 120, aud = AUDIENCE }) {
  const body = `v1.${b64(JSON.stringify({ aud, sub: String(sub), ...(name ? { name } : {}), state, iat, exp: iat + ttl }))}`;
  return `${body}.${b64(mac(secret, body))}`;
}

/**
 * Check a token against the secret and the state we put in this browser's cookie.
 * @returns {{sub: string, name: string}} the person it names
 * @throws {Error} with a short reason when the token cannot be trusted
 */
export function verifyToken(secret, token, expectedState, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('not configured');
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('malformed');
  const body = `${parts[0]}.${parts[1]}`;
  const given = Buffer.from(parts[2], 'base64url');
  const wanted = mac(secret, body);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw new Error('bad signature');
  let p;
  try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw new Error('malformed'); }
  if (!p || p.aud !== AUDIENCE) throw new Error('wrong audience');
  if (!Number.isInteger(p.iat) || !Number.isInteger(p.exp)) throw new Error('malformed');
  if (p.exp < nowSeconds - SKEW) throw new Error('expired');
  if (p.iat > nowSeconds + SKEW || p.exp - p.iat > MAX_LIFETIME) throw new Error('bad times');
  if (!expectedState || typeof p.state !== 'string' || p.state.length !== expectedState.length
    || !timingSafeEqual(Buffer.from(p.state), Buffer.from(expectedState))) throw new Error('wrong state');
  if (typeof p.sub !== 'string' || !/^[0-9]{1,18}$/.test(p.sub)) throw new Error('bad subject');
  return { sub: p.sub, name: typeof p.name === 'string' ? p.name : '' };
}
