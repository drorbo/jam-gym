import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCIDENTALS, QUALITIES, ROOTS, barSymbols, buildSymbol, canEditText, deleteBar, duplicateBar, insertBar, moveBar,
  removeSegment, setChord, splitBar, symbolToPicker, toggleRepeat, tokenizeBars,
} from '../src/theory/baredit.js';
import { parseProgression } from '../src/theory/progression.js';
import { tryParseChord } from '../src/theory/chord.js';
import { METER_IDS } from '../src/theory/meter.js';

const text = (r) => { assert.ok(!r.error, r.error); return r.text; };

test('tokenizing gives the bars as they are in the text, and rewriting nothing gives the text back exactly', () => {
  for (const t of ['Cmaj7 | Am7 | Dm7 G7 | %', 'Cmaj7 Am7\nDm7 G7\n', '|: C | F :|', '  C ,  F | | G  ', 'C || F', '', '   ']) {
    const doc = tokenizeBars(t);
    assert.equal(doc.lead + doc.bars.map((b) => b.content + b.sep).join(''), t, JSON.stringify(t));
  }
  assert.deepEqual(tokenizeBars('Cmaj7 | Am7 | Dm7 G7 | %').bars.map((b) => b.content), ['Cmaj7', 'Am7', 'Dm7 G7', '%']);
  assert.deepEqual(tokenizeBars('C | | F').bars.map((b) => b.content), ['C', 'F']); // blank bars are not bars, as in the parser
});

test('bar numbers match the parser whenever every bar parses', () => {
  const t = 'Cmaj7 | Am7 | Dm7 G7 | %';
  const parsed = parseProgression(t).bars.map((b) => b.source);
  assert.equal(tokenizeBars(t).bars.length, parsed.length);
});

test('classifying tokens', () => {
  const kinds = (t) => tokenizeBars(t).bars.map((b) => b.tokens.map((x) => x.kind));
  assert.deepEqual(kinds('C | % | NC | n.c. G | Zzz'), [['chord'], ['repeat'], ['nc'], ['nc', 'chord'], ['invalid']]);
  assert.equal(canEditText('C | F'), true);
  assert.equal(canEditText('C | Zzz'), false);
});

test('setChord changes one chord and leaves everything else untouched', () => {
  assert.equal(text(setChord('Cmaj7 | Am7 | Dm7 G7 | Cmaj7', 1, 0, 'A7')), 'Cmaj7 | A7 | Dm7 G7 | Cmaj7');
  assert.equal(text(setChord('Cmaj7 | Am7 | Dm7 G7 | Cmaj7', 2, 1, 'G7#9')), 'Cmaj7 | Am7 | Dm7 G7#9 | Cmaj7');
  assert.equal(text(setChord('C\nF\nG', 1, 0, 'Bb')), 'C\nBb\nG'); // line breaks stay
  assert.equal(text(setChord('|: C | F :|', 0, 0, 'D')), '|: D | F :|'); // repeat signs stay
  assert.equal(text(setChord('C | F', 1, 0, 'nc')), 'C | NC');
  assert.ok(setChord('C | F', 1, 0, 'Q9').error);
  assert.ok(setChord('C | F', 5, 0, 'D').error);
  assert.ok(setChord('C | F', 0, 3, 'D').error);
});

test('editing a repeat bar writes it out first', () => {
  assert.equal(text(setChord('Cmaj7 | Am7 | %', 2, 0, 'Fmaj7')), 'Cmaj7 | Am7 | Fmaj7');
});

test('editing the bar a repeat points to carries the repeat with it', () => {
  assert.equal(text(setChord('C | %', 0, 0, 'D')), 'D | %');
  const p = parseProgression(text(setChord('C | %', 0, 0, 'D')));
  assert.equal(p.bars[1].chords[0].chord.symbol, 'D');
});

test('insert, duplicate and delete bars', () => {
  assert.equal(text(insertBar('C | F', 0, 'G')), 'C | G | F');
  assert.equal(text(insertBar('C | F', 1, 'G')), 'C | F | G');
  assert.equal(text(insertBar('C | F', -1, 'G')), 'G | C | F');
  assert.equal(text(insertBar('C | F', 1)), 'C | F | F'); // copies the bar by default
  assert.equal(text(insertBar('', -1)), 'C');
  assert.equal(text(duplicateBar('C | Dm7 G7 | F', 1)), 'C | Dm7 G7 | Dm7 G7 | F');
  assert.equal(text(duplicateBar('C | F', 1)), 'C | F | F');
  assert.equal(text(insertBar('C\nF', 1, 'G')), 'C\nF\nG');
  assert.equal(text(deleteBar('C | F | G', 1)), 'C | G');
  assert.equal(text(deleteBar('C | F | G', 2)), 'C | F');
  assert.equal(text(deleteBar('C | F | G', 0)), 'F | G');
  assert.equal(text(deleteBar('C | F\n', 1)), 'C\n');
  assert.equal(text(deleteBar('C', 0)), '');
});

