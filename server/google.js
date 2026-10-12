// "Continue with Google": Google's OpenID Connect authorization-code flow, with PKCE. Nothing here talks to eardle.
//
// Jam Gym asks Google for the `openid` scope only, so all it ever learns is the person's Google account id (`sub`): no name,
// no email, no photo. (That also keeps a real name from ending up on a public profile; the display name stays `Player-xxxx`
// until the person chooses one.) The id is kept in users.google_sub and is what makes the same Google account open the same
// library on every device.
//
// The flow: /api/auth/google/start puts a random state, nonce and PKCE verifier in a short-lived HttpOnly cookie and sends the
// browser to Google; Google sends it back to /api/auth/google/callback with a one-time `code`; the server swaps the code (with
// the client secret and the PKCE verifier) for an ID token straight from Google over TLS, and checks the token's issuer,
// audience, expiry and nonce. Because the token comes directly from Google's token endpoint over TLS, its signature need not
// be checked as well (OpenID Connect Core, 3.1.3.7).

import { createHash, randomBytes } from 'node:crypto';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const SKEW = 60; // seconds

/** A PKCE pair: a random verifier, and its SHA-256 challenge. */
export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Where to send the browser to sign in with Google. */
export function authorizeUrl(google, { state, nonce, challenge }) {
  const u = new URL(google.authUrl);
  u.search = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: google.redirectUri,
    response_type: 'code',
    scope: 'openid',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account', // always let the person pick the account, rather than silently using whichever is signed in
  }).toString();
  return u.toString();
}

/** The claims of an ID token, once checked against what this sign-in was started with. Throws a short reason when not. */
export function checkIdToken(idToken, { clientId, nonce, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const parts = String(idToken ?? '').split('.');
  if (parts.length !== 3) throw new Error('malformed');
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw new Error('malformed'); }
  if (!claims || typeof claims !== 'object') throw new Error('malformed');
  if (!ISSUERS.has(claims.iss)) throw new Error('wrong issuer');
  if (claims.aud !== clientId) throw new Error('wrong audience');
  if (!Number.isInteger(claims.exp) || claims.exp < nowSeconds - SKEW) throw new Error('expired');
  if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) throw new Error('wrong nonce');
  if (typeof claims.sub !== 'string' || !/^[0-9]{1,30}$/.test(claims.sub)) throw new Error('bad subject');
  return { sub: claims.sub };
}

/**
 * Swap the one-time code for the person's Google id.
 * @returns {Promise<{sub: string}>}
 * @throws {Error} when Google refuses the code or the token cannot be trusted
 */
export async function exchangeCode(google, { code, verifier, nonce }, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(google.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: google.clientId,
      client_secret: google.clientSecret,
      redirect_uri: google.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
  const body = await res.json();
  return checkIdToken(body.id_token, { clientId: google.clientId, nonce });
}
