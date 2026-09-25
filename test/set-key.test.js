import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/app/player.js';
import { createStore, defaultState } from '../src/app/state.js';

const make = (text = 'Bbmaj7 | Gm7 | Cm7 F7 | Bbmaj7') => {
  const store = createStore(defaultState());
  const player = new Player(store);
  player.updateSong({ progressionText: text });
  return { store, player };
};

test('setKey changes the key and leaves the typed chords alone', () => {
  const { store, player } = make();
  player.setKey('Bb');
  const { song } = store.get();
  assert.equal(song.key, 'Bb');
  assert.equal(song.progressionText, 'Bbmaj7 | Gm7 | Cm7 F7 | Bbmaj7');
});

test('setKey with transpose rewrites the chords into the new key', () => {
  const { store, player } = make('Cmaj7 | Am7 | Dm7 G7 | Cmaj7');
  player.setKey('Bb', { transpose: true });
  const { song } = store.get();
  assert.equal(song.key, 'Bb');
  assert.equal(song.progressionText, 'Bbmaj7 | Gm7 | Cm7 F7 | Bbmaj7');
});

test('the key sticks while playing, even after an automatic key change', () => {
  const { store, player } = make();
  const requested = [];
  Object.defineProperty(player, 'isRunning', { get: () => true });
  player.conductor = { running: true, requestKey: (pc) => requested.push(pc) };
  player.setKey('Eb');
  assert.equal(store.get().song.key, 'Eb');
  assert.deepEqual(requested, [3]);
});

test('major and minor of the same tonic are different keys', () => {
  const { store, player } = make();
  player.setKey('Am');
  assert.equal(store.get().song.key, 'Am');
});
