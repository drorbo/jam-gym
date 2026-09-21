import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, tryParseChord, transposeChord, absolutePcs, chordParts } from '../src/theory/chord.js';
import {
  parseProgression, transposeBars, transposeProgressionText, allocateBeats, splitBars,
} from '../src/theory/progression.js';
import { formatKey, parseKey, transposeKey, keyPrefersFlats } from '../src/theory/keys.js';
import { parseNoteName, mod12 } from '../src/theory/notes.js';

const ivs = (sym) => parseChord(sym).pcs;

test('parses common chord qualities into the right intervals', () => {
  assert.deepEqual(ivs('C'), [0, 4, 7]);
  assert.deepEqual(ivs('Cm'), [0, 3, 7]);
  assert.deepEqual(ivs('Cmaj7'), [0, 4, 7, 11]);
  assert.deepEqual(ivs('CM7'), [0, 4, 7, 11]);
  assert.deepEqual(ivs('CΔ'), [0, 4, 7, 11]);
  assert.deepEqual(ivs('Cm7'), [0, 3, 7, 10]);
  assert.deepEqual(ivs('C-7'), [0, 3, 7, 10]);
  assert.deepEqual(ivs('C7'), [0, 4, 7, 10]);
  assert.deepEqual(ivs('Cm7b5'), [0, 3, 6, 10]);
  assert.deepEqual(ivs('Cø'), [0, 3, 6, 10]);
  assert.deepEqual(ivs('Cdim'), [0, 3, 6]);
  assert.deepEqual(ivs('Cdim7'), [0, 3, 6, 9]);
  assert.deepEqual(ivs('C°7'), [0, 3, 6, 9]);
  assert.deepEqual(ivs('Csus4'), [0, 5, 7]);
  assert.deepEqual(ivs('Csus2'), [0, 2, 7]);
  assert.deepEqual(ivs('C7sus4'), [0, 5, 7, 10]);
  assert.deepEqual(ivs('Cadd9'), [0, 2, 4, 7]);
  assert.deepEqual(ivs('C6'), [0, 4, 7, 9]);
  assert.deepEqual(ivs('Cm6'), [0, 3, 7, 9]);
  assert.deepEqual(ivs('C6/9'), [0, 2, 4, 7, 9]);
  assert.deepEqual(ivs('Caug'), [0, 4, 8]);
  assert.deepEqual(ivs('C+'), [0, 4, 8]);
  assert.deepEqual(ivs('C5'), [0, 7]);
});

test('parses extensions and alterations', () => {
  assert.deepEqual(ivs('C9'), [0, 2, 4, 7, 10]);
  assert.deepEqual(ivs('Cmaj9'), [0, 2, 4, 7, 11]);
  assert.deepEqual(ivs('Cm9'), [0, 2, 3, 7, 10]);
  assert.deepEqual(ivs('C13'), [0, 2, 4, 7, 9, 10]);
  assert.deepEqual(ivs('C7b9'), [0, 1, 4, 7, 10]);
  assert.deepEqual(ivs('C7#9'), [0, 3, 4, 7, 10]);
  assert.deepEqual(ivs('C7#11'), [0, 4, 6, 7, 10]);
  assert.deepEqual(ivs('C7b13'), [0, 4, 7, 8, 10]);
  assert.deepEqual(ivs('C7#5'), [0, 4, 8, 10]);
  assert.deepEqual(ivs('Cmaj7#11'), [0, 4, 6, 7, 11]);
  assert.deepEqual(ivs('Cm(maj7)'), [0, 3, 7, 11]);
  assert.deepEqual(ivs('CmMaj7'), [0, 3, 7, 11]);
  assert.ok(parseChord('C7alt').pcs.includes(1));
});

test('classifies chord families', () => {
  const fam = (s) => parseChord(s).family;
  assert.equal(fam('Cmaj7'), 'major');
  assert.equal(fam('C6'), 'major');
  assert.equal(fam('C'), 'major');
  assert.equal(fam('Cm7'), 'minor');
  assert.equal(fam('C7'), 'dominant');
  assert.equal(fam('C13'), 'dominant');
  assert.equal(fam('Cm7b5'), 'halfdim');
  assert.equal(fam('Cdim7'), 'dim');
  assert.equal(fam('Caug'), 'aug');
  assert.equal(fam('Csus4'), 'sus');
  assert.equal(fam('C5'), 'power');
});

