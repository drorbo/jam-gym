import test from 'node:test';
import assert from 'node:assert/strict';
import { Conductor } from '../src/engine/conductor.js';

const BASE_CONFIG = {
  style: 'jazz', loop: true, countIn: false,
  modulation: { type: 'off', interval: 2, everyLoops: 1, randomMode: 'no-repeat' },
  tempoRamp: { enabled: false, increment: 5, everyLoops: 2, maxBpm: 220 },
};
const BASE_SONG = { key: 'C', tempo: 120, timeSignature: '4/4', progression: 'Cmaj7 | Am7 | Dm7 | G7' };

function harness({ song = {}, config = {}, jitter = 0, seed = 7 } = {}) {
  const s = { ...BASE_SONG, ...song };
  const cfg = { ...BASE_CONFIG, ...config };
  const clock = { t: 1000, now() { return this.t; } };
  const played = [];
  const events = [];
  const c = new Conductor({
    clock, seed,
    sink: { play: (n) => played.push(n) },
    getSong: () => s, getConfig: () => cfg, onEvent: (e) => events.push(e),
  });
  let n = 0;
  const run = (seconds, step = 0.025) => {
    const end = clock.t + seconds;
    while (clock.t < end) {
      // deterministic pseudo-jitter in tick spacing: the scheduler must not care
      clock.t += step + (jitter ? ((n++ * 7919) % 100) / 100 * jitter : 0);
      c.tick();
    }
  };
  return { c, clock, played, events, run, song: s, config: cfg };
}
const beats = (events) => events.filter((e) => e.type === 'beat');
const choruses = (events) => events.filter((e) => e.type === 'chorus');

test('beats are exactly one beat apart and start with the first chord', () => {
  const h = harness();
  h.c.start();
  h.run(10);
  const b = beats(h.events);
  assert.equal(b[0].chord.symbol, 'Cmaj7');
  assert.equal(b[0].bar, 1);
  assert.equal(b[0].beat, 1);
  for (let i = 1; i < b.length; i++) assert.ok(Math.abs(b[i].time - b[i - 1].time - 0.5) < 1e-9);
  assert.deepEqual(b.slice(0, 8).map((x) => x.chord.symbol), ['Cmaj7', 'Cmaj7', 'Cmaj7', 'Cmaj7', 'Am7', 'Am7', 'Am7', 'Am7']);
});

test('looping: 4-bar chorus repeats indefinitely and counts choruses', () => {
  const h = harness();
  h.c.start();
  h.run(40); // 16 beats/chorus at 120 = 8 s
  const cs = choruses(h.events);
  assert.ok(cs.length >= 5);
  assert.deepEqual(cs.slice(0, 5).map((c) => c.chorus), [1, 2, 3, 4, 5]);
  const b = beats(h.events);
  assert.equal(b[16].chorus, 2);
  assert.equal(b[16].bar, 1);
  assert.equal(b[16].chord.symbol, 'Cmaj7');
  assert.ok(Math.abs(cs[1].time - cs[0].time - 8) < 1e-9);
});

test('no drift: 500 bars at 137 BPM stay on the exact grid despite irregular timer ticks', () => {
  const h = harness({ song: { tempo: 137 }, jitter: 0.03 });
  h.c.start();
  const t0 = h.clock.t + 0.06;
  h.run(500 * 4 * 60 / 137 + 1);
  const b = beats(h.events);
  assert.ok(b.length >= 2000);
  const spb = 60 / 137;
  let worst = 0;
  b.forEach((e, i) => { worst = Math.max(worst, Math.abs(e.time - (t0 + i * spb))); });
  assert.ok(worst < 1e-7, `worst drift ${worst}s`);
});

test('scheduling stays inside the lookahead window and never in the past', () => {
  const h = harness({ jitter: 0.02 });
  h.c.start();
  const origPlay = h.c.sink.play;
  let lateBy = 0;
  let farAhead = 0;
  h.c.sink.play = (n) => {
    lateBy = Math.max(lateBy, h.clock.t - n.when);
    farAhead = Math.max(farAhead, n.when - h.clock.t);
    origPlay(n);
  };
  h.run(20);
  assert.ok(lateBy < 0.03, `late by ${lateBy}`);
  assert.ok(farAhead < 0.25 + 1.02 + 0.03, `too far ahead: ${farAhead}`); // lookahead + <= 1 beat's notes
});

