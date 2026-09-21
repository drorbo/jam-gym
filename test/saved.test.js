import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_NAME, MAX_SAVED, cleanName, describeSaved, findByName, removeSaved, restoreSaved,
  sanitizeSaved, saveSnapshot, signatureOf, sortSaved,
} from '../src/app/saved.js';

const snap = (over = {}) => ({
  name: 'Giant steps A', text: 'Bmaj7 D7 | Gmaj7 Bb7 | Ebmaj7', key: 'B', timeSignature: '4/4', style: 'jazz', tempo: 140, swing: 62, ...over,
});

test('names are trimmed and whitespace-collapsed', () => {
  assert.equal(cleanName('  My   tune  '), 'My tune');
  assert.equal(cleanName(undefined), '');
  assert.equal(cleanName('x'.repeat(200)).length, MAX_NAME);
});

test('saving adds an entry with everything needed to bring the setup back', () => {
  const r = saveSnapshot([], snap(), 1000);
  assert.ok(r.ok);
  assert.equal(r.updated, false);
  assert.equal(r.list.length, 1);
  assert.deepEqual(
    { ...r.item, id: 'x' },
    { id: 'x', name: 'Giant steps A', text: 'Bmaj7 D7 | Gmaj7 Bb7 | Ebmaj7', key: 'B', timeSignature: '4/4', style: 'jazz', tempo: 140, swing: 62, savedAt: 1000 },
  );
  assert.ok(r.item.id.length > 3);
});

test('saving under an existing name (any case) updates it in place and keeps its id', () => {
  const first = saveSnapshot([], snap(), 1).item;
  const r = saveSnapshot([first], snap({ name: '  GIANT   steps a ', tempo: 200, text: 'C | F' }), 2);
  assert.ok(r.ok && r.updated);
  assert.equal(r.list.length, 1);
  assert.equal(r.item.id, first.id);
  assert.equal(r.item.tempo, 200);
  assert.equal(r.item.text, 'C | F');
  assert.equal(r.item.name, 'GIANT steps a'); // the newest spelling wins
});