test('parses roots, accidentals and slash basses', () => {
  const c = parseChord('Bbmaj7/D');
  assert.equal(c.root, 10);
  assert.equal(c.rootName, 'Bb');
  assert.equal(c.bass, 2);
  assert.equal(c.symbol, 'Bbmaj7/D');
  assert.equal(parseChord('f#m7').root, 6);
  assert.equal(parseChord('F♯m7').rootName, 'F#');
  assert.equal(parseChord('E♭').rootName, 'Eb');
  assert.equal(parseChord('bb7').rootName, 'Bb');
  assert.equal(parseChord('b7').rootName, 'B');
  assert.equal(parseChord('C/E').bass, 4);
  assert.equal(parseChord('C6/9').bass, null);
});

test('rejects nonsense with a useful message', () => {
  for (const bad of ['', 'H7', 'Cxyz', 'C7b', 'Cmaj7#', '7', 'C/', 'Cm7b7']) {
    const r = tryParseChord(bad);
    assert.ok('error' in r, `expected "${bad}" to fail`);
  }
  assert.match(tryParseChord('Cxyz').error, /Unrecognised chord quality "xyz"/);
});

test('transposition keeps structure and re-spells the root', () => {
  const up2 = (s, flats = false) => transposeChord(parseChord(s), 2, flats).symbol;
  assert.equal(up2('Cmaj7'), 'Dmaj7');
  assert.equal(up2('Am7'), 'Bm7');
  assert.equal(up2('Dm7'), 'Em7');
  assert.equal(up2('G7'), 'A7');
  assert.equal(up2('Bbm7b5', true), 'Cm7b5');
  assert.equal(up2('D7#9/F#'), 'E7#9/G#');
  assert.equal(transposeChord(parseChord('C'), 1, true).symbol, 'Db');
  assert.equal(transposeChord(parseChord('C'), 1, false).symbol, 'C#');
  // structure is untouched
  const t = transposeChord(parseChord('Cm7b5'), 5, true);
  assert.deepEqual(t.pcs, parseChord('Cm7b5').pcs);
  assert.equal(t.family, 'halfdim');
  // zero shift preserves the user's own spelling
  assert.equal(transposeChord(parseChord('C#m7'), 0, true).symbol, 'C#m7');
  assert.equal(transposeChord(parseChord('C#m7'), 12, true).symbol, 'C#m7');
});

test('every chord survives all 12 transpositions', () => {
  const symbols = ['Cmaj7', 'Am7', 'Dm7b5', 'G7#9', 'Bdim7', 'Fsus4', 'Eb6/9', 'F#m11', 'C7alt', 'Abadd9/C'];
  for (const sym of symbols) {
    const chord = parseChord(sym);
    for (let n = 0; n < 12; n++) {
      for (const flats of [true, false]) {
        const t = transposeChord(chord, n, flats);
        assert.equal(t.root, mod12(chord.root + n));
        assert.equal(parseChord(t.symbol).root, t.root, `${sym} +${n} -> ${t.symbol}`);
        assert.deepEqual(parseChord(t.symbol).pcs, chord.pcs);
        // going back restores the same absolute pitch classes
        const back = transposeChord(t, -n, flats);
        assert.deepEqual(absolutePcs(back), absolutePcs(chord));
      }
    }
  }
});

test('absolutePcs returns real pitch classes', () => {
  assert.deepEqual(absolutePcs(parseChord('G7')), [7, 11, 2, 5]);
});

test('chordParts builds display parts with typographic accidentals', () => {
  assert.deepEqual(chordParts(parseChord('Bbm7b5/Eb')), {
    letter: 'B', accidental: '♭', suffix: 'm7♭5', bassLetter: 'E', bassAccidental: '♭',
  });
});

test('progressions: spec example parses and transposes to D', () => {
  const { bars, ok } = parseProgression('Cmaj7 | Am7 | Dm7 | G7');
  assert.ok(ok);
  assert.equal(bars.length, 4);
  const up = transposeBars(bars, 2, false);
  assert.deepEqual(up.map((b) => b.source), ['Dmaj7', 'Bm7', 'Em7', 'A7']);
});

