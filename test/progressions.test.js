import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRESSION_GROUPS, groupForStyle } from '../src/app/progressions.js';
import { inKey } from '../src/app/quick-ui.js';
import { MAJOR_KEYS } from '../src/theory/keys.js';
import { parseProgression } from '../src/theory/progression.js';
import { METER_IDS } from '../src/theory/meter.js';
import { listStyles } from '../src/styles/index.js';

const items = PROGRESSION_GROUPS.flatMap((g) => g.items.map((ex) => ({ ...ex, group: g.id })));

test('every quick progression parses, in its own meter and in all twelve keys', () => {
  for (const ex of items) {
    for (const key of MAJOR_KEYS) {
      const text = inKey(ex.text, key);
      const r = parseProgression(text, { timeSignature: ex.timeSignature ?? '4/4' });
      assert.ok(r.ok, `${ex.name} in ${key}: ${JSON.stringify(r.errors)}`);
      assert.equal(r.bars.length, parseProgression(ex.text, { timeSignature: ex.timeSignature ?? '4/4' }).bars.length);
    }
  }
});

test('there is a group for every style plus the odd meters, with no repeated names, and only odd-meter examples set a meter', () => {
  const ids = PROGRESSION_GROUPS.map((g) => g.id);
  for (const s of listStyles()) assert.ok(ids.includes(s.id), `${s.id} has no quick progressions`);
  assert.ok(ids.includes('odd'));
  assert.equal(new Set(items.map((e) => e.name)).size, items.length, 'two chips share a name');
  for (const ex of items) {
    if (ex.group === 'odd') assert.ok(METER_IDS.includes(ex.timeSignature) && ex.timeSignature !== '4/4', `${ex.name} needs an odd meter`);
    else assert.equal(ex.timeSignature, undefined, `${ex.name} would change the meter`);
    assert.ok(!('style' in ex), `${ex.name} would change the style`);
  }
  assert.equal(groupForStyle('blues').id, 'blues');
  assert.equal(groupForStyle('nonsense').id, 'jazz');
});

test('the blues progressions are what they say', () => {
  const bars = (name) => parseProgression(items.find((e) => e.name === name).text).bars.map((b) => b.chords[0].chord.symbol);
  assert.deepEqual(bars('12-bar blues'), ['C7', 'C7', 'C7', 'C7', 'F7', 'F7', 'C7', 'C7', 'G7', 'F7', 'C7', 'G7']);
  assert.deepEqual(bars('Quick-change blues').slice(0, 2), ['C7', 'F7']);
  assert.equal(bars('Minor blues').length, 12);
  assert.equal(bars('8-bar blues').length, 8);
});

test('a quick progression moves into the starting key, spelled for that key', () => {
  assert.equal(inKey('Dm7 | G7 | Cmaj7', 'C'), 'Dm7 | G7 | Cmaj7');
  assert.equal(inKey('Dm7 | G7 | Cmaj7', 'Bb'), 'Cm7 | F7 | Bbmaj7');
  assert.equal(inKey('Dm7 | G7 | Cmaj7', 'F#'), 'G#m7 | C#7 | F#maj7');
  assert.equal(inKey('Dm7 | G7 | Cmaj7', 'nonsense'), 'Dm7 | G7 | Cmaj7');
});
