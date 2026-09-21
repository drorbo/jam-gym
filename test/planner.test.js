import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialChorusState, nextChorusState, simulateChoruses, describeInterval, clampBpm,
} from '../src/engine/planner.js';
import { createRng } from '../src/engine/rng.js';

const OFF = { modulation: { type: 'off' }, tempoRamp: { enabled: false } };
const run = (start, settings, n, seed = 1) => simulateChoruses(start, settings, seed, n);
const keys = (states) => states.map((s) => s.keyPc);
const tempi = (states) => states.map((s) => s.bpm);

test('off: nothing changes', () => {
  const s = run(initialChorusState(0, 120), OFF, 10);
  assert.deepEqual(keys(s), Array(10).fill(0));
  assert.deepEqual(tempi(s), Array(10).fill(120));
  assert.deepEqual(s.map((x) => x.chorus), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('interval modulation: +2 after every loop', () => {
  const settings = { ...OFF, modulation: { type: 'interval', interval: 2, everyLoops: 1 } };
  assert.deepEqual(keys(run(initialChorusState(0, 100), settings, 8)), [0, 2, 4, 6, 8, 10, 0, 2]);
});

test('interval modulation: every N loops', () => {
  const settings = { ...OFF, modulation: { type: 'interval', interval: 3, everyLoops: 3 } };
  assert.deepEqual(keys(run(initialChorusState(0, 100), settings, 10)), [0, 0, 0, 3, 3, 3, 6, 6, 6, 9]);
});

test('interval modulation: negative intervals wrap correctly', () => {
  const settings = { ...OFF, modulation: { type: 'interval', interval: -1, everyLoops: 1 } };
  assert.deepEqual(keys(run(initialChorusState(0, 100), settings, 4)), [0, 11, 10, 9]);
});

test('tempo ramp matches the spec example: 100,100,105,105,110,110', () => {
  const settings = { ...OFF, tempoRamp: { enabled: true, increment: 5, everyLoops: 2, maxBpm: 220 } };
  assert.deepEqual(tempi(run(initialChorusState(0, 100), settings, 6)), [100, 100, 105, 105, 110, 110]);
});

test('tempo ramp never exceeds the cap', () => {
  const settings = { ...OFF, tempoRamp: { enabled: true, increment: 30, everyLoops: 1, maxBpm: 160 } };
  assert.deepEqual(tempi(run(initialChorusState(0, 100), settings, 5)), [100, 130, 160, 160, 160]);
  const wide = { ...OFF, tempoRamp: { enabled: true, increment: 50, everyLoops: 1, maxBpm: 999 } };
  assert.ok(tempi(run(initialChorusState(0, 100), wide, 5)).every((b) => b <= 220));
});

test('tempo ramp holds (never slows) when the starting tempo is already above the cap', () => {
  const settings = { ...OFF, tempoRamp: { enabled: true, increment: 5, everyLoops: 1, maxBpm: 150 } };
  assert.deepEqual(tempi(run(initialChorusState(0, 180), settings, 4)), [180, 180, 180, 180]);
});

test('combination mode: every 2 loops, +2 semitones and +5 BPM (spec example)', () => {
  const settings = {
    modulation: { type: 'interval', interval: 2, everyLoops: 2 },
    tempoRamp: { enabled: true, increment: 5, everyLoops: 2, maxBpm: 220 },
  };
  const s = run(initialChorusState(0, 100), settings, 7);
  assert.deepEqual(keys(s), [0, 0, 2, 2, 4, 4, 6]);
  assert.deepEqual(tempi(s), [100, 100, 105, 105, 110, 110, 115]);
});

test('key change and tempo ramp can run on different schedules', () => {
  const settings = {
    modulation: { type: 'interval', interval: 7, everyLoops: 1 },
    tempoRamp: { enabled: true, increment: 4, everyLoops: 3, maxBpm: 220 },
  };
  const s = run(initialChorusState(0, 90), settings, 7);
  assert.deepEqual(keys(s), [0, 7, 2, 9, 4, 11, 6]);
  assert.deepEqual(tempi(s), [90, 90, 90, 94, 94, 94, 98]);
});

test('random modes: any / no-repeat', () => {
  const noRepeat = { ...OFF, modulation: { type: 'random', randomMode: 'no-repeat', everyLoops: 1 } };
  for (let seed = 1; seed <= 20; seed++) {
    const k = keys(run(initialChorusState(5, 100), noRepeat, 200, seed));
    for (let i = 1; i < k.length; i++) assert.notEqual(k[i], k[i - 1]);
  }
  const any = { ...OFF, modulation: { type: 'random', randomMode: 'any', everyLoops: 1 } };
  const k = keys(run(initialChorusState(0, 100), any, 600, 3));
  assert.equal(new Set(k).size, 12);
  assert.ok(k.every((x) => x >= 0 && x < 12));
});

test('random: shuffle visits all 12 keys per round without repeats', () => {
  const settings = { ...OFF, modulation: { type: 'random', randomMode: 'shuffle', everyLoops: 1 } };
  for (let seed = 1; seed <= 15; seed++) {
    const k = keys(run(initialChorusState(4, 100), settings, 12 + 24, seed));
    // round 1 = start key + 11 others
    assert.equal(new Set(k.slice(0, 12)).size, 12, `round 1, seed ${seed}`);
    assert.equal(k[0], 4);
    // later rounds are each a full permutation, and never repeat across the seam
    assert.equal(new Set(k.slice(12, 24)).size, 12, `round 2, seed ${seed}`);
    assert.equal(new Set(k.slice(24, 36)).size, 12, `round 3, seed ${seed}`);
    for (let i = 1; i < k.length; i++) assert.notEqual(k[i], k[i - 1]);
  }
});

test('random: circle of fifths, fourths and chromatic', () => {
  const mk = (randomMode) => ({ ...OFF, modulation: { type: 'random', randomMode, everyLoops: 1 } });
  assert.deepEqual(keys(run(initialChorusState(0, 100), mk('fifths'), 13)), [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5, 0]);
  assert.deepEqual(keys(run(initialChorusState(0, 100), mk('fourths'), 6)), [0, 5, 10, 3, 8, 1]);
  assert.deepEqual(keys(run(initialChorusState(10, 100), mk('chromatic'), 5)), [10, 11, 0, 1, 2]);
});

test('random key every N choruses', () => {
  const settings = { ...OFF, modulation: { type: 'random', randomMode: 'no-repeat', everyLoops: 2 } };
  const k = keys(run(initialChorusState(0, 100), settings, 8, 9));
  assert.equal(k[0], k[1]);
  assert.notEqual(k[1], k[2]);
  assert.equal(k[2], k[3]);
  assert.notEqual(k[3], k[4]);
});

test('planning is pure: the same inputs give the same next chorus (safe for previews)', () => {
  const settings = { ...OFF, modulation: { type: 'random', randomMode: 'shuffle', everyLoops: 1 } };
  const s = initialChorusState(2, 120);
  assert.deepEqual(nextChorusState(s, settings, 77), nextChorusState(s, settings, 77));
  assert.equal(s.bag, null); // input untouched
});

test('helpers', () => {
  assert.equal(describeInterval(2), '+2 semitones (major 2nd up)');
  assert.equal(describeInterval(-1), '−1 semitone (minor 2nd down)');
  assert.equal(describeInterval(6), '+6 semitones (tritone up)');
  assert.equal(clampBpm(10), 40);
  assert.equal(clampBpm(999), 220);
  assert.equal(clampBpm(120.4), 120);
  const r = createRng(5);
  assert.equal(createRng(5).next(), r.next());
});