test('an empty name or a broken progression is refused with a helpful message', () => {
  assert.deepEqual(saveSnapshot([], snap({ name: '   ' })), { ok: false, error: 'Give it a name first.' });
  const bad = saveSnapshot([], snap({ text: 'Cmaj7 | Xyz' }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Fix the progression/);
  assert.equal(saveSnapshot([], snap({ text: '' })).ok, false);
  // a bar with too many chords for the meter is also refused
  assert.equal(saveSnapshot([], snap({ text: 'C Dm G', timeSignature: '6/8' })).ok, false);
});

test('the list stays alphabetical (ignoring case, numbers in natural order)', () => {
  let list = [];
  for (const name of ['blues 10', 'Autumn', 'blues 2', 'zebra', 'Blues 1']) list = saveSnapshot(list, snap({ name })).list;
  assert.deepEqual(list.map((x) => x.name), ['Autumn', 'Blues 1', 'blues 2', 'blues 10', 'zebra']);
  assert.deepEqual(sortSaved([{ name: 'b' }, { name: 'A' }]).map((x) => x.name), ['A', 'b']);
});

test('delete, and undo by restoring', () => {
  let list = saveSnapshot([], snap({ name: 'One' })).list;
  list = saveSnapshot(list, snap({ name: 'Two' })).list;
  const two = findByName(list, 'two');
  assert.ok(two);
  const after = removeSaved(list, two.id);
  assert.deepEqual(after.map((x) => x.name), ['One']);
  assert.deepEqual(restoreSaved(after, two).map((x) => x.name), ['One', 'Two']);
  // restoring never duplicates, even if the name was re-used meanwhile
  const reused = saveSnapshot(after, snap({ name: 'Two' })).list;
  assert.equal(restoreSaved(reused, two).length, 2);
  assert.equal(removeSaved(list, 'nope').length, 2);
});

test('there is a sensible cap, but updating an existing name still works at the cap', () => {
  let list = [];
  for (let i = 0; i < MAX_SAVED; i++) list = saveSnapshot(list, snap({ name: `Tune ${i}` })).list;
  assert.equal(list.length, MAX_SAVED);
  assert.equal(saveSnapshot(list, snap({ name: 'One more' })).ok, false);
  assert.ok(saveSnapshot(list, snap({ name: 'tune 5', tempo: 90 })).ok);
});

test('signature changes when the progression, key or meter change, not the tempo or style', () => {
  const a = signatureOf({ text: 'C | F', key: 'C', timeSignature: '4/4' });
  assert.equal(a, signatureOf({ text: ' C | F ', key: 'C', timeSignature: '4/4' }));
  assert.notEqual(a, signatureOf({ text: 'C | G', key: 'C', timeSignature: '4/4' }));
  assert.notEqual(a, signatureOf({ text: 'C | F', key: 'D', timeSignature: '4/4' }));
  assert.notEqual(a, signatureOf({ text: 'C | F', key: 'C', timeSignature: '7/8' }));
});

test('describeSaved gives a one-line summary', () => {
  const item = saveSnapshot([], snap({ name: 'x', key: 'Bb', text: 'Bbmaj7 | Gm7 | Cm7 | F7', timeSignature: '7/8', style: 'blues', tempo: 96 })).item;
  assert.equal(describeSaved(item), 'Key of B♭ · 7/8 · Blues · 96 BPM · 4 bars');
  assert.match(describeSaved({ ...item, text: 'C' }), /1 bar$/);
});

test('stored data is validated: bad entries dropped, odd values repaired, order restored', () => {
  const raw = [
    { id: 'a', name: 'Good', text: 'Cmaj7 | Am7', key: 'C', timeSignature: '7/8', style: 'rock', tempo: 999, savedAt: 5 },
    { id: 'a', name: 'Same id', text: 'C | F', key: 'C', timeSignature: '4/4', style: 'nope', tempo: 'fast' },
    { name: '', text: 'C', key: 'C' },
    { name: 'No text', text: '', key: 'C' },
    { name: 'Bad key', text: 'C', key: 'H' },
    { name: 'Bad chords', text: 'C | Xyz', key: 'C' },
    { name: 'Too many chords', text: 'C Dm G', key: 'C', timeSignature: '6/8' },
    { name: 'Odd meter falls back', text: 'C Dm G F', key: 'C', timeSignature: '13/16' },
    null, 'string', 42,
  ];
  const list = sanitizeSaved(raw);
  assert.deepEqual(list.map((x) => x.name), ['Good', 'Odd meter falls back', 'Same id']);
  const good = list.find((x) => x.name === 'Good');
  assert.equal(good.tempo, 220);
  assert.equal(good.timeSignature, '7/8');
  assert.equal(good.style, 'rock');
  const odd = list.find((x) => x.name === 'Odd meter falls back');
  assert.equal(odd.timeSignature, '4/4');
  const same = list.find((x) => x.name === 'Same id');
  assert.equal(same.style, 'jazz');
  assert.equal(same.tempo, 120);
  assert.equal(new Set(list.map((x) => x.id)).size, list.length, 'ids are unique');
  assert.deepEqual(sanitizeSaved('garbage'), []);
  assert.deepEqual(sanitizeSaved(null), []);
});

test('swing is saved with the setup; missing or silly values become "the style default" (null) or are clamped', () => {
  assert.equal(saveSnapshot([], snap({ swing: 58 })).item.swing, 58);
  assert.equal(saveSnapshot([], snap({ swing: 10 })).item.swing, 50);
  assert.equal(saveSnapshot([], snap({ swing: 99 })).item.swing, 75);
  assert.equal(saveSnapshot([], snap({ swing: undefined })).item.swing, null);
  assert.equal(saveSnapshot([], snap({ swing: NaN })).item.swing, null);
  // older stored entries have no swing at all
  const list = sanitizeSaved([
    { id: 'a', name: 'Old', text: 'C | F', key: 'C', timeSignature: '4/4', style: 'blues', tempo: 100 },
    { id: 'b', name: 'New', text: 'C | F', key: 'C', timeSignature: '4/4', style: 'rock', tempo: 120, swing: 60.4 },
    { id: 'c', name: 'Bad', text: 'C | F', key: 'C', timeSignature: '4/4', style: 'rock', tempo: 120, swing: 'lots' },
  ]);
  const by = Object.fromEntries(list.map((x) => [x.name, x.swing]));
  assert.deepEqual(by, { Old: null, New: 60, Bad: null });
});
