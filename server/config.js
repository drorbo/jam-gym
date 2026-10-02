// Runtime configuration, read from environment variables so the same code runs locally and in Docker.

import { resolve } from 'node:path';

const MIN_SSO_SECRET_LENGTH = 32;

function eardleSecret(raw) {
  const secret = raw || '';
  if (secret && secret.length < MIN_SSO_SECRET_LENGTH) {
    console.warn(`EARDLE_SSO_SECRET is only ${secret.length} characters (want at least ${MIN_SSO_SECRET_LENGTH}); ` +
      'treating "sign in with eardle" as switched off rather than run with a weak secret.');
    return '';
  }
  return secret;
}

/**
 * @param {Record<string,string|undefined>} env
 */
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return {
    production,
    port: Number(env.PORT) || 5173,
    // Locally, listen only on this machine. Docker sets HOST=0.0.0.0 (the published port is bound to 127.0.0.1 on the host).
    host: env.HOST || '127.0.0.1',
    dataDir: resolve(env.DATA_DIR || 'data'),
    // Behind the host nginx / Cloudflare: believe X-Forwarded-Proto and CF-Connecting-IP. Safe only because the container's
    // port is published on the host's loopback, so only that nginx can reach it.
    trustProxy: env.TRUST_PROXY === '1',
    // Set to '1' to also snapshot the database daily (production does).
    backups: env.BACKUPS === '1',
    // "Sign in with eardle" (see server/sso.js and docs/eardle-accounts.md). Off unless the shared secret is set.
    // A short secret is easier to guess than the signature it is meant to protect is to forge, so one that looks
    // misconfigured (set, but not long enough to be a real generated secret) is treated the same as unset: the
    // feature turns itself off rather than run with a weak secret. scripts/setup-eardle-sso.sh generates 64 characters.
    eardle: { url: (env.EARDLE_URL || 'https://eardle.com').replace(/\/+$/, ''), secret: eardleSecret(env.EARDLE_SSO_SECRET) },
    backupKeep:Number(env.BACKUP_KEEP) || 28,
    // every this many hours (checked at start-up and every six hours after); a deploy also takes one by hand first
    backupEveryHours: Number(env.BACKUP_EVERY_HOURS) || 6,
  };
}

// Limits that appear in both the API and its tests.
export const LIMITS = Object.freeze({
  title: 80,
  description: 500,
  displayName: 24,
  displayNameMin: 2,
  dataBytes: 16 * 1024,
  bodyBytes: 32 * 1024,
  progressionChars: 4000,
  maxBars: 200,
  presetBodyBytes: 192 * 1024,
  presetDeletions: 300,
  // deletion markers are kept for 90 days (see server/presets.js) so a device that was offline doesn't resurrect a
  // deleted preset, but nothing stopped that from growing without bound: a sync can be replayed any number of times
  // (each within the 300-per-request presetDeletions limit) at up to 60 calls/minute. This caps it per person.
  presetTombstonesPerUser: 1000,
  tracksPerUser: 200,
  publishedPerUser: 50,
  browsePageMax: 50,
  browsePageDefault: 20,
  // A "sign in with eardle" session (server/users.js), for a device that isn't holding the person's own secret: it
  // expires after this long unused, and at most this many exist per person at once (oldest dropped to make room).
  sessionMaxAgeDays: 180,
  sessionCap: 20,
});
