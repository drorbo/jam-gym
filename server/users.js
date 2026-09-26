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
  const bySession = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?');
  const byEardle = db.prepare(`SELECT * FROM users WHERE auth_provider = 'eardle' AND auth_subject = ?`);
  const eardleName = (name) => {
    const clean = cleanText(name, LIMITS.displayName);
    return [...clean].length >= LIMITS.displayNameMin ? clean : null;
  };

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

    /**
     * The user for a cookie value, or null: a person's own secret, or a session made when they signed in with eardle on
     * another device. Refreshes last_seen at most hourly (no write on every request).
     */
    findBySecret(secret) {
      if (!isSecret(secret)) return null;
      const hash = sha256(secret);
      const user = byHash.get(hash) ?? bySession.get(hash);
      if (!user) return null;
      if (now() - user.last_seen_at > HOUR) touch.run(now(), user.id);
      return user;
    },

    /** Look up by a recovery code as a person typed it. Only a person's own secret counts, not a sign-in session. */
    findByRecoveryCode(code) {
      const secret = normalizeSecret(code);
      const user = isSecret(secret) ? byHash.get(sha256(secret)) : null;
      return user ? { user, secret } : null;
    },

    /** True when this cookie value is the person's own secret (their recovery code), not a session from signing in. */
    isOwnSecret: (user, secret) => Boolean(secret) && sha256(secret) === user.secret_hash,

    // ---- sign in with eardle (server/sso.js) ------------------------------------------------

    findByEardle: (subject) => byEardle.get(String(subject)) ?? null,

    /** Make this identity the eardle account `subject`. A name still at its default takes the eardle nickname. */
    linkEardle(user, subject, name) {
      const clean = user.display_name.startsWith('Player-') ? eardleName(name) : null;
      db.prepare(`UPDATE users SET auth_provider = 'eardle', auth_subject = ? WHERE id = ?`).run(String(subject), user.id);
      if (clean) return this.rename(user, clean);
      return byId.get(user.id);
    },

    /** A new identity that is the eardle account `subject` from the start. Returns its own secret for the cookie, as create() does. */
    createLinked(subject, name) {
      const made = this.create();
      return { user: this.linkEardle(made.user, subject, name), secret: made.secret };
    },

    /** A session for a person who already has an identity, on a device that does not hold its secret. Returns the token for the cookie. */
    startSession(user) {
      const token = newSecret();
      db.prepare('INSERT INTO sessions(token_hash, user_id, created_at) VALUES (?, ?, ?)').run(sha256(token), user.id, now());
      return token;
    },

    endSession(token) {
      if (isSecret(token)) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    },

    /**
     * Move everything `from` owns (tracks, likes, reports, presets) to `to` and delete `from`. Used when someone who has been
     * using Jam Gym without an account signs in with an eardle account that already has a library: nothing is lost.
     */
    absorb(to, from) {
      transaction(db, () => {
        // a track both of them liked stays liked once
        db.prepare(`UPDATE tracks SET like_count = like_count - 1
                    WHERE id IN (SELECT track_id FROM likes WHERE user_id = ? AND track_id IN (SELECT track_id FROM likes WHERE user_id = ?))`).run(from.id, to.id);
        db.prepare('DELETE FROM likes WHERE user_id = ? AND track_id IN (SELECT track_id FROM likes WHERE user_id = ?)').run(from.id, to.id);
        db.prepare('UPDATE likes SET user_id = ? WHERE user_id = ?').run(to.id, from.id);
        db.prepare('UPDATE tracks SET owner_id = ? WHERE owner_id = ?').run(to.id, from.id);
        db.prepare('UPDATE OR IGNORE reports SET reporter_id = ? WHERE reporter_id = ?').run(to.id, from.id);
        db.prepare('UPDATE OR IGNORE presets SET owner_id = ? WHERE owner_id = ?').run(to.id, from.id);
        // published tracks carry the author's name in the search index
        const rows = db.prepare(`SELECT rowid, title, description, chord_tokens, visibility FROM tracks
                                 WHERE owner_id = ? AND visibility = 'published'`).all(to.id);
        for (const r of rows) reindex(db, { ...r, author: to.display_name });
        db.prepare('DELETE FROM users WHERE id = ?').run(from.id);
      });
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
  return { id: user.public_id, displayName: user.display_name, banned: Boolean(user.banned), eardle: user.auth_provider === 'eardle', ...counts };
}
