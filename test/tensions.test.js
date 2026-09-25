// Tensions in the keys: what the Harmony setting may add, and what the chord symbol says.
//   - a tension written in the symbol is always played, whatever the Harmony setting
//   - no other tension of the same kind is added on top of it (a written 9 keeps out b9 and #9, and so on)
//   - a chord that spells out a natural 9 or 13 is not altered, even at the Altered setting
//   - major chords never get an 11 or a #11 from Extended or Upper structures; the Altered level adds a #11 only now and then

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChord } from '../src/theory/chord.js';
import { keyPcs, rockNotes, writtenTensions } from '../src/styles/comping.js';
import { getStyle, renderBar } from '../src/styles/index.js';
import { parseProgression } from '../src/theory/progression.js';
import { getMeter } from '../src/theory/meter.js';
import { createRng } from '../src/engine/rng.js';
import { mod12 } from '../src/theory/notes.js';

const LEVELS = [0, 1, 2, 3, 4];
/** The pitch classes above the root that the keys play, as a sorted list. */
const voicing = (symbol, style, level, seed = 1) => {
  const c = parseChord(symbol);
  return [...new Set(keyPcs(c, style, level, createRng(seed)).map((pc) => mod12(pc - c.root)))].sort((a, b) => a - b);
};
/** Everything the keys play over many random draws (the Altered level chooses "sometimes"). */
const everSeen = (symbol, style, level) => {
  const seen = new Set();
  for (let seed = 1; seed <= 80; seed++) for (const pc of voicing(symbol, style, level, seed)) seen.add(pc);
  return seen;
};
const alwaysHas = (symbol, style, level, pcs) => {
  for (let seed = 1; seed <= 40; seed++) {
    const v = voicing(symbol, style, level, seed);
    for (const pc of pcs) if (!v.includes(pc)) return false;
  }
  return true;
};

// ---- what is written ------------------------------------------------------------------------

test('the tensions a symbol spells out', () => {
  const w = (s) => writtenTensions(parseChord(s)).sort((a, b) => a - b);
  assert.deepEqual(w('Cmaj7'), []);
  assert.deepEqual(w('C7'), []);
  assert.deepEqual(w('F79'), [2]);
  assert.deepEqual(w('F9'), [2]);
  assert.deepEqual(w('F7b9'), [1]);
  assert.deepEqual(w('F7#9'), [3]);
  assert.deepEqual(w('F713'), [2, 9]);
  assert.deepEqual(w('F7b13'), [8]);
  assert.deepEqual(w('G7#9b13'), [3, 8]);
  assert.deepEqual(w('F7#11'), [6]);
  assert.deepEqual(w('F7#5'), [8]);
  assert.deepEqual(w('F7b5'), [6]);
  assert.deepEqual(w('F7alt'), [1, 3, 6, 8]);
  assert.deepEqual(w('Cmaj9'), [2]);
  assert.deepEqual(w('Cmaj7#11'), [6]);
  assert.deepEqual(w('Cm11'), [2, 5]);
  assert.deepEqual(w('C6/9'), [2]);
  assert.deepEqual(w('Cadd9'), [2]);
  assert.deepEqual(w('C6'), [], 'the sixth is the guide tone of a 6 chord');
});

test('a tension written in the symbol is played at every Harmony setting, in jazz and in the blues', () => {
  const cases = {
    F79: [2], F9: [2], F7b9: [1], 'F7#9': [3], F713: [2, 9], F7b13: [8], 'G7#9b13': [3, 8], 'F7#11': [6], 'F7#5': [8], F7b5: [6],
    F7alt: [1, 3, 6, 8], Cmaj9: [2], Cmaj13: [2, 9], 'Cmaj7#11': [6], 'C6/9': [2], Cadd9: [2], Cm9: [2], Cm11: [2, 5], Cm7b9: [1],
  };
  for (const style of ['jazz', 'blues']) {
    for (const [symbol, pcs] of Object.entries(cases)) {
      for (const level of LEVELS) assert.ok(alwaysHas(symbol, style, level, pcs), `${style} ${symbol} at level ${level} misses a written tension (${pcs}), plays ${voicing(symbol, style, level)}`);
    }
  }
});