test('tempo change is synchronized: the next beat uses the new beat length, no gap or overlap', () => {
  const h = harness();
  h.c.start();
  h.run(3);
  h.c.setBpm(180);
  h.run(6);
  const b = beats(h.events);
  const idx = b.findIndex((e) => e.bpm === 180);
  assert.ok(idx > 0);
  // the beat that *carries* the new tempo starts where the previous one ended
  assert.ok(Math.abs(b[idx].time - b[idx - 1].time - 0.5) < 1e-9);
  // and every beat after it is 60/180 apart
  for (let i = idx + 1; i < b.length; i++) assert.ok(Math.abs(b[i].time - b[i - 1].time - 60 / 180) < 1e-9);
  // notes are timed with the new tempo as well: the kick on beat 1 of the next bar
  assert.ok(h.played.every((n) => Number.isFinite(n.when) && n.dur > 0));
});

test('tempo is clamped to the supported range', () => {
  const h = harness();
  h.c.start();
  h.c.setBpm(9999);
  h.run(1);
  assert.equal(beats(h.events).at(-1).bpm, 220);
  h.c.setBpm(1);
  h.run(1);
  assert.equal(beats(h.events).at(-1).bpm, 40);
});

test('modulation: +2 semitones every loop transposes the actual chords being played', () => {
  const h = harness({ config: { modulation: { type: 'interval', interval: 2, everyLoops: 1 } } });
  h.c.start();
  h.run(26);
  const cs = choruses(h.events);
  assert.deepEqual(cs.slice(0, 4).map((c) => c.key), ['C', 'D', 'E', 'F#']);
  assert.deepEqual(cs[1].bars.map((b) => b.source), ['Dmaj7', 'Bm7', 'Em7', 'A7']);
  const b = beats(h.events);
  assert.equal(b[16].chord.symbol, 'Dmaj7');
  assert.equal(b[16].key, 'D');
  assert.equal(b[32].chord.symbol, 'Emaj7');
  // bass really follows: the first bass note of chorus 2 is a D (pc 2)
  const chorus2Start = cs[1].time;
  const firstBass = h.played.filter((n) => n.inst === 'bass' && n.when >= chorus2Start - 0.05)[0];
  assert.equal(firstBass.midi % 12, 2);
});

test('modulation every N loops, in a flat key', () => {
  const h = harness({
    song: { key: 'Bb', progression: 'Bbmaj7 | Gm7 | Cm7 | F7' },
    config: { modulation: { type: 'interval', interval: 5, everyLoops: 2 } },
  });
  h.c.start();
  h.run(60);
  const cs = choruses(h.events);
  assert.deepEqual(cs.slice(0, 5).map((c) => c.key), ['Bb', 'Bb', 'Eb', 'Eb', 'Ab']);
  assert.deepEqual(cs[2].bars.map((b) => b.source), ['Ebmaj7', 'Cm7', 'Fm7', 'Bb7']);
});

test('tempo ramp + modulation together (combination mode), reflected in beats', () => {
  const h = harness({
    song: { tempo: 200 },
    config: {
      modulation: { type: 'interval', interval: 2, everyLoops: 2 },
      tempoRamp: { enabled: true, increment: 5, everyLoops: 2, maxBpm: 220 },
    },
  });
  h.c.start();
  h.run(50);
  const cs = choruses(h.events);
  assert.deepEqual(cs.slice(0, 6).map((c) => c.bpm), [200, 200, 205, 205, 210, 210]);
  assert.deepEqual(cs.slice(0, 6).map((c) => c.key), ['C', 'C', 'D', 'D', 'E', 'E']);
  // beats inside chorus 3 use 205 BPM spacing
  const b = beats(h.events).filter((e) => e.chorus === 3);
  for (let i = 1; i < b.length; i++) assert.ok(Math.abs(b[i].time - b[i - 1].time - 60 / 205) < 1e-9);
});

test('random key mode changes key each chorus and never repeats (no-repeat)', () => {
  const h = harness({ config: { modulation: { type: 'random', randomMode: 'no-repeat', everyLoops: 1 } }, song: { tempo: 220 } });
  h.c.start();
  h.run(80);
  const ks = choruses(h.events).map((c) => c.keyPc);
  assert.ok(ks.length > 10);
  for (let i = 1; i < ks.length; i++) assert.notEqual(ks[i], ks[i - 1]);
});

