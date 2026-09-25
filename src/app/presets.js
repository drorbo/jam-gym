// Style presets: the band settings (style, swing, the Bass line, Keys and Drums panels, the sound choices) and the tempo,
// without the song (chords, key and meter). This file is the model: what a preset is, how the built-in ones are made, and how a person's own list
// is saved, deleted and merged. It has no DOM and no network, so all of it runs in Node (the server reuses it too).

import { getStyle } from '../styles/index.js';
import { BUILTIN_PRESETS } from '../styles/presets.js';
import { GROOVES, optionsFor } from '../styles/settings.js';
import { clampBpm } from '../engine/planner.js';
import { sanitize } from './state.js';

/**
 * The parts of the configuration a preset holds. Its tempo is kept beside them (in `settings.tempo`, optional: a preset saved
 * before tempo was included has none, and leaves your tempo alone). Key, meter, loop, key change and levels are not part of it.
 */
export const PRESET_KEYS = ['style', 'swing', 'bass', 'comp', 'kit', 'sounds'];
export const MAX_PRESETS = 50;
export const MAX_NAME = 40;
const STORAGE_KEY = 'jamgym.presets.v1';
const ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

const clone = (v) => JSON.parse(JSON.stringify(v));

// ---- settings ----------------------------------------------------------------------------------

/** Untrusted settings made valid: the same repairs a saved track gets, so "valid" means "the band can play it". */
export function sanitizePresetSettings(raw) {
  const given = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const config = sanitize({ config: given }).config;
  const out = Object.fromEntries(PRESET_KEYS.map((k) => [k, clone(config[k])]));
  if (Number.isFinite(given.tempo)) out.tempo = clampBpm(given.tempo);
  return out;
}

/** The band as it is right now (the config has no tempo; the caller adds the song's). */
export const settingsFromConfig = (config) => sanitizePresetSettings(config);

/** Two settings that play the same band have the same signature. (Tempo is left out: changing it is not a different band.) */
export const presetSignature = (settings) => JSON.stringify(PRESET_KEYS.map((k) => settings?.[k]));

/** The configuration with a preset's settings laid over it (everything else in it is left alone). */
export function applySettings(config, settings) {
  const s = sanitizePresetSettings(settings);
  return { ...config, ...Object.fromEntries(PRESET_KEYS.map((k) => [k, clone(s[k])])) };
}

/** A short line saying what a preset is: "Blues · Slow 12/8 · 67% swing · 58 BPM". */
export function describePreset(settings) {
  const style = getStyle(settings.style);
  const groove = optionsFor({ options: GROOVES }, style.id).find((o) => o.id === settings.kit?.groove);
  return [style.name, groove?.name, `${settings.swing}% swing`, settings.tempo ? `${settings.tempo} BPM` : null].filter(Boolean).join(' · ');
}

// ---- the built-in presets ----------------------------------------------------------------------

let builtin = null;
/** All built-in presets, each with complete, checked settings. Optionally only one style's. */
export function builtinPresets(styleId) {
  builtin ??= BUILTIN_PRESETS.map((p) => ({ ...p, builtin: true, settings: sanitizePresetSettings({ style: p.style, ...p.settings, tempo: p.tempo }) }));
  return styleId ? builtin.filter((p) => p.style === styleId) : builtin;
}

// ---- a person's own presets --------------------------------------------------------------------
// The library is { items: [{ id, name, settings, updatedAt }], deleted: { [id]: whenItWasDeleted } }. Deletions are kept
// so that another device (or a sync after being offline) does not bring a deleted preset back.

export const emptyLibrary = () => ({ items: [], deleted: {} });

export const cleanName = (name) => [...String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, MAX_NAME).join('');
export const sameName = (a, b) => String(a).trim().toLocaleLowerCase() === String(b).trim().toLocaleLowerCase();
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/** One item as it arrives from storage or the network (`data` on the wire, `settings` here): valid, or null. */
export function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name);
  const updatedAt = Number(raw.updatedAt);
  if (!ID_PATTERN.test(String(raw.id)) || !name || !Number.isFinite(updatedAt)) return null;
  return { id: String(raw.id), name, settings: sanitizePresetSettings(raw.settings ?? raw.data), updatedAt };
}

