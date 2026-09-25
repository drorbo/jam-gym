// App state: defaults, a tiny observable store, and localStorage persistence.

import { BASS_SOUNDS, DRUM_SOUNDS, KEY_SOUNDS, defaultBass, defaultComp, defaultKit, defaultSwing, getStyle } from '../styles/index.js';
import { sanitizeBass, sanitizeComp, sanitizeKit } from '../styles/settings.js';
import { clampSwing } from '../engine/feel.js';
import { MAX_BPM, MIN_BPM } from '../engine/planner.js';
import { parseKey } from '../theory/keys.js';
import { METER_IDS } from '../theory/meter.js';

export const defaultState = () => ({
  song: { key: 'C', tempo: 132, timeSignature: '4/4', progressionText: 'Cmaj7 | Am7 | Dm7 | G7' },
  config: {
    style: 'jazz',
    swing: defaultSwing(getStyle('jazz'), 132), // percent; picking a style resets this to that style's default
    bass: defaultBass(getStyle('jazz')), // the Bass line, Keys and Drums panels; picking a style resets them too
    comp: defaultComp(getStyle('jazz')),
    kit: defaultKit(getStyle('jazz')),
    loop: true,
    countIn: true,
    sounds: { drums: 'auto', bass: 'auto', keys: 'auto' },
    modulation: { type: 'off', interval: 2, everyLoops: 1, randomMode: 'no-repeat' },
    tempoRamp: { enabled: false, increment: 5, everyLoops: 2, maxBpm: MAX_BPM },
  },
  mixer: {
    drums: { volume: 0.75, muted: false },
    bass: { volume: 0.8, muted: false },
    chords: { volume: 0.7, muted: false },
  },
  theme: 'auto',
});

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    /** Shallow-merge a patch into the state and notify subscribers. */
    set(patch) {
      state = { ...state, ...patch };
      subs.forEach((fn) => fn(state, patch));
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

// ---- persistence --------------------------------------------------------------------------

const STORAGE_KEY = 'jamgym.v1';
const PERSISTED = ['song', 'config', 'mixer', 'theme'];

const num = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

/** Merge untrusted saved data over the defaults, keeping only valid values. */
export function sanitize(saved) {
  const d = defaultState();
  if (!saved || typeof saved !== 'object') return d;
  const s = saved.song ?? {};
  const c = saved.config ?? {};
  const m = c.modulation ?? {};
  const r = c.tempoRamp ?? {};
  const tempo = num(s.tempo, MIN_BPM, MAX_BPM, d.song.tempo);
  const style = getStyle(c.style);
  return {
    song: {
      key: parseKey(s.key) ? s.key : d.song.key,
      tempo,
      timeSignature: oneOf(s.timeSignature, METER_IDS, '4/4'),
      progressionText: typeof s.progressionText === 'string' && s.progressionText.trim() ? s.progressionText : d.song.progressionText,
    },
    config: {
      style: style.id,
      swing: clampSwing(c.swing, defaultSwing(style, tempo)), // missing or invalid -> the style's default
      bass: sanitizeBass(c.bass, defaultBass(style)),
      comp: sanitizeComp(c.comp, defaultComp(style)),
      kit: sanitizeKit(c.kit, defaultKit(style)),
      loop: c.loop !== false,
      countIn: c.countIn !== false,
      sounds: {
        drums: oneOf(c.sounds?.drums, ['auto', ...DRUM_SOUNDS.map((x) => x.id)], 'auto'),
        bass: oneOf(c.sounds?.bass, ['auto', ...BASS_SOUNDS.map((x) => x.id)], 'auto'),
        keys: oneOf(c.sounds?.keys, ['auto', ...KEY_SOUNDS.map((x) => x.id)], 'auto'),
      },
      modulation: {
        type: oneOf(m.type, ['off', 'interval', 'random'], 'off'),
        interval: num(m.interval, -11, 11, d.config.modulation.interval) | 0,
        everyLoops: num(m.everyLoops, 1, 64, 1) | 0,
        randomMode: oneOf(m.randomMode, ['no-repeat', 'any', 'shuffle', 'fifths', 'fourths', 'chromatic'], 'no-repeat'),
      },
      tempoRamp: {
        enabled: Boolean(r.enabled),
        increment: num(r.increment, 1, 40, d.config.tempoRamp.increment) | 0,
        everyLoops: num(r.everyLoops, 1, 64, d.config.tempoRamp.everyLoops) | 0,
        maxBpm: num(r.maxBpm, MIN_BPM, MAX_BPM, MAX_BPM) | 0,
      },
    },
    mixer: Object.fromEntries(['drums', 'bass', 'chords'].map((k) => [k, {
      volume: num(saved.mixer?.[k]?.volume, 0, 1, d.mixer[k].volume),
      muted: Boolean(saved.mixer?.[k]?.muted),
    }])),
    theme: oneOf(saved.theme, ['auto', 'dark', 'light'], 'auto'),
  };
}

export function loadState() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  try {
    const out = {};
    for (const k of PERSISTED) out[k] = state[k];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch { /* private mode or storage full: the app works without it */ }
}
