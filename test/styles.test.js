import test from 'node:test';
import assert from 'node:assert/strict';
import { getStyle, listStyles, registerStyle, renderBar } from '../src/styles/index.js';
import { parseProgression } from '../src/theory/progression.js';
import { createRng } from '../src/engine/rng.js';
import { applyFeel, swingMap } from '../src/engine/feel.js';
import { guitarChord, placeVoicing, voicingPcs } from '../src/engine/voicing.js';
import { parseChord } from '../src/theory/chord.js';
import { mod12 } from '../src/theory/notes.js';

const DRUM_VOICES = new Set(['kick', 'snare', 'hat', 'hatOpen', 'hatPedal', 'ride', 'crash', 'tomHigh', 'tomMid', 'tomLow']);

/** Render every bar of a progression as the conductor would, with shared style state. */
function renderChorus(styleId, text, { chorus = 1, bpm = 120, seed = 1, bass } = {}) {
  const style = getStyle(styleId);
  const { bars } = parseProgression(text);
  const state = {};
  return bars.map((bar, i) => {
    const nextBar = bars[i + 1] ?? bars[0];
    return renderBar(style, {
      segments: bar.chords, nextChord: nextBar.chords.find((s) => s.chord)?.chord ?? null,
      barIndex: i, barCount: bars.length, isFirstBar: i === 0, isLastBar: i === bars.length - 1,
      chorus, bpm, beatsPerBar: 4, state, bass, rng: createRng(seed * 1000 + i),
    });
  });
}

const WILD = 'C13sus4 | F#m7b5/C | Bbmaj7#11 | E7#9b13 | Adim7/Eb | Db6/9 | G+7 | Ab5 | NC | Dm7 G7 | C6 C6/9 D7 G7 | C7alt';

test('registry lists the three built-in styles with default tempos', () => {
  assert.deepEqual(listStyles().map((s) => s.id), ['jazz', 'blues', 'rock']);
  assert.deepEqual(listStyles().map((s) => s.defaultTempo), [132, 100, 120]);
  assert.equal(getStyle('nope').id, 'jazz');
});

test('styles are pluggable: a new style needs only data + generators', () => {
  const custom = registerStyle({
    id: 'test-bossa', name: 'Bossa', defaultTempo: 120,
    feel: { name: 'straight', swing: 0.5 }, humanize: {}, timbres: { drums: 'x', bass: 'x', chords: 'x' },
    parts: { drums: () => [{ inst: 'drums', voice: 'kick', beat: 0, dur: 0.2, vel: 0.8 }] },
  });
  const ev = renderBar(custom, { bpm: 100, rng: createRng(1) });
  assert.equal(ev.length, 1);
  assert.throws(() => registerStyle({ id: 'bad' }), /missing/);
});

