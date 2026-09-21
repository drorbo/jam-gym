import test from 'node:test';
import assert from 'node:assert/strict';
import { METERS, METER_IDS, getMeter, groupStartsWithin, slotsWithin } from '../src/theory/meter.js';
import { parseProgression } from '../src/theory/progression.js';
import { Conductor } from '../src/engine/conductor.js';
import { getStyle, renderBar } from '../src/styles/index.js';
import { createRng } from '../src/engine/rng.js';
import { mod12 } from '../src/theory/notes.js';
import { sanitize } from '../src/app/state.js';

const beats = (events) => events.filter((e) => e.type === 'beat');
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('meters: slots, groups and bar lengths', () => {
  assert.deepEqual(METER_IDS, ['4/4', '6/8', '7/8', '10/8']);
  const shape = (id) => { const m = getMeter(id); return { groups: m.groups, slots: m.slots.length, quarters: m.quarters, len: m.slotLen }; };
  assert.deepEqual(shape('4/4'), { groups: [1, 1, 1, 1], slots: 4, quarters: 4, len: 1 });
  assert.deepEqual(shape('6/8'), { groups: [3, 3], slots: 6, quarters: 3, len: 0.5 });
  assert.deepEqual(shape('7/8'), { groups: [3, 2, 2], slots: 7, quarters: 3.5, len: 0.5 });
  assert.deepEqual(shape('10/8'), { groups: [3, 3, 2, 2], slots: 10, quarters: 5, len: 0.5 });
  assert.deepEqual(getMeter('7/8').groupSpans.map((g) => [g.start, g.len]), [[0, 1.5], [1.5, 1], [2.5, 1]]);
  assert.deepEqual(getMeter('10/8').slots.filter((s) => s.posInGroup === 0).map((s) => s.index), [0, 3, 6, 8]);
  assert.deepEqual(getMeter('10/8').slots.map((s) => s.group), [0, 0, 0, 1, 1, 1, 2, 2, 3, 3]);
  assert.throws(() => getMeter('5/4'), /Unsupported/);
  for (const id of METER_IDS) {
    const m = METERS[id];
    // slots tile the bar exactly
    m.slots.forEach((s, i) => assert.ok(close(s.start, i === 0 ? 0 : m.slots[i - 1].start + m.slots[i - 1].len)));
    assert.ok(close(m.slots.at(-1).start + m.slots.at(-1).len, m.quarters));
  }
  assert.equal(slotsWithin(getMeter('7/8'), 1.5, 2).length, 4);
  assert.deepEqual(groupStartsWithin(getMeter('7/8'), 0, 3.5).map((s) => s.start), [0, 1.5, 2.5]);
});

test('tempo hints are worded per meter', () => {
  assert.equal(getMeter('4/4').describeTempo(120), '');
  assert.match(getMeter('6/8').describeTempo(90), /Dotted-quarter beat: 60/);
  assert.match(getMeter('7/8').describeTempo(120), /Eighth notes: 240/);
  assert.equal(getMeter('6/8').tapQuarters, 1.5);
});

test('chords share a bar by beat group', () => {
  const seg = (prog, ts) => parseProgression(prog, { timeSignature: ts }).bars[0].chords.map((s) => [s.startBeat, s.beats]);
  assert.deepEqual(seg('Dm7 G7', '4/4'), [[0, 2], [2, 2]]);
  assert.deepEqual(seg('C Dm G', '4/4'), [[0, 2], [2, 1], [3, 1]]);
  assert.deepEqual(seg('C', '7/8'), [[0, 3.5]]);
  assert.deepEqual(seg('Dm7 G7', '6/8'), [[0, 1.5], [1.5, 1.5]]);
  assert.deepEqual(seg('Dm7 G7', '7/8'), [[0, 2.5], [2.5, 1]]);        // 3+2 | 2 eighths
  assert.deepEqual(seg('Dm7 G7 C', '7/8'), [[0, 1.5], [1.5, 1], [2.5, 1]]);
  assert.deepEqual(seg('Dm7 G7', '10/8'), [[0, 3], [3, 2]]);           // 3+3 | 2+2 eighths
  assert.deepEqual(seg('Dm7 G7 C', '10/8'), [[0, 3], [3, 1], [4, 1]]);
  assert.deepEqual(seg('A B C D', '10/8').map((s) => s[0]), [0, 1.5, 3, 4]);
  const tooMany = parseProgression('C Dm G', { timeSignature: '6/8' });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.errors[0].message, /6\/8 fits at most 2/);
  assert.match(parseProgression('C Dm G A B', { timeSignature: '10/8' }).errors[0].message, /at most 4/);
  assert.equal(parseProgression('C Dm G A', { timeSignature: '10/8' }).ok, true);
});

