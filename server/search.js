// Full-text search over published tracks (SQLite FTS5), with user input made safe.

import { LIMITS } from './config.js';
import { asChordWord, chordToken } from './trackdata.js';

const hasContent = (w) => /[\p{L}\p{N}]/u.test(w);

/** A word as an FTS5 string: always quoted, so it can never be read as FTS syntax (NEAR, OR, *, ", -, :...). */
const quote = (w) => `"${w.replace(/"/g, '""')}"`;

/**
 * Turn what the user typed into an FTS5 MATCH expression (or null for "no text filter").
 * Every word must match (AND). A word matches as a prefix in the title, description or author; a word that is a chord
 * symbol also matches tracks that contain that chord.
 * @returns {string|null}
 */
export function buildMatch(input) {
  const words = String(input ?? '').split(/\s+/).map((w) => w.slice(0, 40)).filter((w) => w && hasContent(w)).slice(0, 8);
  if (!words.length) return null;
  const clauses = words.map((w) => {
    const text = `{title description author} : ${quote(w)}*`;
    const chord = asChordWord(w);
    return chord ? `(${text} OR chords : ${quote(chordToken(chord))})` : `(${text})`;
  });
  return clauses.join(' AND ');
}

/** Add, replace or remove a track's row in the search index. Call after any change to a published track. */
export function reindex(db, track) {
  db.prepare('DELETE FROM track_search WHERE rowid = ?').run(track.rowid);
  if (track.visibility !== 'published') return;
  db.prepare('INSERT INTO track_search(rowid, title, description, author, chords) VALUES (?, ?, ?, ?, ?)')
    .run(track.rowid, track.title, track.description, track.author, track.chord_tokens);
}

export function unindex(db, rowid) {
  db.prepare('DELETE FROM track_search WHERE rowid = ?').run(rowid);
}

const SORTS = { likes: 'likes', new: 'new', relevance: 'relevance' };

/**
 * Parse and clamp the query string of GET /api/browse.
 * @param {URLSearchParams} params
 */
export function parseBrowseParams(params) {
  const int = (name, lo, hi) => {
    const v = params.get(name);
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
  };
  const q = String(params.get('q') ?? '').slice(0, 200).trim();
  const requested = SORTS[params.get('sort')] ?? null;
  const match = buildMatch(q);
  return {
    q,
    match,
    style: params.get('style') || null,
    meter: params.get('meter') || null,
    key: params.get('key') || null,
    bpmMin: int('bpmMin', 1, 999),
    bpmMax: int('bpmMax', 1, 999),
    sort: requested ?? (match ? 'relevance' : 'likes'),
    limit: int('limit', 1, LIMITS.browsePageMax) ?? LIMITS.browsePageDefault,
    offset: int('offset', 0, 100000) ?? 0,
  };
}
