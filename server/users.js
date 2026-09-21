// Anonymous identities. A user is a random secret held in a cookie; we keep only its hash.

import { transaction } from './db.js';
import { LIMITS } from './config.js';
import { reindex, unindex } from './search.js';
import { HttpError, bad, cleanText, formatSecret, isSecret, newSecret, normalizeSecret, now, randomId, sha256 } from './util.js';

const HOUR = 60 * 60 * 1000;
const PUBLIC_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** @param {import('node:sqlite').DatabaseSync} db */
export function createUsers(db) {
  const byHash = db.prepare('SELECT * FROM users WHERE secret_hash = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const touch = db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?');

  return {
    /** Create a new identity. Returns the row and the secret (shown once, put in the cookie). */
    create() {
      const secret = newSecret();
      const publicId = randomId(8, PUBLIC_ID_ALPHABET);
      const t = now();
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO users(public_id, secret_hash, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
      ).run(publicId, sha256(secret), `Player-${publicId.slice(0, 4)}`, t, t);
      return { user: byId.get(Number(lastInsertRowid)), secret };
    },

    /** The user for a cookie value, or null. Refreshes last_seen at most hourly (no write on every request). */
    findBySecret(secret) {
      if (!isSecret(secret)) return null;
      const user = byHash.get(sha256(secret));
      if (!user) return null;
      if (now() - user.last_seen_at > HOUR) touch.run(now(), user.id);
      return user;
    },

    /** Look up by a recovery code as a person typed it. */
    findByRecoveryCode(code) {
      const secret = normalizeSecret(code);
      const user = this.findBySecret(secret);
      return user ? { user, secret } : null;
    },

    recoveryCode: (secret) => formatSecret(secret),

    rename(user, name) {
      const clean = cleanText(name, LIMITS.displayName);
      if ([...clean].length < LIMITS.displayNameMin) throw bad(`A name needs at least ${LIMITS.displayNameMin} characters.`);
      transaction(db, () => {
        db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(clean, user.id);
        // published tracks carry the author's name in the search index
        const rows = db.prepare(`SELECT rowid, title, description, chord_tokens, visibility FROM tracks
                                 WHERE owner_id = ? AND visibility = 'published'`).all(user.id);
        for (const r of rows) reindex(db, { ...r, author: clean });
      });
      return byId.get(user.id);
    },

    /** Delete an identity and everything it owns, keeping other people's like counts correct. */
    deleteUser(user) {
      transaction(db, () => {
        for (const r of db.prepare('SELECT rowid FROM tracks WHERE owner_id = ?').all(user.id)) unindex(db, r.rowid);
        db.prepare(`UPDATE tracks SET like_count = like_count - 1
                    WHERE id IN (SELECT track_id FROM likes WHERE user_id = ?)`).run(user.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id); // cascades to tracks, likes, reports
      });
    },

    ban(idOrPublicId, banned = true) {
      const user = byId.get(Number(idOrPublicId)) ?? db.prepare('SELECT * FROM users WHERE public_id = ?').get(String(idOrPublicId));
      if (!user) throw new HttpError(404, 'not_found', 'No such user.');
      db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, user.id);
      return user;
    },

    counts(user) {
      const row = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(visibility = 'published'), 0) AS published
                              FROM tracks WHERE owner_id = ?`).get(user.id);
      return { trackCount: row.total, publishedCount: row.published };
    },
  };
}

/** What the API tells a client about itself. Never includes the secret or its hash. */
export function publicMe(user, counts) {
  return { id: user.public_id, displayName: user.display_name, banned: Boolean(user.banned), ...counts };
}