test('a repeat sign is not left repeating the wrong bar when its source is deleted or moved', () => {
  const meaning = (t) => parseProgression(t).bars.map((b) => b.chords.map((s) => s.chord.symbol).join(' '));
  assert.deepEqual(meaning('C | F | %'), ['C', 'F', 'F']);
  // deleting the F bar: the repeat keeps meaning F
  assert.deepEqual(meaning(text(deleteBar('C | F | %', 1))), ['C', 'F']);
  // moving the F bar earlier: the repeat still means F
  assert.deepEqual(meaning(text(moveBar('C | F | %', 1, -1))), ['F', 'C', 'F']);
  // moving the repeat itself earlier
  assert.deepEqual(meaning(text(moveBar('C | F | %', 2, -1))), ['C', 'F', 'F']);
});

test('moving bars swaps them and keeps the separators in place', () => {
  assert.equal(text(moveBar('C | F | G', 0, 1)), 'F | C | G');
  assert.equal(text(moveBar('C\nF\nG', 2, -1)), 'C\nG\nF');
  assert.ok(moveBar('C | F', 0, -1).error);
  assert.ok(moveBar('C | F', 1, 1).error);
});

test('splitting a bar adds a chord, up to what the time signature fits', () => {
  assert.equal(text(splitBar('C | F', 0)), 'C C | F');
  assert.equal(text(splitBar('C C | F', 0)), 'C C C | F');
  assert.ok(splitBar('C C C C | F', 0, '4/4').error);
  assert.ok(splitBar('C C | F', 0, '6/8').error); // 6/8 fits two
  assert.equal(text(splitBar('C C | F', 0, '7/8')), 'C C C | F'); // 7/8 fits three
  assert.ok(splitBar('C C C | F', 0, '7/8').error);
  for (const id of METER_IDS) {
    let t = 'C';
    for (let n = 0; n < 12; n += 1) { const r = splitBar(t, 0, id); if (r.error) break; t = r.text; }
    assert.ok(parseProgression(t, { timeSignature: id }).ok, `${id}: ${t}`);
  }
});

test('removing a chord from a bar', () => {
  assert.equal(text(removeSegment('Dm7 G7 | C', 0, 0)), 'G7 | C');
  assert.ok(removeSegment('C | F', 0, 0).error);
});

test('repeat toggling', () => {
  assert.equal(text(toggleRepeat('C | F | G', 1)), 'C | % | G');
  assert.equal(text(toggleRepeat('C | % | G', 1)), 'C | C | G');
  assert.ok(toggleRepeat('C | F', 0).error);
});

test('bars with a chord the parser does not know are left alone, and structural edits explain why', () => {
  const t = 'C | Zzz | G';
  assert.ok(setChord(t, 0, 0, 'D').error);
  assert.ok(deleteBar(t, 0).error);
  assert.ok(insertBar(t, 0, 'D').error);
});

test('barSymbols shows what a bar plays, following repeats', () => {
  assert.deepEqual(barSymbols('Cmaj7 | Dm7 NC | %', 1), ['Dm7', 'NC']);
  assert.deepEqual(barSymbols('Cmaj7 | Dm7 NC | %', 2), ['Dm7', 'NC']);
  assert.deepEqual(barSymbols('C', 4), []);
});

test('every chord the picker can build is one the parser accepts', () => {
  const bad = [];
  for (const root of ROOTS) {
    for (const [, acc] of ACCIDENTALS) {
      for (const [, quality] of QUALITIES) {
        for (const bass of ['', 'C', 'F#', 'Bb']) {
          const symbol = buildSymbol({ root, acc, quality, bass });
          if (!symbol) { bad.push(`${root}${acc}${quality}/${bass}`); continue; }
          const c = tryParseChord(symbol);
          if ('error' in c) bad.push(symbol);
          else if (c.chord.symbol !== symbol) bad.push(`${symbol} -> ${c.chord.symbol}`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('the picker qualities are all different, and each means something different to the parser', () => {
  assert.equal(new Set(QUALITIES.map((q) => q[1])).size, QUALITIES.length);
  assert.equal(new Set(QUALITIES.map((q) => q[0])).size, QUALITIES.length);
});

test('a chord symbol goes back into the picker and builds the same symbol', () => {
  for (const s of ['Cmaj7', 'F#m7b5', 'Bb7#9/D', 'Ebsus4', 'A', 'G13']) {
    const parts = symbolToPicker(s);
    assert.ok(parts, s);
    assert.equal(buildSymbol(parts), s);
  }
  assert.equal(symbolToPicker('NC'), null);
  assert.equal(symbolToPicker('nonsense'), null);
});

test('after any edit the text still parses cleanly', () => {
  let t = 'Cmaj7 | Am7 | Dm7 G7 | Cmaj7';
  const steps = [
    (x) => setChord(x, 1, 0, 'F#m7b5'), (x) => splitBar(x, 0), (x) => duplicateBar(x, 2), (x) => moveBar(x, 0, 1),
    (x) => toggleRepeat(x, 3), (x) => deleteBar(x, 1), (x) => insertBar(x, 0, 'Bb13'), (x) => removeSegment(x, 0, 0),
  ];
  for (const step of steps) {
    const r = step(t);
    if (r.error) continue;
    t = r.text;
    assert.ok(parseProgression(t).ok, t);
  }
});
