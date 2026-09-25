// Presets: a person's saved band settings, kept so their devices can share them. One call does everything: the client sends
// what it has (presets and deletions, each with the time it was last changed) and gets back the merged list.
//
// For every preset the latest change wins, whether it was an edit or a deletion. Deletions are kept as small markers for
// 90 days so a device that was offline does not bring a deleted preset back. The settings are checked with the app's own
// validator, so "valid" means "the band can play it".

import { MAX_PRESETS, cleanName, sanitizePresetSettings } from '../src/app/presets.js';
import { transaction } from './db.js';
import { LIMITS } from './config.js';
import { bad, now } from './util.js';

const ID = /^[A-Za-z0-9_-]{6,32}$/;
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DELETIONS = 90 * DAY;
const CLOCK_SLACK = 60 * 1000; // a device's clock may be a little ahead; a preset cannot be "changed" far in the future

/** @param {import('node:sqlite').DatabaseSync} db */
export function createPresets(db) {
  const one = db.prepare('SELECT updated_at, deleted FROM presets WHERE owner_id = ? AND id = ?');
  const liveCount = db.prepare('SELECT COUNT(*) AS c FROM presets WHERE owner_id = ? AND deleted = 0');
  const insert = db.prepare('INSERT INTO presets(owner_id, id, name, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?, 0)');
  const update = db.prepare('UPDATE presets SET name = ?, data = ?, updated_at = ?, deleted = 0 WHERE owner_id = ? AND id = ?');
  const tombstone = db.prepare(`INSERT INTO presets(owner_id, id, name, data, updated_at, deleted) VALUES (?, ?, '', '{}', ?, 1)
                                ON CONFLICT(owner_id, id) DO UPDATE SET name = '', data = '{}', updated_at = excluded.updated_at, deleted = 1
                                WHERE excluded.updated_at >= presets.updated_at`);
  const purge = db.prepare('DELETE FROM presets WHERE owner_id = ? AND deleted = 1 AND updated_at < ?');
  const all = db.prepare('SELECT id, name, data, updated_at, deleted FROM presets WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id');

  function list(user, skipped = 0) {
    const presets = [];
    const deleted = [];
    for (const r of all.all(user.id)) {
      if (r.deleted) deleted.push({ id: r.id, at: r.updated_at });
      else presets.push({ id: r.id, name: r.name, data: JSON.parse(r.data), updatedAt: r.updated_at });
    }
    return { presets, deleted, ...(skipped ? { skipped } : {}) };
  }

  return {
    list,

    /**
     * @param {object} user
     * @param {{presets?: {id: string, name: string, data: object, updatedAt: number}[], deleted?: {id: string, at: number}[]}} body
     */
    sync(user, body) {
      const incoming = body?.presets ?? [];
      const removed = body?.deleted ?? [];
      if (!Array.isArray(incoming) || !Array.isArray(removed)) throw bad('Send the presets and deletions as lists.');
      if (incoming.length > MAX_PRESETS * 2 || removed.length > LIMITS.presetDeletions) throw bad('That is too many presets.', 'too_large');
      const t = now();
      let skipped = 0;

      transaction(db, () => {
        for (const p of incoming) {
          const name = cleanName(p?.name);
          const at = Math.min(Number(p?.updatedAt), t + CLOCK_SLACK);
          if (!ID.test(String(p?.id)) || !name || !Number.isFinite(at)) continue; // junk is ignored, not an error
          const row = one.get(user.id, p.id);
          if (row && at <= row.updated_at) continue; // what the server has is newer (or the same)
          const data = JSON.stringify(sanitizePresetSettings(p.data));
          if (row && !row.deleted) { update.run(name, data, at, user.id, p.id); continue; }
          if (liveCount.get(user.id).c >= MAX_PRESETS) { skipped++; continue; }
          if (row) update.run(name, data, at, user.id, p.id); // an edit newer than the deletion brings it back
          else insert.run(user.id, p.id, name, data, at);
        }
        for (const d of removed) {
          const at = Math.min(Number(d?.at), t + CLOCK_SLACK);
          if (!ID.test(String(d?.id)) || !Number.isFinite(at)) continue;
          tombstone.run(user.id, d.id, at);
        }
        purge.run(user.id, t - KEEP_DELETIONS);
      });
      return list(user, skipped);
    },
  };
}