test('nothing is added on top of a written tension: one 9, one 13, one 11 and one fifth, as written', () => {
  const NINES = [1, 2, 3];
  const THIRTEENS = [8, 9];
  const only = (symbol, style, level, group, want) => {
    for (let seed = 1; seed <= 60; seed++) {
      const got = voicing(symbol, style, level, seed).filter((pc) => group.includes(pc));
      assert.deepEqual(got, want, `${style} ${symbol} level ${level}: plays ${got} of ${group}, wanted ${want}`);
    }
  };
  for (const style of ['jazz', 'blues']) {
    for (const level of LEVELS) {
      only('F79', style, level, NINES, [2]);
      only('F7b9', style, level, NINES, [1]);
      only('F7#9', style, level, NINES, [3]);
      only('F713', style, level, THIRTEENS, [9]);
      only('F7b13', style, level, THIRTEENS, [8]);
      only('G7#9b13', style, level, NINES, [3]);
      only('G7#9b13', style, level, THIRTEENS, [8]);
    }
  }
  // an altered fifth replaces the natural one, and a #5 is not a 13 as well
  for (const level of LEVELS) {
    assert.ok(!everSeen('F7#5', 'jazz', level).has(7) && !everSeen('F7#5', 'jazz', level).has(9), `F7#5 level ${level}`);
    assert.ok(!everSeen('F7b5', 'jazz', level).has(7), `F7b5 level ${level}`);
  }
});

test('a chord with a natural 9 or 13 is not altered: no b9, #9, b13 or #11, even at the Altered setting', () => {
  for (const symbol of ['F79', 'F9', 'F713', 'F13', 'Cmaj9', 'Cmaj13', 'Cm9']) {
    const seen = everSeen(symbol, 'jazz', 4);
    for (const bad of [1, 3, 6, 8]) {
      if (symbol.startsWith('Cm') && bad === 3) continue; // the minor third is pitch class 3
      assert.ok(!seen.has(bad), `${symbol} at Altered played ${bad}`);
    }
  }
  // and the Altered level then sounds like the level below it (the natural upper structure)
  for (const symbol of ['F79', 'F713']) assert.deepEqual(voicing(symbol, 'jazz', 4), voicing(symbol, 'jazz', 3), symbol);
  // the blues sharp nine is not added to a chord that writes a natural nine
  assert.ok(!voicing('F79', 'blues', 4).includes(3));
  assert.ok(voicing('F7', 'blues', 4).includes(3), 'but a plain dominant still gets the Hendrix chord');
});

// ---- what the Harmony setting may add ---------------------------------------------------------

test('major chords never get an 11 or a #11 from Shells up to Upper structures; they get 9s and 13s', () => {
  for (const symbol of ['Cmaj7', 'Cmaj9', 'C6', 'Cmaj13', 'C']) {
    for (const level of [0, 1, 2, 3]) {
      const seen = everSeen(symbol, 'jazz', level);
      assert.ok(!seen.has(5) && !seen.has(6), `${symbol} at level ${level} plays an 11 or #11: ${[...seen]}`);
    }
  }
  assert.ok(voicing('Cmaj7', 'jazz', 2).includes(2) && voicing('Cmaj7', 'jazz', 2).includes(9), 'Extended: the 9th and 13th');
  assert.deepEqual(voicing('Cmaj7', 'jazz', 3), [2, 4, 9, 11], 'Upper structures: 3rd, 7th, 9th and 13th');
  // and the natural 11 is never played on a major chord at all, at any level
  for (const level of LEVELS) assert.ok(!everSeen('Cmaj7', 'jazz', level).has(5), `an 11 on Cmaj7 at level ${level}`);
});

