import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SWING, MIN_SWING, clampSwing, describeSwing, swingMap } from '../src/engine/feel.js';
import { defaultSwing, getStyle, listStyles, renderBar } from '../src/styles/index.js';
import { parseProgression } from '../src/theory/progression.js';
import { getMeter } from '../src/theory/meter.js';
import { createRng } from '../src/engine/rng.js';
import { Conductor } from '../src/engine/conductor.js';
import { defaultState, sanitize } from '../src/app/state.js';

test('the swing range and clamping', () => {
  assert.equal(MIN_SWING, 50);
  assert.equal(MAX_SWING, 75);
  assert.equal(clampSwing(66.4), 66);
  assert.equal(clampSwing(3), 50);
  assert.equal(clampSwing(500), 75);
  assert.equal(clampSwing('lots'), 50);
  assert.equal(clampSwing(undefined, 65), 65);
  assert.equal(clampSwing(NaN, 60), 60);
});

test('swing percentages have plain-English names', () => {
  assert.equal(describeSwing(50), 'Straight eighths');
  assert.equal(describeSwing(55), 'Barely swung');
  assert.equal(describeSwing(60), 'Light swing');
  assert.equal(describeSwing(67), 'Triplet swing (2:1)');
  assert.equal(describeSwing(75), 'Hard swing');
  assert.equal(describeSwing(1000), 'Hard swing');
});

test('each style has a default swing: jazz eases with tempo, blues is a triplet shuffle, rock is straight', () => {
  assert.equal(defaultSwing(getStyle('rock'), 120), 50);
  assert.equal(defaultSwing(getStyle('rock'), 200), 50);
  assert.equal(defaultSwing(getStyle('blues'), 100), 67);
  assert.equal(defaultSwing(getStyle('blues'), 60), 67);
  assert.equal(defaultSwing(getStyle('jazz'), 120), 67);
  assert.equal(defaultSwing(getStyle('jazz'), 132), 65);
  assert.ok(defaultSwing(getStyle('jazz'), 220) <= 57, `jazz at 220 BPM is ${defaultSwing(getStyle('jazz'), 220)}`);
  assert.ok(defaultSwing(getStyle('jazz'), 60) === 67, 'and never more than triplet swing');
  for (const s of listStyles()) {
    const d = defaultSwing(s, s.defaultTempo);
    assert.ok(d >= 50 && d <= 75, `${s.id} default ${d}`);
  }
  // the three styles really do start in different places
  assert.equal(new Set(['jazz', 'blues', 'rock'].map((id) => defaultSwing(getStyle(id), getStyle(id).defaultTempo))).size, 3);
});

const barOf = (styleId, ts, swing, bpm = 120) => {
  const meter = getMeter(ts);
  const bar = parseProgression('Cmaj7', { timeSignature: ts }).bars[0];
  return renderBar(getStyle(styleId), {
    segments: bar.chords, nextChord: null, barIndex: 0, barCount: 1, isFirstBar: false, isLastBar: false,
    chorus: 1, bpm, meter, beatsPerBar: meter.quarters, state: {}, rng: createRng(4), swing,
  });
};
// fractional position of the "and" of a beat: hi-hat eighths (rock/blues) or ride skips (jazz)
const ands = (events, voice) => events.filter((e) => e.voice === voice && e.beat % 1 > 0.3).map((e) => +(e.beat % 1).toFixed(3));
const near = (values, target, eps = 0.03) => values.length > 0 && values.every((v) => Math.abs(v - target) < eps);

test('a chosen swing percentage overrides the style, on every style', () => {
  for (const [id, voice] of [['rock', 'hat'], ['blues', 'hat'], ['jazz', 'ride']]) {
    for (const pct of [50, 58, 67, 75]) {
      const a = ands(barOf(id, '4/4', pct / 100), voice);
      assert.ok(near(a, pct / 100), `${id} at ${pct}%: the "and" falls at ${a}`);
    }
  }
});

