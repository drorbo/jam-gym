// Saved progressions: named snapshots of a practice setup that can be brought back later.
//
// A snapshot holds the progression text (written in its own key), the key, time signature, style and
// tempo. It is stored on its own, apart from the app's settings, so it never gets lost when settings change.
// Everything here is pure except loadSaved/persistSaved, so it can be tested without a browser.

import { clampSwing } from '../engine/feel.js';
import { MAX_BPM, MIN_BPM } from '../engine/planner.js';
import { getStyle } from '../styles/index.js';
import { parseKey } from '../theory/keys.js';
import { METER_IDS } from '../theory/meter.js';
import { parseProgression } from '../theory/progression.js';

const STORAGE_KEY = 'jamgym.saved.v1';
export const MAX_NAME = 60;
export const MAX_SAVED = 200;

/**
 * @typedef {Object} SavedProgression
 * @property {string} id
 * @property {string} name
 * @property {string} text          progression text, written in `key`
 * @property {string} key
 * @property {string} timeSignature
 * @property {string} style
 * @property {number} tempo
 * @property {number|null} swing    swing percentage, or null = whatever the style's default is (older saves)
 * @property {number} savedAt       epoch ms
 */

/** Trim and collapse whitespace. */
export const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

const sameName = (a, b) => cleanName(a).toLocaleLowerCase() === cleanName(b).toLocaleLowerCase();

export const findByName = (list, name) => list.find((item) => sameName(item.name, name)) ?? null;

/** Keep the list in a predictable order for finding things: alphabetical, ignoring case. */
export const sortSaved = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));

let counter = 0;
const newId = (now) => `${now.toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Save (or update) a snapshot. A name that already exists, ignoring case, is updated in place.
 * @param {SavedProgression[]} list
 * @param {{name:string, text:string, key:string, timeSignature:string, style:string, tempo:number, swing?:number}} snapshot
 * @returns {{ok:true, list:SavedProgression[], item:SavedProgression, updated:boolean} | {ok:false, error:string}}
 */
export function saveSnapshot(list, snapshot, now = Date.now()) {
  const name = cleanName(snapshot.name);
  if (!name) return { ok: false, error: 'Give it a name first.' };
  const parsed = parseProgression(snapshot.text, { timeSignature: snapshot.timeSignature });
  if (!parsed.ok) return { ok: false, error: 'Fix the progression before saving it.' };

  const existing = findByName(list, name);
  if (!existing && list.length >= MAX_SAVED) return { ok: false, error: `You can keep up to ${MAX_SAVED} saved progressions.` };

  const item = {
    id: existing?.id ?? newId(now),
    name,
    text: snapshot.text.trim(),
    key: snapshot.key,
    timeSignature: snapshot.timeSignature,
    style: snapshot.style,
    tempo: snapshot.tempo,
    swing: Number.isFinite(snapshot.swing) ? clampSwing(snapshot.swing) : null,
    savedAt: now,
  };
  const next = existing ? list.map((x) => (x.id === existing.id ? item : x)) : [...list, item];
  return { ok: true, list: sortSaved(next), item, updated: Boolean(existing) };
}

export const removeSaved = (list, id) => list.filter((x) => x.id !== id);

/** Put a removed item back (for Undo). */
export const restoreSaved = (list, item) => (list.some((x) => x.id === item.id || sameName(x.name, item.name)) ? list : sortSaved([...list, item]));

/** Everything about the current setup that a snapshot restores, in one comparable string. */
export const signatureOf = (s) => [s.text.trim(), s.key, s.timeSignature].join('\u0001');

/** One-line description for the list: "Key of C · 7/8 · Jazz · 132 BPM · 8 bars". */
export function describeSaved(item) {
  const parsed = parseProgression(item.text, { timeSignature: item.timeSignature });
  const bars = parsed.bars.length;
  const key = item.key.replace('b', '♭').replace('#', '♯');
  return [`Key of ${key}`, item.timeSignature, getStyle(item.style).name, `${item.tempo} BPM`, `${bars} ${bars === 1 ? 'bar' : 'bars'}`].join(' · ');
}

/** Validate untrusted stored data. Bad entries are dropped, odd values are repaired. */
export function sanitizeSaved(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const name = cleanName(r.name);
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (!name || !text || !parseKey(r.key)) continue;
    const timeSignature = METER_IDS.includes(r.timeSignature) ? r.timeSignature : '4/4';
    if (!parseProgression(text, { timeSignature }).ok) continue;
    const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : newId(Date.now());
    seen.add(id);
    out.push({
      id, name, text, key: r.key, timeSignature,
      style: getStyle(r.style).id,
      tempo: Number.isFinite(r.tempo) ? Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(r.tempo))) : 120,
      swing: Number.isFinite(r.swing) ? clampSwing(r.swing) : null,
      savedAt: Number.isFinite(r.savedAt) ? r.savedAt : 0,
    });
    if (out.length >= MAX_SAVED) break;
  }
  return sortSaved(out);
}

// ---- storage (browser only) --------------------------------------------------------------

export function loadSaved() {
  try {
    return sanitizeSaved(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return [];
  }
}

/** @returns {boolean} false if the browser refused (private mode, storage full). */
export function persistSaved(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
