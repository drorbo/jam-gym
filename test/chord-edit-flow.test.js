import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/app/player.js';
import { createStore, defaultState } from '../src/app/state.js';
import { createHistory } from '../src/app/history.js';
import { deleteBar, setChord, splitBar } from '../src/theory/baredit.js';

// The pieces the chord editor and the undo buttons are built from, wired the way src/app does it (minus the DOM).
const make = (text = 'Cmaj7 | Am7 | Dm7 G7 | Cmaj7') => {
  const store = createStore(defaultState());
  const player = new Player(store);
  player.updateSong({ progressionText: text });
  const history = createHistory();
  history.reset(text);
  let last = text;
  store.subscribe((s) => {
    if (s.song.progressionText !== last) { last = s.song.progressionText; history.push(last); }
  });
  const text_ = () => store.get().song.progressionText;
  return { store, player, history, text: text_ };
};

test('picker edits reach the song, and the parsed bars follow', () => {
  const { player, text } = make();
  player.setProgressionText(setChord(text(), 1, 0, 'F#m7b5').text);
  assert.equal(text(), 'Cmaj7 | F#m7b5 | Dm7 G7 | Cmaj7');
  assert.equal(player.parsed.ok, true);
  assert.equal(player.parsed.bars[1].chords[0].chord.symbol, 'F#m7b5');
});

test('undo brings back each chord change in turn, and redo replays them', () => {
  const { player, history, text } = make();
  player.setProgressionText(setChord(text(), 0, 0, 'Fmaj7').text);
  player.setProgressionText(splitBar(text(), 1).text);
  player.setProgressionText(deleteBar(text(), 3).text);
  assert.equal(text(), 'Fmaj7 | Am7 Am7 | Dm7 G7');
  player.setProgressionText(history.undo());
  assert.equal(text(), 'Fmaj7 | Am7 Am7 | Dm7 G7 | Cmaj7');
  player.setProgressionText(history.undo());
  assert.equal(text(), 'Fmaj7 | Am7 | Dm7 G7 | Cmaj7');
  player.setProgressionText(history.undo());
  assert.equal(text(), 'Cmaj7 | Am7 | Dm7 G7 | Cmaj7');
  assert.equal(history.undo(), null);
  player.setProgressionText(history.redo());
  assert.equal(text(), 'Fmaj7 | Am7 | Dm7 G7 | Cmaj7');
});

test('a key change that moves the chords is one undoable step; the key itself stays', () => {
  const { player, store, history, text } = make();
  player.setKey('Bb', { transpose: true });
  assert.equal(text(), 'Bbmaj7 | Gm7 | Cm7 F7 | Bbmaj7');
  player.setProgressionText(history.undo());
  assert.equal(text(), 'Cmaj7 | Am7 | Dm7 G7 | Cmaj7');
  assert.equal(store.get().song.key, 'Bb');
});

test('an edit made while the band is running reaches the song the same way', () => {
  const { player, text } = make();
  Object.defineProperty(player, 'isRunning', { get: () => true });
  player.setProgressionText(setChord(text(), 2, 1, 'Bb7').text);
  assert.equal(text(), 'Cmaj7 | Am7 | Dm7 Bb7 | Cmaj7');
});