/** A whole library from storage or the network. Junk is dropped; it never throws. */
export function sanitizeLibrary(raw) {
  const lib = emptyLibrary();
  if (!raw || typeof raw !== 'object') return lib;
  const seen = new Set();
  for (const r of Array.isArray(raw.items) ? raw.items : []) {
    const item = sanitizeItem(r);
    if (item && !seen.has(item.id)) { seen.add(item.id); lib.items.push(item); }
  }
  if (raw.deleted && typeof raw.deleted === 'object') {
    for (const [id, at] of Object.entries(raw.deleted)) {
      if (ID_PATTERN.test(id) && Number.isFinite(Number(at)) && !seen.has(id)) lib.deleted[id] = Number(at);
    }
  }
  lib.items.sort(byName);
  return lib.items.length > MAX_PRESETS ? { ...lib, items: lib.items.slice(0, MAX_PRESETS) } : lib;
}

/**
 * Save the given settings under a name. A name that is already there (ignoring case) is updated in place.
 * @returns {{ok: true, lib, item, replaced: boolean} | {ok: false, error: string}}
 */
export function savePreset(lib, { name, settings }, { now = Date.now(), makeId = randomId } = {}) {
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: 'Give the preset a name.' };
  const existing = lib.items.find((p) => sameName(p.name, clean));
  if (!existing && lib.items.length >= MAX_PRESETS) {
    return { ok: false, error: `You can keep up to ${MAX_PRESETS} presets. Delete one to make room.` };
  }
  const item = { id: existing?.id ?? makeId(), name: clean, settings: sanitizePresetSettings(settings), updatedAt: now };
  const items = existing ? lib.items.map((p) => (p.id === item.id ? item : p)) : [...lib.items, item];
  const deleted = { ...lib.deleted };
  delete deleted[item.id];
  return { ok: true, lib: { items: items.sort(byName), deleted }, item, replaced: Boolean(existing) };
}

export function removePreset(lib, id, now = Date.now()) {
  const removed = lib.items.find((p) => p.id === id);
  if (!removed) return { lib, removed: null };
  return { lib: { items: lib.items.filter((p) => p.id !== id), deleted: { ...lib.deleted, [id]: now } }, removed };
}

/** Put a deleted preset back (as a fresh edit, so it also wins over the deletion everywhere else). */
export function restorePreset(lib, item, now = Date.now()) {
  if (lib.items.some((p) => p.id === item.id) || lib.items.length >= MAX_PRESETS) return lib;
  const deleted = { ...lib.deleted };
  delete deleted[item.id];
  return { items: [...lib.items, { ...item, updatedAt: now }].sort(byName), deleted };
}

/**
 * Two libraries as one. For each preset the latest change wins, whether it was an edit or a deletion (a deletion wins a tie).
 * The result is the same whichever way round they are given.
 */
export function mergeLibraries(a, b) {
  const best = new Map();
  const offer = (id, at, item) => {
    const cur = best.get(id);
    if (!cur || at > cur.at || (at === cur.at && !item && cur.item)) best.set(id, { at, item });
  };
  for (const lib of [a, b]) {
    for (const item of lib.items) offer(item.id, item.updatedAt, item);
    for (const [id, at] of Object.entries(lib.deleted)) offer(id, at, null);
  }
  const items = [];
  const deleted = {};
  for (const [id, { at, item }] of best) { if (item) items.push(item); else deleted[id] = at; }
  items.sort(byName);
  return items.length > MAX_PRESETS ? { items: items.sort((x, y) => y.updatedAt - x.updatedAt).slice(0, MAX_PRESETS).sort(byName), deleted } : { items, deleted };
}

// ---- storage on this device ------------------------------------------------------------------

export function loadLibrary(storage) {
  try { return sanitizeLibrary(JSON.parse(storage?.getItem(STORAGE_KEY) || 'null')); } catch { return emptyLibrary(); }
}

export function saveLibrary(storage, lib) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(lib)); } catch { /* storage blocked or full: presets still work until the page closes */ }
}

// ---- ids -------------------------------------------------------------------------------------

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** A random 12-character id (from the browser's or Node's secure random source). */
export function randomId(length = 12) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length * 2));
  let out = '';
  for (const b of bytes) { if (b < 248 && out.length < length) out += ALPHABET[b % 62]; }
  return out.length === length ? out : randomId(length);
}
