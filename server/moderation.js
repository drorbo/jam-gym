// Moderator actions. Used by the admin CLI (server/admin.js), never exposed over HTTP.

import { transaction } from './db.js';
import { reindex, unindex } from './search.js';
import { createUsers } from './users.js';
import { HttpError } from './util.js';

/** @param {import('node:sqlite').DatabaseSync} db */
export function createModeration(db) {
  const users = createUsers(db);
  const row = (id) => {
    const r = db.prepare(`SELECT t.rowid AS rowid, t.*, u.display_name AS author, u.public_id AS author_id, u.banned AS author_banned
                          FROM tracks t JOIN users u ON u.id = t.owner_id WHERE t.id = ?`).get(String(id));
    if (!r) throw new HttpError(404, 'not_found', `No track with id ${id}.`);
    return r;
  };

  return {
    stats() {
      const c = (sql) => db.prepare(sql).get().c;
      return {
        users: c('SELECT COUNT(*) AS c FROM users'),
        bannedUsers: c('SELECT COUNT(*) AS c FROM users WHERE banned = 1'),
        tracks: c('SELECT COUNT(*) AS c FROM tracks'),
        published: c("SELECT COUNT(*) AS c FROM tracks WHERE visibility = 'published'"),
        hidden: c("SELECT COUNT(*) AS c FROM tracks WHERE visibility = 'hidden'"),
        likes: c('SELECT COUNT(*) AS c FROM likes'),
      };
    },

    show(id) {
      const t = row(id);
      return { ...t, data: undefined, chord_tokens: undefined };
    },

    /** Take a track off the public site (the owner sees it as removed). */
    hide(id) {
      const t = row(id);
      transaction(db, () => {
        db.prepare("UPDATE tracks SET visibility = 'hidden' WHERE id = ?").run(t.id);
        unindex(db, t.rowid);
      });
      return row(id);
    },

    /** Undo a hide: back to published. */
    restore(id) {
      const t = row(id);
      if (t.visibility !== 'hidden') throw new HttpError(409, 'conflict', `Track ${id} is ${t.visibility}, not hidden.`);
      transaction(db, () => {
        db.prepare("UPDATE tracks SET visibility = 'published' WHERE id = ?").run(t.id);
        reindex(db, row(id));
      });
      return row(id);
    },

    remove(id) {
      const t = row(id);
      transaction(db, () => {
        unindex(db, t.rowid);
        db.prepare('DELETE FROM tracks WHERE id = ?').run(t.id);
      });
      return t;
    },

    /** Ban or unban by public id. A banned user's tracks disappear from browse and they can't save, publish or like. */
    ban: (publicId, banned = true) => users.ban(publicId, banned),
  };
}