for (const id of ['jazz', 'blues', 'rock']) {
  test(`${id}: every event is well-formed, in range and inside the bar, for unusual chords`, () => {
    for (const chorus of [1, 2]) {
      const bars = renderChorus(id, WILD, { chorus });
      bars.forEach((events, i) => {
        assert.ok(events.length > 0, `bar ${i} produced nothing`);
        for (const e of events) {
          assert.ok(['drums', 'bass', 'chords'].includes(e.inst));
          assert.ok(Number.isFinite(e.beat) && e.beat >= -0.001 && e.beat < 4.001, `beat ${e.beat}`);
          assert.ok(e.dur > 0 && Number.isFinite(e.dur));
          assert.ok(e.vel > 0 && e.vel <= 1, `vel ${e.vel} (${e.inst})`);
          assert.ok(e.timbre);
          if (e.inst === 'drums') assert.ok(DRUM_VOICES.has(e.voice), e.voice);
          if (e.inst === 'bass') assert.ok(e.midi >= 24 && e.midi <= 60, `bass ${e.midi}`);
          if (e.inst === 'chords') assert.ok(e.midi >= 36 && e.midi <= 96, `chord note ${e.midi}`);
        }
      });
    }
  });

  test(`${id}: same seed -> identical output; different seed -> variation`, () => {
    const a = JSON.stringify(renderChorus(id, 'Dm7 | G7 | Cmaj7 | Cmaj7', { seed: 5 }));
    const b = JSON.stringify(renderChorus(id, 'Dm7 | G7 | Cmaj7 | Cmaj7', { seed: 5 }));
    const c = JSON.stringify(renderChorus(id, 'Dm7 | G7 | Cmaj7 | Cmaj7', { seed: 6 }));
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  test(`${id}: bass plays the chord root on beat one; comping never leaves the chord`, () => {
    const prog = 'Dm7 | G7 | Cmaj7 | Am7 | Bbmaj7 | Eb7 | F#m7b5 | B7';
    const { bars } = parseProgression(prog);
    renderChorus(id, prog).forEach((events, i) => {
      const chord = bars[i].chords[0].chord;
      const first = events.filter((e) => e.inst === 'bass').sort((a, b) => a.beat - b.beat)[0];
      assert.equal(mod12(first.midi), chord.root, `bar ${i + 1} ${chord.symbol}`);
      const chordPcs = new Set(voicingPcs(chord, 'all'));
      // comping tones may add the usual colour tones: 9th, 11th, 5th, 13th
      const allowed = new Set([...chordPcs, ...[2, 5, 7, 9].map((d) => mod12(chord.root + d))]);
      for (const e of events.filter((x) => x.inst === 'chords')) assert.ok(allowed.has(mod12(e.midi)), `${chord.symbol}: ${e.midi}`);
    });
  });

  test(`${id}: slash chords put the slash note in the bass`, () => {
    const events = renderChorus(id, 'C/E | G/B')[0];
    const first = events.filter((e) => e.inst === 'bass').sort((a, b) => a.beat - b.beat)[0];
    assert.equal(mod12(first.midi), 4);
  });

  test(`${id}: no chord means no bass and no comping, but the drums keep going`, () => {
    const [ev] = renderChorus(id, 'NC | C');
    assert.ok(ev.some((e) => e.inst === 'drums'));
    assert.ok(!ev.some((e) => e.inst === 'bass' || e.inst === 'chords'));
  });

  test(`${id}: notes stop where the chord changes (two chords in a bar)`, () => {
    const [ev] = renderChorus(id, 'Dm7 G7');
    for (const e of ev.filter((x) => x.inst === 'chords' && x.beat < 1.9)) {
      assert.ok(e.beat + e.dur <= 2.35, `note ${e.midi} rings into the next chord (${e.beat}+${e.dur})`);
    }
    const bassBeats = ev.filter((x) => x.inst === 'bass').map((x) => Math.round(x.beat * 100) / 100);
    assert.ok(bassBeats.some((b) => b >= 1.9 && b < 2.1), 'second chord gets its own bass note on beat 3');
  });
}

test('jazz bass walks: steady quarters give one note per beat, and the last note approaches the next root', () => {
  const prog = 'Dm7 | G7 | Cmaj7 | Cmaj7';
  const { bars } = parseProgression(prog);
  for (let seed = 1; seed <= 30; seed++) {
    const out = renderChorus('jazz', prog, { seed, bass: { rhythm: 'quarters' } });
    out.forEach((events, i) => {
      const bass = events.filter((e) => e.inst === 'bass');
      assert.equal(bass.length, 4);
      const nextRoot = (bars[i + 1] ?? bars[0]).chords[0].chord.root;
      const approach = mod12(bass[3].midi);
      const ok = [1, 11, 2, 10, 7].map((d) => mod12(nextRoot + d)).includes(approach);
      assert.ok(ok, `seed ${seed} bar ${i}: approach ${approach} to root ${nextRoot}`);
      for (let k = 1; k < 4; k++) assert.ok(Math.abs(bass[k].midi - bass[k - 1].midi) <= 12, 'no huge leaps');
    });
  }
});

test('jazz swing ratio narrows as the tempo rises', () => {
  const ride = (bpm) => renderChorus('jazz', 'Cmaj7', { bpm, seed: 3 })[0].filter((e) => e.voice === 'ride' && e.beat % 1 > 0.3);
  const slow = ride(100).map((e) => e.beat % 1);
  const fast = ride(220).map((e) => e.beat % 1);
  assert.ok(slow.length && fast.length);
  assert.ok(Math.min(...slow) > 0.62, `slow swing ${slow}`);
  assert.ok(Math.max(...fast) < 0.6, `fast swing ${fast}`);
});

test('rock stays straight, blues shuffles', () => {
  const rockHat = renderChorus('rock', 'C', { seed: 2 })[0].filter((e) => e.voice === 'hat' && e.beat % 1 !== 0);
  rockHat.forEach((e) => assert.ok(Math.abs((e.beat % 1) - 0.5) < 0.03, `${e.beat}`));
  const bluesHat = renderChorus('blues', 'C7', { seed: 2 })[0].filter((e) => e.voice === 'hat' && e.beat % 1 > 0.3);
  bluesHat.forEach((e) => assert.ok(Math.abs((e.beat % 1) - 2 / 3) < 0.03, `${e.beat}`));
});

test('blues bass is a boogie figure built on the chord (the classic is 1 3 5 6 b7 6 5 3)', () => {
  const figures = (sym, third) => ({
    classic: [0, third, 7, 9, 10, 9, 7, third],
    chicago: [0, 7, 9, 7, 0, 7, 9, 7],
    rise: [0, third, 7, third, 9, 7, 10, 7],
  });
  for (const [prog, third] of [['C7 | C7', 4], ['Cm7 | C7', 3]]) {
    const seen = new Set();
    for (let seed = 1; seed <= 30; seed++) {
      const [ev] = renderChorus('blues', prog, { seed, bass: { pattern: 'boogie' } });
      const notes = ev.filter((e) => e.inst === 'bass').sort((a, b) => a.beat - b.beat).map((e) => mod12(e.midi));
      const match = Object.entries(figures('', third)).find(([, f]) => f.slice(0, 7).every((x, i) => x === notes[i]));
      assert.ok(match, `seed ${seed}: ${notes} is not a known figure`);
      seen.add(match[0]);
    }
    assert.ok(seen.has('classic'), 'the classic boogie appears');
  }
});

test('every style fills at the end of the chorus at least some of the time', () => {
  for (const id of ['jazz', 'blues', 'rock']) {
    let fills = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const bars = renderChorus(id, 'C | C | C | C', { seed });
      const drums = (i) => bars[i].filter((e) => e.inst === 'drums').length;
      if (drums(3) > drums(1)) fills++;
    }
    assert.ok(fills > 5, `${id} fills: ${fills}`);
  }
});

test('swing mapping: straight is identity, triplet swing puts the "and" 2/3 in', () => {
  assert.equal(swingMap(1.5, 0.5), 1.5);
  assert.ok(Math.abs(swingMap(1.5, 2 / 3) - (1 + 2 / 3)) < 1e-9);
  assert.equal(swingMap(2, 2 / 3), 2);
  const [e] = applyFeel([{ beat: 0.5, dur: 0.5, inst: 'x', vel: 1 }], 2 / 3);
  assert.ok(Math.abs(e.beat - 2 / 3) < 1e-9 && Math.abs(e.dur - 1 / 3) < 1e-9);
  assert.equal(applyFeel([{ beat: 0.5, dur: 0.25, fixed: true }], 2 / 3)[0].beat, 0.5);
});

test('voice-leading: jazz voicings stay compact, in range, and move little', () => {
  const chords = ['Dm7', 'G7', 'Cmaj7', 'A7b9', 'Dm7', 'Db7', 'Cmaj7'].map(parseChord);
  let prev = null;
  let moves = 0;
  let count = 0;
  for (const c of chords) {
    const v = placeVoicing(voicingPcs(c, 'rootless'), prev, { lo: 52, hi: 72, center: 62 });
    assert.ok(v.length >= 3);
    assert.ok(v[0] >= 52 && v.at(-1) <= 72, `range ${v}`);
    assert.ok(v.at(-1) - v[0] <= 12, `span ${v}`);
    const pcs = v.map(mod12);
    assert.ok(pcs.includes(mod12(c.root + c.third)), `${c.symbol} has its third`);
    if (c.seventh !== null) assert.ok(pcs.includes(mod12(c.root + c.seventh)), `${c.symbol} has its seventh`);
    assert.ok(!pcs.includes(c.root) || c.family === 'major' || c.family === 'minor', `${c.symbol} is rootless`);
    if (prev) { const n = Math.min(prev.length, v.length); for (let i = 0; i < n; i++) { moves += Math.abs(v[i] - prev[i]); count++; } }
    prev = v;
  }
  assert.ok(moves / count <= 3, `average voice movement ${moves / count}`);
});

test('altered dominants use the altered tones', () => {
  const pcs = (s) => voicingPcs(parseChord(s), 'rootless').map((p) => mod12(p - parseChord(s).root));
  assert.ok(pcs('G7b9').includes(1));
  assert.ok(pcs('G7#9').includes(3));
  assert.ok(pcs('G7#5').includes(8));
  assert.ok(pcs('G7#11').includes(6));
  assert.ok(pcs('Cm7b5').includes(6) && pcs('Cm7b5').includes(3));
});

test('guitar chords: root low, power chord = root, fifth, octave; full adds the third', () => {
  const p = guitarChord(parseChord('A'));
  assert.deepEqual(p.map(mod12), [9, 4, 9]);
  assert.ok(p[0] >= 40 && p[0] <= 51);
  const full = guitarChord(parseChord('Am'), { full: true });
  assert.ok(full.map(mod12).includes(0)); // C, the minor third
  const dim = guitarChord(parseChord('Bdim'), { full: false });
  assert.equal(mod12(dim[1]), 5); // F, the diminished fifth
});
