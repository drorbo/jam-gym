// Runtime configuration, read from environment variables so the same code runs locally and in Docker.

import { resolve } from 'node:path';

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
    backupKeep: Number(env.BACKUP_KEEP) || 28,
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
  reason: 300,
  dataBytes: 16 * 1024,
  bodyBytes: 32 * 1024,
  progressionChars: 4000,
  maxBars: 200,
  presetBodyBytes: 192 * 1024,
  presetDeletions: 300,
  tracksPerUser: 200,
  publishedPerUser: 50,
  browsePageMax: 50,
  browsePageDefault: 20,
  autoHideReports: 3,
});
