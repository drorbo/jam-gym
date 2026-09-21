// Tracks: create, edit, publish, copy, like, report, browse. Pure logic over the database; no HTTP in here.
//
// `user` arguments are rows from the users table. Anything that would reveal someone else's private track
// answers "not found", never "forbidden", so ids can't be probed.

import { transaction } from './db.js';
import { LIMITS } from './config.js';
import { parseBrowseParams, reindex, unindex } from './search.js';
import { prepareText, prepareTrackData } from './trackdata.js';
import { HttpError, bad, notFound, now, randomId } from './util.js';

const forbidden = (message, code = 'forbidden') => new HttpError(403, code, message);
const conflict = (message, code = 'conflict') => new HttpError(409, code, message);

/** @param {import('node:sqlite').DatabaseSync} db */
export function createTracks(db) {
  const SELECT = `SELECT t.rowid AS rowid, t.*, u.display_name AS author, u.public_id AS author_id, u.banned AS author_banned
                  FROM tracks t JOIN users u ON u.id = t.owner_id`;
  const rowById = (id) => db.prepare(`${SELECT} WHERE t.id = ?`).get(String(id));
  const isLiked = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND track_id = ?');

  /** The track as the API shows it. `full` adds the playable setup. */
  function present(row, viewer, { full = false } = {}) {
    const mine = Boolean(viewer && viewer.id === row.owner_id);
    const out = {
      id: row.id,
      title: row.title,
      description: row.description,
      author: row.author,
      style: row.style,
      key: row.key,
      timeSignature: row.time_signature,
      tempo: row.tempo,
      bars: row.bars,
      chords: row.chords ? row.chords.split(' ') : [],
      likes: row.like_count,
      likedByMe: Boolean(viewer && isLiked.get(viewer.id, row.id)),
      isMine: mine,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
    };
    if (mine) out.visibility = row.visibility;
    if (full) out.data = JSON.parse(row.data);
    return out;
  }

  /** A track the viewer is allowed to see, or a 404. */
  function visible(id, viewer) {
    const row = rowById(id);
    if (!row) throw notFound('That track was not found.');
    const mine = viewer && viewer.id === row.owner_id;
    if (mine) return row;
    if (row.visibility === 'published' && !row.author_banned) return row;
    throw notFound('That track was not found.');
  }

  function owned(id, user) {
    const row = rowById(id);
    if (!row || row.owner_id !== user.id) throw notFound('That track was not found.');
    return row;
  }

  function requireActive(user) {
    if (user.banned) throw forbidden('This account can no longer save or share tracks.', 'banned');
  }

  function insert(user, title, description, prepared) {
    const count = db.prepare('SELECT COUNT(*) AS c FROM tracks WHERE owner_id = ?').get(user.id).c;
    if (count >= LIMITS.tracksPerUser) throw conflict(`You can keep up to ${LIMITS.tracksPerUser} tracks. Delete one to make room.`, 'limit_reached');
    const id = randomId(10);
    const t = now();
    db.prepare(`INSERT INTO tracks(id, owner_id, title, description, data, style, key, time_signature, tempo, bars, chords, chord_tokens,
                                   visibility, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?)`)
      .run(id, user.id, title, description, JSON.stringify(prepared.data), prepared.style, prepared.key, prepared.timeSignature,
        prepared.tempo, prepared.bars, prepared.chords, prepared.chordTokens, t, t);
    return id;
  }

  return {
    create(user, input) {
      requireActive(user);
      const { title, description } = prepareText(input);
      const prepared = prepareTrackData(input.data);
      const id = insert(user, title, description, prepared);
      return present(rowById(id), user, { full: true });
    },

    /** Bring in several tracks at once (moving a browser's old saved progressions into the library). */
    importMany(user, items) {
      requireActive(user);
      if (!Array.isArray(items)) throw bad('Nothing to import.');
      let created = 0;
      const skipped = [];
      transaction(db, () => {
        for (const item of items.slice(0, 100)) {
          try {
            const { title, description } = prepareText(item ?? {});
            insert(user, title, description, prepareTrackData(item?.data));
            created++;
          } catch (err) {
            if (!(err instanceof HttpError)) throw err;
            if (err.code === 'limit_reached') { skipped.push({ title: item?.title ?? '', reason: err.message }); break; }
            skipped.push({ title: String(item?.title ?? ''), reason: err.message });
          }
        }
      });
      return { created, skipped };
    },

    listMine(user) {
      return db.prepare(`${SELECT} WHERE t.owner_id = ? ORDER BY t.updated_at DESC`).all(user.id).map((r) => present(r, user));
    },

    get(id, viewer) {
      const row = visible(id, viewer);
      return present(row, viewer, { full: true });
    },

    update(user, id, input) {
      requireActive(user);
      const row = owned(id, user);
      const text = input.title !== undefined || input.description !== undefined
        ? prepareText({ title: input.title ?? row.title, description: input.description ?? row.description })
        : { title: row.title, description: row.description };
      const prepared = input.data !== undefined ? prepareTrackData(input.data) : null;
      transaction(db, () => {
        if (prepared) {
          db.prepare(`UPDATE tracks SET data = ?, style = ?, key = ?, time_signature = ?, tempo = ?, bars = ?, chords = ?, chord_tokens = ?
                      WHERE id = ?`)
            .run(JSON.stringify(prepared.data), prepared.style, prepared.key, prepared.timeSignature, prepared.tempo, prepared.bars,
              prepared.chords, prepared.chordTokens, row.id);
        }
        db.prepare('UPDATE tracks SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(text.title, text.description, now(), row.id);
        reindex(db, rowById(row.id));
      });
      return present(rowById(row.id), user, { full: true });
    },

    remove(user, id) {
      const row = owned(id, user);
      transaction(db, () => {
        unindex(db, row.rowid);
        db.prepare('DELETE FROM tracks WHERE id = ?').run(row.id); // cascades to likes and reports
      });
    },

    publish(user, id) {
      requireActive(user);
      const row = owned(id, user);
      if (row.visibility === 'hidden') throw forbidden('A moderator removed this track, so it cannot be published again.', 'removed');
      if (row.visibility === 'published') return present(row, user);
      const n = db.prepare("SELECT COUNT(*) AS c FROM tracks WHERE owner_id = ? AND visibility = 'published'").get(user.id).c;
      if (n >= LIMITS.publishedPerUser) throw conflict(`You can have up to ${LIMITS.publishedPerUser} published tracks. Unpublish one first.`, 'limit_reached');
      transaction(db, () => {
        db.prepare("UPDATE tracks SET visibility = 'published', published_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), row.id);
        reindex(db, rowById(row.id));
      });
      return present(rowById(row.id), user);
    },

    unpublish(user, id) {
      const row = owned(id, user);
      if (row.visibility === 'hidden') throw forbidden('A moderator removed this track.', 'removed');
      transaction(db, () => {
        db.prepare("UPDATE tracks SET visibility = 'private', updated_at = ? WHERE id = ?").run(now(), row.id);
        unindex(db, row.rowid);
      });
      return present(rowById(row.id), user);
    },

    /** Save someone's published track into my own library as a private copy. */
    copy(user, id) {
      requireActive(user);
      const row = visible(id, user);
      const title = `Copy of ${row.title}`.slice(0, LIMITS.title);
      const newId = insert(user, title, row.description, prepareTrackData(JSON.parse(row.data)));
      return present(rowById(newId), user, { full: true });
    },

    like(user, id) {
      requireActive(user);
      const row = visible(id, user);
      if (row.owner_id === user.id) throw forbidden('You cannot like your own track.', 'own_track');
      if (row.visibility !== 'published') throw notFound('That track was not found.');
      transaction(db, () => {
        const r = db.prepare('INSERT OR IGNORE INTO likes(user_id, track_id, created_at) VALUES (?, ?, ?)').run(user.id, row.id, now());
        if (r.changes > 0) db.prepare('UPDATE tracks SET like_count = like_count + 1 WHERE id = ?').run(row.id);
      });
      const fresh = rowById(row.id);
      return { likes: fresh.like_count, likedByMe: true };
    },

    unlike(user, id) {
      const row = visible(id, user);
      transaction(db, () => {
        const r = db.prepare('DELETE FROM likes WHERE user_id = ? AND track_id = ?').run(user.id, row.id);
        if (r.changes > 0) db.prepare('UPDATE tracks SET like_count = like_count - 1 WHERE id = ?').run(row.id);
      });
      const fresh = rowById(row.id);
      return { likes: fresh.like_count, likedByMe: false };
    },

    /** Report a published track. Enough distinct reporters hide it until a moderator looks. */
    report(user, id, reason) {
      requireActive(user);
      const row = visible(id, user);
      if (row.owner_id === user.id) throw forbidden('You cannot report your own track.', 'own_track');
      let hidden = false;
      transaction(db, () => {
        db.prepare('INSERT OR IGNORE INTO reports(track_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?)')
          .run(row.id, user.id, String(reason ?? '').slice(0, LIMITS.reason), now());
        const n = db.prepare('SELECT COUNT(*) AS c FROM reports WHERE track_id = ?').get(row.id).c;
        if (n >= LIMITS.autoHideReports && row.visibility === 'published') {
          db.prepare("UPDATE tracks SET visibility = 'hidden' WHERE id = ?").run(row.id);
          unindex(db, row.rowid);
          hidden = true;
        }
      });
      return { reported: true, hidden };
    },

    /** Search and list published tracks. */
    browse(viewer, searchParams) {
      const p = parseBrowseParams(searchParams);
      const where = ["t.visibility = 'published'", 'u.banned = 0'];
      const args = [];
      if (p.style) { where.push('t.style = ?'); args.push(p.style); }
      if (p.meter) { where.push('t.time_signature = ?'); args.push(p.meter); }
      if (p.key) { where.push('t.key = ?'); args.push(p.key); }
      if (p.bpmMin !== null) { where.push('t.tempo >= ?'); args.push(p.bpmMin); }
      if (p.bpmMax !== null) { where.push('t.tempo <= ?'); args.push(p.bpmMax); }

      // (FTS5's MATCH and bm25() must name the table itself, so it is not aliased)
      const from = p.match
        ? 'FROM track_search JOIN tracks t ON t.rowid = track_search.rowid JOIN users u ON u.id = t.owner_id'
        : 'FROM tracks t JOIN users u ON u.id = t.owner_id';
      if (p.match) { where.push('track_search MATCH ?'); args.push(p.match); }

      let order = 't.like_count DESC, t.published_at DESC'; // "most liked"
      if (p.sort === 'new') order = 't.published_at DESC';
      else if (p.sort === 'relevance' && p.match) order = 'bm25(track_search, 8.0, 1.0, 3.0, 0.0) ASC, t.like_count DESC, t.published_at DESC';

      const total = db.prepare(`SELECT COUNT(*) AS c ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
      const rows = db.prepare(`SELECT t.rowid AS rowid, t.*, u.display_name AS author, u.public_id AS author_id ${from}
                               WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, p.limit, p.offset);
      return { total, offset: p.offset, limit: p.limit, items: rows.map((r) => present(r, viewer)) };
    },
  };
}