test('a #11 appears only at the Altered level, only now and then, and never on a chord that writes a natural tension', () => {
  const share = (symbol, level, pc) => {
    let n = 0;
    for (let seed = 1; seed <= 200; seed++) if (voicing(symbol, 'jazz', level, seed).includes(pc)) n++;
    return n / 200;
  };
  for (const symbol of ['Cmaj7', 'G7', 'F7']) {
    for (const level of [0, 1, 2, 3]) assert.equal(share(symbol, level, 6), 0, `${symbol} level ${level} has a #11`);
    const sometimes = share(symbol, 4, 6);
    assert.ok(sometimes > 0.15 && sometimes < 0.6, `${symbol} at Altered plays #11 ${sometimes * 100}% of the time`);
  }
  // without an rng (nothing to draw from) it never happens
  const c = parseChord('Cmaj7');
  assert.ok(!keyPcs(c, 'jazz', 4).some((pc) => mod12(pc - c.root) === 6));
  // a written #11 is always there
  assert.equal(share('Cmaj7#11', 4, 6), 1);
  assert.equal(share('F7#11', 0, 6), 1);
});

test('an altered dominant gets its alterations: b9, #9 (or now and then a #11 instead) and b13, and no natural 9 or 13', () => {
  const seen = everSeen('G7', 'jazz', 4);
  for (const pc of [1, 3, 6, 8]) assert.ok(seen.has(pc), `Altered G7 never plays ${pc}`);
  for (let seed = 1; seed <= 60; seed++) {
    const v = voicing('G7', 'jazz', 4, seed);
    assert.ok(v.includes(1) && v.includes(8) && (v.includes(3) || v.includes(6)), `seed ${seed}: ${v}`);
    assert.ok(!v.includes(2) && !v.includes(9), `seed ${seed}: a natural 9 or 13 in an altered chord`);
  }
  // written alterations stay, and the other tensions do not fight them
  const b9 = everSeen('F7b9', 'jazz', 4);
  assert.ok(b9.has(1) && !b9.has(2));
});

test('minor chords and half-diminished chords keep their usual voicings, including the natural 11', () => {
  assert.deepEqual(voicing('F#m7b5', 'jazz', 1), [3, 5, 6, 10]);
  assert.ok(voicing('Cm7', 'jazz', 2).includes(5), 'a minor chord may have its 11th');
  assert.ok(everSeen('Cm7', 'jazz', 3).has(5));
  assert.deepEqual(voicing('Dm7', 'jazz', 0), [3, 10]);
});

// ---- rock guitar and end to end ---------------------------------------------------------------

test('rock guitar plays a tension written in the symbol on top of its chord, and leaves palm-muted chugs alone', () => {
  const plain = rockNotes(parseChord('C7'), 0);
  const nine = rockNotes(parseChord('C9'), 0);
  assert.equal(nine.length, plain.length + 1, 'one extra note');
  assert.ok(nine.some((m) => mod12(m) === 2), 'the D of a C9');
  assert.deepEqual(rockNotes(parseChord('C9'), 0, { muted: true }), rockNotes(parseChord('C7'), 0, { muted: true }), 'muted chugs are unchanged');
  assert.ok(rockNotes(parseChord('C7#9'), 2).some((m) => mod12(m) === 3));
  assert.deepEqual(rockNotes(parseChord('C'), 3).map((m) => mod12(m)), [0, 7, 0, 4, 2], 'a chord with nothing written is as it was: power chord, third, and the add 9');
});

test('end to end: the keys play the 9th of an F79 at every Harmony setting, and no G-flat, G-sharp or D-flat with it', () => {
  const style = getStyle('jazz');
  const { bars } = parseProgression('F79 | F79 | F79 | F79');
  for (const tension of [0, 25, 50, 75, 100]) {
    const seen = new Set();
    const state = {};
    bars.forEach((bar, i) => {
      for (const e of renderBar(style, {
        segments: bar.chords, nextChord: bar.chords[0].chord, barIndex: i, barCount: 4, isFirstBar: i === 0, isLastBar: i === 3, chorus: 1, bpm: 120,
        meter: getMeter('4/4'), beatsPerBar: 4, state, comp: { tension, density: 100 }, seed: 1, rng: createRng(100 + i),
      })) if (e.inst === 'chords') seen.add(e.midi % 12);
    });
    assert.ok(seen.has(7), `Harmony ${tension}: no G (the 9th) in F79: ${[...seen]}`);
    for (const bad of [6, 8, 1]) assert.ok(!seen.has(bad), `Harmony ${tension}: F79 played ${bad}`);
  }
});