test('the "upcoming" preview on beat events matches what actually happens next', () => {
  const h = harness({ config: { modulation: { type: 'random', randomMode: 'shuffle', everyLoops: 1 }, tempoRamp: { enabled: true, increment: 3, everyLoops: 1, maxBpm: 220 } }, song: { tempo: 200 } });
  h.c.start();
  h.run(60);
  const b = beats(h.events);
  const cs = choruses(h.events);
  for (let i = 0; i < cs.length - 1; i++) {
    const last = b.filter((e) => e.chorus === cs[i].chorus).at(-1);
    assert.equal(last.upcoming.keyPc, cs[i + 1].keyPc);
    assert.equal(last.upcoming.bpm, cs[i + 1].bpm);
  }
});

test('live key request applies at the next chorus and modulation continues from there', () => {
  const h = harness({ config: { modulation: { type: 'interval', interval: 1, everyLoops: 1 } } });
  h.c.start();
  h.run(4);
  h.c.requestKey(9); // A
  h.run(30);
  const ks = choruses(h.events).slice(0, 4).map((c) => c.key);
  assert.deepEqual(ks, ['C', 'A', 'Bb', 'B']);
});

test('song edits apply at the next chorus, not mid-chorus', () => {
  const h = harness();
  h.c.start();
  h.run(3);
  h.song.progression = 'Fmaj7 | Bb7';
  h.run(30);
  const b = beats(h.events);
  assert.equal(b[7].chord.symbol, 'Am7'); // old chorus finished
  assert.equal(b[16].chord.symbol, 'Fmaj7');
  assert.equal(b[16].bars, 2);
});

test('count-in: one bar of clicks (accented first), then the chorus starts exactly on time', () => {
  const h = harness({ config: { countIn: true } });
  h.c.start();
  h.run(6);
  const ci = h.events.filter((e) => e.type === 'countin');
  assert.deepEqual(ci.map((e) => e.beat), [1, 2, 3, 4]);
  const clicks = h.played.filter((n) => n.inst === 'click');
  assert.equal(clicks.length, 4);
  assert.ok(clicks[0].vel > clicks[1].vel);
  const first = beats(h.events)[0];
  assert.ok(Math.abs(first.time - (ci[3].time + 0.5)) < 1e-9);
  assert.equal(first.chorus, 1);
  assert.equal(h.played.filter((n) => n.inst !== 'click' && n.when < ci[3].time + 0.5 - 0.02).length, 0); // humanising may nudge a note a few ms early
});

test('loop off: plays exactly one chorus then ends', () => {
  const h = harness({ config: { loop: false } });
  h.c.start();
  h.run(20);
  assert.equal(beats(h.events).length, 16);
  const end = h.events.find((e) => e.type === 'end');
  assert.ok(end);
  assert.ok(Math.abs(end.time - (beats(h.events).at(-1).time + 0.5)) < 1e-9);
});

test('stop halts scheduling; restarting begins again from chorus 1 in the starting key', () => {
  const h = harness({ config: { modulation: { type: 'interval', interval: 2, everyLoops: 1 } } });
  h.c.start();
  h.run(20);
  h.c.stop();
  const n = h.played.length;
  h.run(5);
  assert.equal(h.played.length, n);
  h.events.length = 0;
  h.c.start();
  h.run(1);
  const first = beats(h.events)[0];
  assert.equal(first.chorus, 1);
  assert.equal(first.key, 'C');
  assert.equal(first.bpm, 120);
});

test('scheduler starvation does not dump a pile of late notes', () => {
  const h = harness();
  h.c.start();
  h.run(2);
  h.clock.t += 5; // main thread frozen for 5 s
  const before = h.played.length;
  h.c.tick();
  const burst = h.played.slice(before);
  assert.ok(burst.every((n) => n.when >= h.clock.t - 0.001), 'no note may be scheduled in the past');
});

test('invalid progression stops playback with an error event instead of crashing', () => {
  const h = harness({ song: { progression: 'Cmaj7 | Xyz' } });
  h.c.start();
  h.run(1);
  assert.equal(h.events.at(-1).type, 'error');
  assert.equal(h.c.running, false);
});

test('unusual progressions: 1 bar, NC bars, many chords per bar, huge chorus', () => {
  for (const progression of ['C', 'C | NC | G7', 'Dm7 G7 | Cmaj7 A7 | Dm7 G7 | C6 C6/9', 'C7 | % | % | %', Array(32).fill('Am7 D7').join(' | ')]) {
    const h = harness({ song: { progression }, config: { loop: true } });
    h.c.start();
    h.run(25);
    assert.ok(beats(h.events).length > 20, progression);
    assert.ok(h.played.every((n) => Number.isFinite(n.when) && Number.isFinite(n.dur) && n.vel >= 0), progression);
  }
});