const CONFIG = { style: 'rock', loop: true, countIn: false, modulation: { type: 'off' }, tempoRamp: { enabled: false } };

function harness({ ts, progression = 'Dm7 | G7 | Cmaj7 | Cmaj7', tempo = 120, config = {}, seed = 7 } = {}) {
  const song = { key: 'C', tempo, timeSignature: ts, progression };
  const cfg = { ...CONFIG, ...config };
  const clock = { t: 500, now() { return this.t; } };
  const played = [];
  const events = [];
  const c = new Conductor({ clock, seed, sink: { play: (n) => played.push(n) }, getSong: () => song, getConfig: () => cfg, onEvent: (e) => events.push(e) });
  const run = (seconds, step = 0.025) => { const end = clock.t + seconds; while (clock.t < end) { clock.t += step; c.tick(); } };
  return { c, clock, played, events, run, song, cfg };
}

for (const ts of ['6/8', '7/8', '10/8']) {
  const meter = getMeter(ts);

  test(`${ts}: one beat event per eighth, exact spacing, and bars last ${meter.quarters} quarter notes`, () => {
    const h = harness({ ts, tempo: 132 });
    h.c.start();
    const t0 = h.clock.t + 0.06;
    h.run(12);
    const b = beats(h.events);
    const eighth = 60 / 132 / 2;
    assert.ok(b.length > meter.slots.length * 4);
    b.forEach((e, i) => {
      assert.ok(close(e.time, t0 + i * eighth, 1e-7), `slot ${i}`);
      assert.equal(e.beat, (i % meter.slots.length) + 1);
      assert.equal(e.beats, meter.slots.length);
      assert.equal(e.meter, ts);
    });
    assert.equal(b[meter.slots.length].bar, 2);
    assert.ok(close(b[meter.slots.length].time - b[0].time, meter.quarters * 60 / 132, 1e-7));
  });

  test(`${ts}: no drift over 500 bars with irregular timer ticks`, () => {
    const h = harness({ ts, tempo: 137 });
    h.c.start();
    const t0 = h.clock.t + 0.06;
    let n = 0;
    const end = h.clock.t + 500 * meter.quarters * 60 / 137 + 1;
    while (h.clock.t < end) { h.clock.t += 0.02 + ((n++ * 7919) % 100) / 100 * 0.03; h.c.tick(); }
    const b = beats(h.events);
    assert.ok(b.length >= 500 * meter.slots.length);
    const eighth = 60 / 137 / 2;
    let worst = 0;
    b.forEach((e, i) => { worst = Math.max(worst, Math.abs(e.time - (t0 + i * eighth))); });
    assert.ok(worst < 1e-7, `worst drift ${worst}`);
  });

  test(`${ts}: tempo changes land on the next eighth with no gap or overlap`, () => {
    const h = harness({ ts });
    h.c.start();
    h.run(2);
    h.c.setBpm(200);
    h.run(3);
    const b = beats(h.events);
    const idx = b.findIndex((e) => e.bpm === 200);
    assert.ok(idx > 0);
    assert.ok(close(b[idx].time - b[idx - 1].time, 60 / 120 / 2));
    for (let i = idx + 1; i < b.length; i++) assert.ok(close(b[i].time - b[i - 1].time, 60 / 200 / 2));
  });

  test(`${ts}: the count-in clicks every eighth, accenting the bar and each group downbeat`, () => {
    const h = harness({ ts, config: { countIn: true } });
    h.c.start();
    h.run(6);
    const clicks = h.played.filter((n) => n.inst === 'click');
    assert.equal(clicks.length, meter.slots.length);
    clicks.forEach((c, i) => {
      const slot = meter.slots[i];
      const expected = i === 0 ? 1 : slot.posInGroup === 0 ? 0.75 : 0.5;
      assert.equal(c.vel, expected, `click ${i}`);
    });
    assert.deepEqual(h.events.filter((e) => e.type === 'countin').map((e) => e.beat), meter.slots.map((s) => s.index + 1));
    assert.ok(close(beats(h.events)[0].time, h.events.filter((e) => e.type === 'countin').at(-1).time + 0.25));
  });

  test(`${ts}: the rock kit-and-snare land on the group downbeats`, () => {
    const h = harness({ ts, progression: 'C | C | C | C' });
    h.c.start();
    h.run(8);
    const bar2 = beats(h.events).find((e) => e.bar === 2 && e.beat === 1).time;
    const spq = 0.5;
    const near = (voice, quarter) => h.played.some((n) => n.voice === voice && Math.abs(n.when - (bar2 + quarter * spq)) < 0.02 && n.vel > 0.5);
    meter.groupSpans.forEach((g, i) => {
      assert.ok(near(i % 2 === 0 ? 'kick' : 'snare', g.start), `${ts} group ${i} should have a ${i % 2 === 0 ? 'kick' : 'snare'}`);
    });
  });
}

