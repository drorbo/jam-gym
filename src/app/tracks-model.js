// A track is the whole practice setup. These pure functions turn the app's state into a track's data and back,
// and give a setup a fingerprint so the UI can tell when it has been edited since it was loaded.

import { defaultBass, defaultSwing, getStyle } from '../styles/index.js';
import { defaultState } from './state.js';

export const DATA_VERSION = 1;

/** The setup to store: song, playback config and mixer. Personal preferences (theme) are not part of a track. */
export function buildTrackData(state) {
  const { song, config, mixer } = state;
  return {
    v: DATA_VERSION,
    song: {
      key: song.key, tempo: song.tempo, timeSignature: song.timeSignature, progressionText: song.progressionText,
    },
    config: {
      style: config.style,
      swing: config.swing,
      bass: { ...config.bass },
      loop: config.loop,
      countIn: config.countIn,
      sounds: { ...config.sounds },
      modulation: { ...config.modulation },
      tempoRamp: { ...config.tempoRamp },
    },
    mixer: Object.fromEntries(Object.entries(mixer).map(([k, v]) => [k, { volume: v.volume, muted: v.muted }])),
  };
}

/**
 * A stable fingerprint of a setup. Two setups with the same fingerprint sound the same.
 * The progression is compared without stray whitespace, so re-typing a trailing space is not an "edit".
 */
export function setupSignature(data) {
  const { song, config, mixer } = data;
  return JSON.stringify([
    song.key, song.tempo, song.timeSignature, song.progressionText.trim(),
    config.style, config.swing, config.bass, config.loop, config.countIn, config.sounds, config.modulation, config.tempoRamp,
    Object.keys(mixer).sort().map((k) => [k, mixer[k].volume, mixer[k].muted]),
  ]);
}

/**
 * Turn one of the old browser-only saved progressions (saved.js) into a full setup, for moving it to the library.
 * Anything the old format didn't keep (sounds, key change, mixer...) takes its default.
 */
export function dataFromLocalSave(item) {
  const d = defaultState();
  const style = getStyle(item.style);
  return {
    v: DATA_VERSION,
    song: { key: item.key, tempo: item.tempo, timeSignature: item.timeSignature, progressionText: item.text },
    config: { ...d.config, style: style.id, swing: item.swing ?? defaultSwing(style, item.tempo), bass: defaultBass(style) },
    mixer: d.mixer,
  };
}
