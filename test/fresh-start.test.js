import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, freshStart, sanitize } from '../src/app/state.js';

test('a visit starts with no chords, whatever the last visit left behind', () => {
  const last = sanitize({ song: { key: 'Eb', tempo: 90, timeSignature: '4/4', progressionText: 'Dm7 | G7 | Cmaj7' } });
  const start = freshStart(last);
  assert.equal(start.song.progressionText, '', 'the chords are blank');
  assert.equal(start.song.key, 'Eb', 'the key is kept');
  assert.equal(start.song.tempo, 90, 'the tempo is kept');
});

test('a visit starts with the key change and the tempo ramp off, even if they were on', () => {
  const last = sanitize({
    config: { modulation: { type: 'random', interval: 5, everyLoops: 3, randomMode: 'fifths' }, tempoRamp: { enabled: true, increment: 10, everyLoops: 4, maxBpm: 200 } },
  });
  assert.equal(last.config.modulation.type, 'random', 'the saved state really had it on');
  assert.equal(last.config.tempoRamp.enabled, true);
  const start = freshStart(last);
  assert.equal(start.config.modulation.type, 'off');
  assert.equal(start.config.tempoRamp.enabled, false);
  assert.equal(start.config.modulation.interval, 5, 'its other settings are left as they were');
  assert.equal(start.config.tempoRamp.increment, 10);
});

test('the rest of the band is kept: style, sounds, swing and the mixer', () => {
  const last = sanitize({ config: { style: 'blues', swing: 70, sounds: { drums: 'auto', bass: 'auto', keys: 'organ' } }, mixer: { drums: { volume: 0.2, muted: true } } });
  const start = freshStart(last);
  assert.equal(start.config.style, 'blues');
  assert.equal(start.config.swing, 70);
  assert.equal(start.config.sounds.keys, 'organ');
  assert.equal(start.mixer.drums.muted, true);
});

test('the built-in defaults are unchanged: still playable (the server builds tracks from them) and both off', () => {
  const d = defaultState();
  assert.ok(d.song.progressionText.trim().length > 0);
  assert.equal(d.config.modulation.type, 'off');
  assert.equal(d.config.tempoRamp.enabled, false);
});