test('7/8: a two-chord bar changes chord on the sixth eighth (3+2 | 2)', () => {
  const h = harness({ ts: '7/8', progression: 'Dm7 G7 | Cmaj7' });
  h.c.start();
  h.run(4);
  const bar1 = beats(h.events).filter((e) => e.chorus === 1 && e.bar === 1);
  assert.deepEqual(bar1.map((e) => e.chord.symbol), ['Dm7', 'Dm7', 'Dm7', 'Dm7', 'Dm7', 'G7', 'G7']);
  assert.deepEqual(bar1.map((e) => e.segIndex), [0, 0, 0, 0, 0, 1, 1]);
  // the bass note for G7 sounds exactly on that eighth
  const t = bar1[5].time;
  const bass = h.played.filter((n) => n.inst === 'bass' && Math.abs(n.when - t) < 0.02);
  assert.ok(bass.some((n) => mod12(n.midi) === 7), 'G bass on the new chord');
});

test('10/8: a two-chord bar changes chord after 6 eighths (3+3 | 2+2)', () => {
  const h = harness({ ts: '10/8', progression: 'Am7 D7' });
  h.c.start();
  h.run(4);
  assert.deepEqual(beats(h.events).filter((e) => e.chorus === 1 && e.bar === 1).map((e) => e.chord.symbol), ['Am7', 'Am7', 'Am7', 'Am7', 'Am7', 'Am7', 'D7', 'D7', 'D7', 'D7']);
});

test('a live time-signature change applies at the next chorus, not mid-chorus', () => {
  const h = harness({ ts: '4/4', progression: 'C | F' });
  h.c.start();
  h.run(1);
  h.song.timeSignature = '7/8';
  h.run(8);
  const ev = beats(h.events);
  const first7 = ev.findIndex((e) => e.meter === '7/8');
  assert.ok(first7 > 0);
  assert.equal(ev[first7].beat, 1);
  assert.equal(ev[first7].bar, 1);
  assert.ok(ev.slice(0, first7).every((e) => e.meter === '4/4'));
  assert.equal(ev.slice(0, first7).length % 8, 0, 'the 4/4 chorus (2 bars) finished first');
  const chorus2 = h.events.filter((e) => e.type === 'chorus')[1];
  assert.equal(chorus2.meter, '7/8');
});

test('modulation and tempo ramp still work in odd meters', () => {
  const h = harness({
    ts: '7/8', tempo: 100,
    config: { modulation: { type: 'interval', interval: 5, everyLoops: 1 }, tempoRamp: { enabled: true, increment: 10, everyLoops: 1, maxBpm: 220 } },
    progression: 'Cmaj7 | Am7',
  });
  h.c.start();
  h.run(12);
  const cs = h.events.filter((e) => e.type === 'chorus').slice(0, 4);
  assert.deepEqual(cs.map((c) => c.key), ['C', 'F', 'Bb', 'Eb']);
  assert.deepEqual(cs.map((c) => c.bpm), [100, 110, 120, 130]);
});

// ---- the styles, in every meter ------------------------------------------------------------

const WILD = 'C13sus4 | F#m7b5/C | Dm7 G7 | E7#9b13 | NC | Db6/9 | Am7 D7 Gmaj7 | C7alt';

function renderChorus(styleId, ts, text, { seed = 1, chorus = 1, bpm = 120 } = {}) {
  const style = getStyle(styleId);
  const meter = getMeter(ts);
  const { bars, ok, errors } = parseProgression(text, { timeSignature: ts });
  assert.ok(ok, JSON.stringify(errors));
  const state = {};
  return { meter, bars, out: bars.map((bar, i) => renderBar(style, {
    segments: bar.chords, nextChord: (bars[i + 1] ?? bars[0]).chords.find((s) => s.chord)?.chord ?? null,
    barIndex: i, barCount: bars.length, isFirstBar: i === 0, isLastBar: i === bars.length - 1,
    chorus, bpm, meter, beatsPerBar: meter.quarters, state, rng: createRng(seed * 1000 + i),
  })) };
}