test('progressions: flat keys spell with flats', () => {
  const { bars } = parseProgression('Cm7 | F7 | Bbmaj7');
  assert.equal(bars.length, 3);
  const up = transposeBars(bars, 5, true);
  assert.deepEqual(up.map((b) => b.source), ['Fm7', 'Bb7', 'Ebmaj7']);
});

test('progressions: multiple chords per bar share beats', () => {
  assert.deepEqual(allocateBeats(1, 4), [4]);
  assert.deepEqual(allocateBeats(2, 4), [2, 2]);
  assert.deepEqual(allocateBeats(3, 4), [2, 1, 1]);
  assert.deepEqual(allocateBeats(4, 4), [1, 1, 1, 1]);
  const { bars } = parseProgression('Dm7 G7 | Cmaj7');
  assert.deepEqual(bars[0].chords.map((s) => [s.startBeat, s.beats]), [[0, 2], [2, 2]]);
  assert.deepEqual(bars[1].chords.map((s) => [s.startBeat, s.beats]), [[0, 4]]);
});

test('progressions: newlines, repeat signs, commas, % and NC', () => {
  assert.equal(parseProgression('Cmaj7 | Am7 |\nDm7 | G7 |').bars.length, 4);
  assert.equal(parseProgression('||: C | F :||').bars.length, 2);
  assert.equal(parseProgression('C\nF\nG').bars.length, 3);
  assert.equal(parseProgression('Dm7, G7 | C').bars[0].chords.length, 2);
  const rep = parseProgression('C7 | % | F7 | %');
  assert.ok(rep.ok);
  assert.equal(rep.bars[1].chords[0].chord.symbol, 'C7');
  assert.equal(rep.bars[3].chords[0].chord.symbol, 'F7');
  const nc = parseProgression('C | N.C. | G');
  assert.equal(nc.bars[1].chords[0].chord, null);
  assert.deepEqual(splitBars(['C', 'F G']), ['C', 'F G']);
});

test('progressions: reports every problem, with the bar number', () => {
  const r = parseProgression('Cmaj7 | Hm7 | G7 | C D E F G');
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0].message, /Bar 2/);
  assert.match(r.errors[1].message, /at most 4/);
  assert.equal(parseProgression('% | C').ok, false);
  assert.equal(parseProgression('').ok, false);
  assert.equal(parseProgression('  |  | ').ok, false);
});

test('progression text transposes in place, keeping layout and non-chords', () => {
  assert.equal(
    transposeProgressionText('Cmaj7 | Am7\nDm7 G7 | % | NC', 2, false),
    'Dmaj7 | Bm7\nEm7 A7 | % | NC',
  );
  assert.equal(transposeProgressionText('C7 | oops', 0, false), 'C7 | oops');
  assert.equal(transposeProgressionText('C7 | oops', 1, true), 'Db7 | oops');
});

test('unusual progressions parse', () => {
  const wild = 'C13sus4 | F#m7b5/C | Bbmaj7#11 | E7#9b13 | Adim7/Eb | Db6/9 | G+7 | Ab5';
  const r = parseProgression(wild);
  assert.deepEqual(r.errors, []);
  assert.equal(r.bars.length, 8);
  for (let n = 0; n < 12; n++) {
    assert.equal(transposeBars(r.bars, n, n % 2 === 0).length, 8);
  }
});

test('keys', () => {
  assert.deepEqual(parseKey('Am'), { pc: 9, minor: true });
  assert.deepEqual(parseKey('Bb'), { pc: 10, minor: false });
  assert.equal(parseKey('H'), null);
  assert.equal(formatKey(3), 'Eb');
  assert.equal(formatKey(4), 'E');
  assert.equal(formatKey(6), 'F#');
  assert.equal(formatKey(2, true), 'Dm');
  assert.equal(transposeKey('C', 2), 'D');
  assert.equal(transposeKey('Am', 3), 'Cm');
  assert.equal(keyPrefersFlats(10), true);
  assert.equal(keyPrefersFlats(7), false);
  assert.equal(parseNoteName('E♭'), 3);
});