test('with no swing chosen, each style plays its own feel', () => {
  assert.ok(near(ands(barOf('rock', '4/4', undefined), 'hat'), 0.5), 'rock straight');
  assert.ok(near(ands(barOf('blues', '4/4', undefined), 'hat'), 0.667), 'blues triplet');
  assert.ok(near(ands(barOf('jazz', '4/4', undefined, 100), 'ride'), 0.667), 'jazz swing at a slow tempo');
  assert.ok(near(ands(barOf('jazz', '4/4', undefined, 220), 'ride'), 0.557, 0.04), 'jazz eases at a fast tempo');
});

test('a chosen swing is clamped into range, and the "and" lands where the percentage says', () => {
  assert.ok(near(ands(barOf('rock', '4/4', 0.99), 'hat'), 0.75));
  assert.ok(near(ands(barOf('rock', '4/4', 0.1), 'hat'), 0.5));
  assert.ok(Math.abs(swingMap(1.5, 0.6) - 1.6) < 1e-9);
});

test('swing does not apply in 6/8, 7/8 or 10/8', () => {
  for (const ts of ['6/8', '7/8', '10/8']) {
    const plain = JSON.stringify(barOf('blues', ts, undefined).map((e) => e.beat));
    const swung = JSON.stringify(barOf('blues', ts, 0.75).map((e) => e.beat));
    assert.equal(swung, plain, `${ts} ignores swing`);
    for (const e of barOf('rock', ts, 0.75)) assert.ok(Math.abs(e.beat * 2 - Math.round(e.beat * 2)) < 1e-9 || Math.abs(e.beat * 4 - Math.round(e.beat * 4)) < 1e-9, `${ts} beat ${e.beat} stays on the grid`);
  }
});

test('the conductor applies config.swing to what is actually scheduled (from the next bar)', () => {
  const song = { key: 'C', tempo: 120, timeSignature: '4/4', progression: 'C | C | C | C' };
  const cfg = { style: 'rock', swing: 50, loop: true, countIn: false, modulation: { type: 'off' }, tempoRamp: { enabled: false } };
  const clock = { t: 900, now() { return this.t; } };
  const played = [];
  const events = [];
  const c = new Conductor({ clock, seed: 3, sink: { play: (n) => played.push(n) }, getSong: () => song, getConfig: () => cfg, onEvent: (e) => events.push(e) });
  const run = (s) => { const end = clock.t + s; while (clock.t < end) { clock.t += 0.025; c.tick(); } };
  const barStart = (n) => events.find((e) => e.type === 'beat' && e.chorus === 1 && e.bar === n && e.beat === 1).time;
  const hatPhases = (bar) => {
    const t0 = barStart(bar);
    return played.filter((n) => n.voice === 'hat' && n.when >= t0 - 0.02 && n.when < t0 + 1.98)
      .map((n) => ((n.when - t0) / 0.5) % 1).filter((f) => f > 0.3 && f < 0.9).map((f) => +f.toFixed(2));
  };
  c.start();
  run(2.2); // bar 1 played straight
  cfg.swing = 67; // changed mid-song, as the slider does
  run(6);
  assert.ok(near(hatPhases(1), 0.5, 0.03), `bar 1 straight: ${hatPhases(1)}`);
  assert.ok(near(hatPhases(3), 0.667, 0.03), `bar 3 swung: ${hatPhases(3)}`);
});

test('defaults and saved settings: swing starts at the style default and is validated', () => {
  assert.equal(defaultState().config.swing, 65);
  const back = (c, s = {}) => sanitize({ song: s, config: c }).config.swing;
  assert.equal(back({ style: 'jazz', swing: 58 }), 58);
  assert.equal(back({ style: 'jazz', swing: 200 }), 75);
  assert.equal(back({ style: 'jazz', swing: 1 }), 50);
  // missing or invalid falls back to THAT style's default at THAT tempo
  assert.equal(back({ style: 'rock' }), 50);
  assert.equal(back({ style: 'blues', swing: 'x' }), 67);
  assert.equal(back({ style: 'jazz' }, { tempo: 200 }), defaultSwing(getStyle('jazz'), 200));
  assert.equal(sanitize(null).config.swing, 65);
});