for (const styleId of ['jazz', 'blues', 'rock']) {
  for (const ts of ['6/8', '7/8', '10/8']) {
    const text = ts === '6/8' ? 'C13sus4 | F#m7b5/C | Dm7 G7 | E7#9b13 | NC | Db6/9 | C7alt' : WILD;

    test(`${styleId} in ${ts}: events are well-formed, inside the bar and in range (unusual chords, 2 choruses)`, () => {
      for (const chorus of [1, 2]) {
        const { meter, out } = renderChorus(styleId, ts, text, { chorus });
        out.forEach((events, i) => {
          assert.ok(events.length > 0, `bar ${i} empty`);
          for (const e of events) {
            assert.ok(Number.isFinite(e.beat) && e.beat >= -0.001 && e.beat < meter.quarters - 1e-9, `beat ${e.beat} (${e.inst})`);
            assert.ok(e.dur > 0 && e.vel > 0 && e.vel <= 1, `${e.inst} dur ${e.dur} vel ${e.vel}`);
            if (e.inst === 'bass') assert.ok(e.midi >= 24 && e.midi <= 60, `bass ${e.midi}`);
            if (e.inst === 'chords') assert.ok(e.midi >= 36 && e.midi <= 96, `chord note ${e.midi}`);
            assert.ok(e.timbre);
          }
          // groove is made of the group downbeats: something sounds on every one
          for (const g of meter.groupSpans) assert.ok(events.some((e) => e.inst === 'drums' && Math.abs(e.beat - g.start) < 1e-6), `bar ${i}: drums on group at ${g.start}`);
        });
      }
    });

    test(`${styleId} in ${ts}: same seed is identical, different seed varies`, () => {
      const a = JSON.stringify(renderChorus(styleId, ts, 'Dm7 | G7 | Cmaj7 | A7', { seed: 5 }).out);
      assert.equal(a, JSON.stringify(renderChorus(styleId, ts, 'Dm7 | G7 | Cmaj7 | A7', { seed: 5 }).out));
      assert.notEqual(a, JSON.stringify(renderChorus(styleId, ts, 'Dm7 | G7 | Cmaj7 | A7', { seed: 6 }).out));
    });

    test(`${styleId} in ${ts}: bass starts each chord on its root (or slash bass); comping stays in the chord`, () => {
      const prog = 'Dm7 | G7 | Cmaj7 | Am7 | Bbmaj7 | Eb7 | F#m7b5 | C/E';
      const { bars, out } = renderChorus(styleId, ts, prog);
      out.forEach((events, i) => {
        const chord = bars[i].chords[0].chord;
        const first = events.filter((e) => e.inst === 'bass').sort((a, b) => a.beat - b.beat)[0];
        assert.equal(first.beat, 0);
        assert.equal(mod12(first.midi), chord.bass ?? chord.root, `bar ${i + 1} ${chord.symbol}`);
        const allowed = new Set([...chord.pcs.map((p) => mod12(chord.root + p)), ...[2, 5, 7, 9].map((d) => mod12(chord.root + d))]);
        for (const e of events.filter((x) => x.inst === 'chords')) assert.ok(allowed.has(mod12(e.midi)), `${chord.symbol}: ${e.midi}`);
      });
    });

    test(`${styleId} in ${ts}: a two-chord bar gives each chord its own bass note, and comping stops at the change`, () => {
      const { bars, out } = renderChorus(styleId, ts, 'Dm7 G7');
      const second = bars[0].chords[1];
      const bass = out[0].filter((e) => e.inst === 'bass');
      assert.ok(bass.some((e) => Math.abs(e.beat - second.startBeat) < 1e-6 && mod12(e.midi) === 7), `G bass at ${second.startBeat}`);
      for (const e of out[0].filter((x) => x.inst === 'chords' && x.beat < second.startBeat - 1e-6)) {
        assert.ok(e.beat + e.dur <= second.startBeat + 0.4, `note rings into the next chord (${e.beat}+${e.dur})`);
      }
    });

    test(`${styleId} in ${ts}: no chord means drums only`, () => {
      const { out } = renderChorus(styleId, ts, 'NC | C');
      assert.ok(out[0].some((e) => e.inst === 'drums'));
      assert.ok(!out[0].some((e) => e.inst === 'bass' || e.inst === 'chords'));
    });
  }
}

test('the /8 meters are not swung (their groupings are the feel), 4/4 jazz still is', () => {
  const ride = (ts) => renderChorus('jazz', ts, 'Cmaj7', { bpm: 100, seed: 3 }).out[0].filter((e) => e.voice === 'ride').map((e) => e.beat);
  for (const b of ride('7/8')) assert.ok(Math.abs(b * 2 - Math.round(b * 2)) < 1e-9, `7/8 ride at ${b} is off the eighth grid`);
  assert.ok(ride('4/4').some((b) => Math.abs((b % 1) - 2 / 3) < 0.01), 'swung 4/4 ride');
});

test('saved settings: the time signature is validated', () => {
  assert.equal(sanitize({ song: { timeSignature: '7/8' } }).song.timeSignature, '7/8');
  assert.equal(sanitize({ song: { timeSignature: '13/16' } }).song.timeSignature, '4/4');
  assert.equal(sanitize({}).song.timeSignature, '4/4');
});
