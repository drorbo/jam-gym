// A track keeps the whole band: save it, publish it, open it somewhere else, and every setting comes back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './harness.js';
import { Player } from '../src/app/player.js';
import { createStore, defaultState } from '../src/app/state.js';
import { buildTrackData } from '../src/app/tracks-model.js';
import { defaultBass, defaultComp, defaultKit, getStyle } from '../src/styles/index.js';

const withServer = (fn) => async () => {
  const s = await startTestServer();
  try { await fn(s); } finally { await s.close(); }
};

/** A setup where every band setting is somewhere other than its default. */
function customState() {
  const s = defaultState();
  const style = getStyle('rock');
  s.song = { key: 'Bb', tempo: 96, timeSignature: '4/4', progressionText: 'Bb | F | Gm | Eb' };
  s.config = {
    ...s.config,
    style: 'rock',
    swing: 55,
    bass: { ...defaultBass(style), pattern: 'gallop', line: 70, tension: 60, approach: 'chromatic', fills: 80, length: 30, pocket: 65, loose: 20, mix: ['line'] },
    comp: { ...defaultComp(style), rhythm: 'chug', density: 30, sync: 80, variety: 20, tension: 70, range: 60, spread: 20, length: 40, power: 65, pocket: 35, loose: 75, mix: ['density', 'sync'] },
    kit: {
      ...defaultKit(style),
      groove: 'diddley', cymbal: 70, kick: 20, snare: 80, ghosts: 10, fills: 90, wild: 30, crash: 60, power: 75, pocket: 45, loose: 30, mix: ['cymbal'],
      levels: { kick: 80, snare: 30, hat: 65, ride: 50, crash: 20, toms: 95, brush: 50 },
    },
    loop: false,
    countIn: false,
    sounds: { drums: 'electronic', bass: 'pick', keys: 'guitar' },
    modulation: { type: 'interval', interval: 5, everyLoops: 2, randomMode: 'fifths' },
    tempoRamp: { enabled: true, increment: 6, everyLoops: 3, maxBpm: 140 },
  };
  s.mixer = { drums: { volume: 0.55, muted: false }, bass: { volume: 0.7, muted: true }, chords: { volume: 0.4, muted: false } };
  return s;
}

test('a saved track keeps every band setting, and so does a published copy opened by someone else', withServer(async ({ browser }) => {
  const original = buildTrackData(customState());
  const owner = browser();
  const made = await owner.post('/api/tracks', { title: 'Everything', data: original });
  assert.equal(made.status, 201);
  const id = made.json.track.id;

  const saved = (await owner.get(`/api/tracks/${id}`)).json.track.data;
  assert.deepEqual(saved.config, original.config, 'the band settings changed on the way in and out of the library');
  assert.deepEqual(saved.song, original.song);
  assert.deepEqual(saved.mixer, original.mixer);

  assert.equal((await owner.post(`/api/tracks/${id}/publish`)).status, 200);
  const stranger = browser();
  const seen = (await stranger.get(`/api/tracks/${id}`)).json.track.data;
  assert.deepEqual(seen, saved, 'a stranger sees a different band');

  // and a copy into their own library is the same band again
  const copy = await stranger.post(`/api/tracks/${id}/copy`);
  assert.equal(copy.status, 201);
  assert.deepEqual(copy.json.track.data.config, original.config);
}));

test('opening a track brings back the whole band, and saving it again gives the same track', () => {
  const original = buildTrackData(customState());
  const store = createStore(defaultState());
  const player = new Player(store);
  player.applySetup(original);
  const s = store.get();
  assert.deepEqual(s.config.bass, original.config.bass);
  assert.deepEqual(s.config.comp, original.config.comp);
  assert.deepEqual(s.config.kit, original.config.kit);
  assert.deepEqual(s.config.sounds, original.config.sounds);
  assert.equal(s.config.style, 'rock');
  assert.equal(s.config.swing, 55);
  assert.deepEqual(s.config.modulation, original.config.modulation);
  assert.deepEqual(s.config.tempoRamp, original.config.tempoRamp);
  assert.equal(s.config.loop, false);
  assert.equal(s.config.countIn, false);
  assert.deepEqual(s.mixer, original.mixer);
  assert.deepEqual(s.song, { ...defaultState().song, ...original.song });
  assert.deepEqual(player.currentSetup(), original, 'saving what was opened changes it');
});

test('opening a track sets its tempo, stopped or while playing, and a saved track keeps the tempo it was saved at', () => {
  const original = buildTrackData(customState());
  assert.equal(original.song.tempo, 96);

  const stopped = createStore(defaultState());
  new Player(stopped).applySetup(original);
  assert.equal(stopped.get().song.tempo, 96);

  const store = createStore(defaultState());
  const player = new Player(store);
  const heard = [];
  store.set({ transport: 'playing' });
  player.conductor = { running: true, requestKey() {}, setBpm: (bpm) => heard.push(bpm) };
  player.applySetup({ ...original, song: { ...original.song, tempo: 71 } });
  assert.deepEqual(heard, [71], "the running band did not take the track's tempo");
  assert.equal(store.get().song.tempo, 71);
  assert.equal(player.currentSetup().song.tempo, 71, 'saving it again gives the same tempo');
});

test('a track saved before a setting existed opens with that setting at the style default', () => {
  const old = buildTrackData(customState());
  delete old.config.kit.groove;
  delete old.config.kit.levels;
  delete old.config.bass.pattern;
  const store = createStore(defaultState());
  const player = new Player(store);
  player.applySetup(old);
  const { kit, bass } = store.get().config;
  assert.equal(kit.groove, defaultKit(getStyle('rock')).groove);
  assert.deepEqual(kit.levels, defaultKit(getStyle('rock')).levels);
  assert.equal(bass.pattern, defaultBass(getStyle('rock')).pattern);
});
