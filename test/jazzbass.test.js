// The jazz bass patterns that are not Latin: pedal point, modal vamp, sparse half-time and the jazz-funk groove.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getStyle, renderBar } from '../src/styles/index.js';
import { JAZZ_BASS_STEPS, LATIN_BASS_STEPS } from '../src/styles/figures.js';
import { PATTERNS, bandSwing, optionsForMeter, GROUPS } from '../src/styles/settings.js';
import { parseProgression } from '../src/theory/progression.js';
import { getMeter } from '../src/theory/meter.js';
import { createRng } from '../src/engine/rng.js';
import { mod12 } from '../src/theory/notes.js';

function render({ pattern, text, swing, ts = '4/4', chorus = 1, seed = 1 }) {
  const style = getStyle('jazz');
  const meter = getMeter(ts);
  const { bars, ok } = parseProgression(text, { timeSignature: ts });
  assert.ok(ok);
  const state = {};
  return bars.map((bar, i) => renderBar(style, {
    segments: bar.chords, nextChord: (bars[i + 1] ?? bars[0]).chords.find((s) => s.chord)?.chord ?? null,
    barIndex: i, barCount: bars.length, isFirstBar: i === 0, isLastBar: i === bars.length - 1,
    chorus, bpm: 100, meter, beatsPerBar: meter.quarters, state, bass: { pattern }, swing, seed, rng: createRng(seed * 1000 + i),
  }));
}
const bassOf = (bar) => bar.filter((e) => e.inst === 'bass').sort((a, b) => a.beat - b.beat);
const first = (pattern, text = 'Cm7 | Cm7 | Cm7 | Cm7', extra = {}) => bassOf(render({ pattern, text, ...extra })[0]);

test('pedal point: one long root a bar, and never longer than its chord', () => {
  const [note, ...rest] = first('pedal');
  assert.deepEqual(rest, []);
  assert.equal(note.beat, 0);
  assert.equal(mod12(note.midi), 0);
  assert.ok(note.dur > 3.5, 'it rings the whole bar');
  // two chords in a bar: each gets its own root, cut where the chord ends
  const two = bassOf(render({ pattern: 'pedal', text: 'Dm7 G7 | Cmaj7' })[0]);
  assert.deepEqual(two.map((e) => [e.beat, mod12(e.midi)]), [[0, 2], [2, 7]]);
  assert.ok(two[0].dur <= 2, 'the first root is cut where its chord ends, not held into the second chord');
  assert.ok(two[1].dur <= 2);
});

test('modal vamp: root, an octave skip on the "and" of two, root, fifth', () => {
  const notes = first('vamp');
  assert.deepEqual(notes.map((e) => e.beat > 1.4 && e.beat < 1.8 ? 1.5 : Math.round(e.beat)), [0, 1.5, 2, 3], 'the skip sits on the swung "and"');
  const root = notes[0].midi;
  assert.deepEqual(notes.map((e) => e.midi - root), [0, 12, 0, 7]);
  assert.ok(notes.every((e) => e.midi <= 52), 'the octave stays in the bass range');
});

test('sparse: a long root and the fifth on the "and" of three', () => {
  const notes = first('space');
  assert.equal(notes.length, 2);
  assert.equal(notes[0].beat, 0);
  assert.ok(notes[0].dur > 1.5);
  assert.ok(notes[1].beat > 2.4 && notes[1].beat < 2.8);
  assert.equal(mod12(notes[1].midi - notes[0].midi), 7);
});

test('jazz-funk: a syncopated riff in straight sixteenths, with the seventh of the chord', () => {
  const dominant = first('funk', 'C7 | C7');
  assert.deepEqual(dominant.map((e) => e.beat), [0, 0.75, 1.5, 2, 2.75, 3.25, 3.5]);
  assert.equal(mod12(dominant[4].midi - dominant[0].midi), 10, 'a flat seven over a dominant chord');
  assert.equal(mod12(first('funk', 'Cmaj7 | Cmaj7')[4].midi - first('funk', 'Cmaj7 | Cmaj7')[0].midi), 11, 'a major seven over a major seventh chord');
  assert.ok(dominant.every((e) => e.fixed), 'straight sixteenths');
  assert.ok(dominant[1].vel < dominant[0].vel, 'the ghosted notes are quieter than the accents');
});

test('the swung figures follow the swing slider; the funk groove and the pedal do not move with it', () => {
  const sig = (pattern, swing) => JSON.stringify(render({ pattern, swing, text: 'Dm7 | G7 | Cmaj7 | A7' }).map((b) => bassOf(b).map((e) => +e.beat.toFixed(4))));
  for (const pattern of ['vamp', 'space']) assert.notEqual(sig(pattern, 0.5), sig(pattern, 0.75), `${pattern} does not swing`);
  for (const pattern of ['pedal', 'funk']) assert.equal(sig(pattern, 0.5), sig(pattern, 0.75), `${pattern} moved with the swing`);
});

test('only the funk groove asks for a straight swing; the other jazz figures leave it alone', () => {
  const swing = (pattern) => bandSwing('jazz', { groove: 'classic' }, { pattern });
  assert.equal(swing('funk'), 50);
  for (const pattern of ['walk', 'pedal', 'vamp', 'space']) assert.equal(swing(pattern), null, pattern);
  assert.equal(swing('bossa'), 50);
});

test('every jazz figure plays well-formed, in range, over changing chords, and they all sound different', () => {
  const patterns = ['walk', ...Object.keys(JAZZ_BASS_STEPS), ...Object.keys(LATIN_BASS_STEPS)];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const chorus of [1, 2]) {
      for (const bar of render({ pattern, chorus, text: 'Dm7 | G7 | Cmaj7 A7 | Dm7 G7 | Ebmaj7 | Bb7#9 | Abmaj7 Gb7 | C7alt' })) {
        const notes = bassOf(bar);
        assert.ok(notes.length >= 1, `${pattern}: an empty bar`);
        for (const e of notes) assert.ok(e.midi >= 24 && e.midi <= 60 && e.beat >= 0 && e.beat < 4 && e.dur > 0 && e.vel > 0 && e.vel <= 1, `${pattern}: ${JSON.stringify(e)}`);
      }
    }
    seen.add(JSON.stringify(render({ pattern, text: 'Dm7 | G7 | Cmaj7 | Cmaj7' }).map((b) => bassOf(b).map((e) => [e.midi, +e.beat.toFixed(2)]))));
  }
  assert.equal(seen.size, patterns.length, 'two patterns play the same notes');
});

test('the jazz Pattern list: walking first, the jazz figures, then the Latin ones, with Mixed last', () => {
  const pattern = GROUPS.bass.fields.find((f) => f.id === 'pattern');
  assert.deepEqual(optionsForMeter(pattern, 'jazz', '4/4').map((o) => o.id), ['walk', 'pedal', 'vamp', 'space', 'funk', 'bossa', 'tumbao', 'bolero', 'mixed']);
  assert.ok(PATTERNS.filter((o) => o.styles?.includes('jazz')).every((o) => o.name && o.hint));
});

test('in 6/8, 7/8 and 10/8 the jazz figures walk like everything else in jazz', () => {
  for (const ts of ['6/8', '7/8', '10/8']) {
    const text = 'Dm7 | G7 | Cmaj7 | A7';
    const walk = JSON.stringify(render({ pattern: 'walk', ts, text }));
    for (const pattern of ['pedal', 'vamp', 'space', 'funk']) assert.equal(JSON.stringify(render({ pattern, ts, text })), walk, `${pattern} in ${ts}`);
  }
});
