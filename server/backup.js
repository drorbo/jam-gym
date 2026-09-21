// Daily database snapshots using SQLite's online backup (safe while the server is running; no cron needed).

import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { backup } from 'node:sqlite';

const PATTERN = /^jamgym-\d{8}-\d{4}\.sqlite$/;

const stamp = (d) => {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
};

export const listBackups = (dir) => {
  try { return readdirSync(dir).filter((f) => PATTERN.test(f)).sort(); } catch { return []; }
};

/**
 * Write a snapshot into `dir` and delete the oldest beyond `keep`.
 * @returns {Promise<string>} the new file's path
 */
export async function snapshot(db, dir, keep = 14, date = new Date()) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `jamgym-${stamp(date)}.sqlite`);
  await backup(db, file);
  const all = listBackups(dir);
  for (const old of all.slice(0, Math.max(0, all.length - keep))) unlinkSync(join(dir, old));
  return file;
}

/** Snapshot at start-up if the last one is over `everyHours` old, then keep checking. Returns a stop function. */
export function scheduleBackups(db, dir, { keep = 14, everyHours = 24, log = console.log } = {}) {
  const due = () => {
    const last = listBackups(dir).at(-1);
    return !last || Date.now() - statSync(join(dir, last)).mtimeMs > everyHours * 3600_000;
  };
  const run = async () => {
    try {
      if (due()) log(`backup written: ${await snapshot(db, dir, keep)}`);
    } catch (err) {
      console.error('Backup failed:', err.message);
    }
  };
  run();
  const timer = setInterval(run, 6 * 3600_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
