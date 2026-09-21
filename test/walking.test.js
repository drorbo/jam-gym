import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBass, getStyle, hasBassOptions, renderBar } from '../src/styles/index.js';
import { APPROACHES, DEFAULT_BASS, HI, LO, PATTERNS, RHYTHMS, analyseChord, planSlots, sanitizeBass } from '../src/styles/walking.js';
import { parseChord } from '../src/theory/chord.js';
import { getMeter } from '../src/theory/meter.js';
import { parseProgression } from '../src/theory/progression.js';
import { createRng } from '../src/engine/rng.js';
import { mod12 } from '../src/theory/notes.js';
import { DRUM_TRIM, drumTrim } from '../src/audio/samplemap.js';

/** Render a progression's bars as the conductor would, returning each bar's events. */
function render(styleId, text, { bass, seed = 1, bpm = 110, chorus = 1, ts = '4/4' } = {}) {
  const style = getStyle(styleId);
  const meter = getMeter(ts);
  const { bars } = parseProgression(text, { timeSignature: ts });
  const state = {};
  return {
    bars,
    out: bars.map((bar, i) => renderBar(style, {
      segments: bar.chords, nextChord: (bars[i + 1] ?? bars[0]).chords.find((s) => s.chord)?.chord ?? null,
      barIndex: i, barCount: bars.length, isFirstBar: i === 0, isLastBar: i === bars.length - 1,
      chorus, bpm, meter, beatsPerBar: meter.quarters, state, bass, rng: createRng(seed * 1000 + i),
    })),
  };
}
const bassOf = (events) => events.filter((e) => e.inst === 'bass').sort((a, b) => a.beat - b.beat);
const mains = (events) => bassOf(events).filter((e) => !e.ghost);
const PROG = 'Dm7 | G7 | Cmaj7 | Am7 | Dm7 | G7 | Cmaj7 | Cmaj7';
const nextRootOf = (bars, i) => (bars[i + 1] ?? bars[0]).chords[0].chord.root;

// ---- snare ---------------------------------------------------------------------------------

test('snare: recorded snares are trimmed up, everything else is left alone', () => {
  assert.ok(DRUM_TRIM.snare >= 1.5, 'the snare recordings sit well under the kick and need a boost');
  assert.equal(drumTrim('snare'), DRUM_TRIM.snare);
  for (const v of ['kick', 'hat', 'ride', 'crash', 'tomLow']) assert.equal(drumTrim(v), 1);
});

test('snare: every style plays enough audible snare hits per bar (jazz used to leave the snare almost silent)', () => {
  const need = { jazz: 1, blues: 2, rock: 2 };
  for (const [id, min] of Object.entries(need)) {
    let hits = 0;
    let bars = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const events of render(id, 'Dm7 | G7 | Cmaj7 | Am7', { seed, bpm: 120 }).out) {
        hits += events.filter((e) => e.voice === 'snare' && e.vel >= 0.45).length;
        bars++;
      }
    }
    assert.ok(hits / bars >= min, `${id}: ${(hits / bars).toFixed(2)} audible snare hits per bar (want at least ${min})`);
  }
});

test('snare: backbeat snares in blues and rock are always on 2 and 4 and loud', () => {
  for (const id of ['blues', 'rock']) {
    for (const events of render(id, 'C7 | F7', { seed: 4 }).out) {
      for (const beat of [1, 3]) {
        const s = events.find((e) => e.voice === 'snare' && Math.abs(e.beat - beat) < 0.05);
        assert.ok(s && s.vel > 0.7, `${id}: backbeat on ${beat + 1}`);
      }
    }
  }
});

// ---- settings ------------------------------------------------------------------------------

test('bass settings: junk is replaced by the base, good values are kept and clamped', () => {
  assert.deepEqual(sanitizeBass(undefined), DEFAULT_BASS);
  assert.deepEqual(sanitizeBass('nope'), DEFAULT_BASS);
  const s = sanitizeBass({ rhythm: 'eighths', line: 250, tension: -4, approach: 'enclosure', pattern: 'walk' });
  assert.deepEqual(s, { rhythm: 'eighths', line: 100, tension: 0, approach: 'enclosure', pattern: 'walk' });
  const bad = sanitizeBass({ rhythm: 'polka', line: 'x', tension: NaN, approach: 5, pattern: {} }, { rhythm: 'two', line: 12, tension: 34, approach: 'step', pattern: 'walk' });
  assert.deepEqual(bad, { rhythm: 'two', line: 12, tension: 34, approach: 'step', pattern: 'walk' });
  assert.ok(RHYTHMS.length >= 5 && APPROACHES.length >= 5 && PATTERNS.length === 3);
});

test('bass settings: jazz and blues have a panel, rock does not; each style starts from its own defaults', () => {
  assert.equal(hasBassOptions(getStyle('jazz')), true);
  assert.equal(hasBassOptions(getStyle('blues')), true);
  assert.equal(hasBassOptions(getStyle('rock')), false);
  assert.notDeepEqual(defaultBass(getStyle('jazz')), defaultBass(getStyle('blues')));
  assert.deepEqual(defaultBass(getStyle('rock')), DEFAULT_BASS);
});

// ---- rhythm --------------------------------------------------------------------------------

test('rhythm: steady quarters is exactly one note on each beat', () => {
  for (let seed = 1; seed <= 20; seed++) {
    for (const events of render('jazz', PROG, { seed, bass: { rhythm: 'quarters' } }).out) {
      assert.deepEqual(bassOf(events).map((e) => Math.round(e.beat * 100) / 100 | 0).map(String).join(), '0,1,2,3'.split(',').join());
    }
  }
});

test('rhythm: skips keep the four main notes and add only short ghost notes or passing tones on the "and"', () => {
  let extras = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (const events of render('jazz', PROG, { seed, bass: { rhythm: 'skips' } }).out) {
      const all = bassOf(events);
      const onBeat = all.filter((e) => Math.abs(e.beat - Math.round(e.beat)) < 0.02);
      assert.equal(onBeat.length, 4, 'a note on every beat');
      for (const e of all.filter((x) => !onBeat.includes(x))) {
        extras++;
        assert.ok(e.dur <= 0.5 && e.beat % 1 > 0.5 && e.beat % 1 < 0.75, `the extra note sits on the swung "and" (${e.beat})`);
        if (e.ghost) assert.ok(e.vel < 0.45, 'ghost notes are quiet');
      }
    }
  }
  assert.ok(extras > 30, `skips should actually appear (${extras})`);
});

test('rhythm: eighths fill the bar with eighth notes, with at most a couple of held notes', () => {
  for (let seed = 1; seed <= 20; seed++) {
    for (const events of render('jazz', PROG, { seed, bass: { rhythm: 'eighths' } }).out) {
      const b = bassOf(events);
      assert.ok(b.length >= 6 && b.length <= 8, `${b.length} notes`);
      assert.ok(Math.abs(b[0].beat) < 1e-6);
    }
  }
});

test('rhythm: two-feel plays half notes on beats one and three, sometimes walking the last beat', () => {
  let walked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { out, bars } = render('jazz', PROG, { seed, bass: { rhythm: 'two' } });
    out.forEach((events, i) => {
      const b = bassOf(events);
      assert.ok(b.length === 2 || b.length === 3, `${b.length} notes`);
      assert.ok(Math.abs(b[0].beat) < 1e-6 && Math.abs(b[1].beat - 2) < 1e-6);
      assert.ok(b[0].dur > 1.5, 'the first note is a half note');
      if (b.length === 3) {
        walked++;
        assert.ok(Math.abs(b[2].beat - 3) < 1e-6);
      } else {
        const chord = bars[i].chords[0].chord;
        assert.ok([0, chord.fifth ?? 7, chord.third].includes(mod12(b[1].midi - chord.root)), 'beat three is the root, third or fifth');
      }
    });
  }
  assert.ok(walked > 5 && walked < 150);
});

test('rhythm: mixed uses every rhythm over a chorus of choruses, and never eighths at a fast tempo', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    for (const events of render('jazz', PROG, { seed, bass: { rhythm: 'mixed' } }).out) {
      const b = bassOf(events);
      const ghosts = b.filter((e) => e.ghost).length;
      const off = b.filter((e) => Math.abs(e.beat - Math.round(e.beat)) > 0.02).length;
      seen.add(b.length <= 3 ? 'two' : b.length >= 6 && off > 2 ? 'eighths' : off || ghosts ? 'skips' : 'quarters');
    }
  }
  for (const k of ['quarters', 'skips', 'eighths', 'two']) assert.ok(seen.has(k), `mixed never played ${k}`);
  const modes = (bpm) => {
    const rng = createRng(11);
    const got = new Set();
    for (let i = 0; i < 400; i++) got.add(planSlots({ startBeat: 0, beats: 4 }, 'mixed', rng, { bpm, flavor: 'jazz' }).mode);
    return got;
  };
  assert.ok(modes(100).has('eighths'), 'eighths are used at a comfortable tempo');
  assert.ok(!modes(200).has('eighths'), 'no runs of eighths at 200 BPM');
  assert.ok(!(() => { const rng = createRng(3); for (let i = 0; i < 300; i++) if (planSlots({ startBeat: 0, beats: 4 }, 'mixed', rng, { flavor: 'blues' }).mode === 'two') return true; return false; })(), 'no two-feel bars in the blues');
});

// ---- approach notes ------------------------------------------------------------------------

test('approach: each choice lands where it says on the next chord', () => {
  const rel = (events, root) => bassOf(events).map((e) => mod12(e.midi - root));
  for (let seed = 1; seed <= 25; seed++) {
    for (const [mode, ok] of [['chromatic', [1, 11]], ['step', [2, 10]], ['fifth', [7]]]) {
      const { out, bars } = render('jazz', PROG, { seed, bass: { rhythm: 'quarters', approach: mode } });
      out.forEach((events, i) => {
        const last = rel(events, nextRootOf(bars, i)).pop();
        assert.ok(ok.includes(last), `${mode}: approached with ${last}`);
      });
    }
    // an enclosure: a note above the target (a half or whole step), then the note a half step below it
    const { out, bars } = render('jazz', PROG, { seed, bass: { rhythm: 'quarters', approach: 'enclosure' } });
    out.forEach((events, i) => {
      const r = rel(events, nextRootOf(bars, i));
      assert.ok([1, 2].includes(r[2]) && r[3] === 11, `enclosure ${r.slice(2)}`);
    });
  }
});

test('approach: a chord that leads nowhere settles on its fifth', () => {
  const style = getStyle('jazz');
  const { bars } = parseProgression('Cmaj7');
  const state = {};
  for (let seed = 1; seed <= 20; seed++) {
    const ev = renderBar(style, {
      segments: bars[0].chords, nextChord: null, barIndex: 0, barCount: 1, isFirstBar: true, isLastBar: true, chorus: 1, bpm: 120,
      beatsPerBar: 4, state, bass: { rhythm: 'quarters' }, rng: createRng(seed),
    });
    assert.equal(mod12(bassOf(ev).pop().midi), 7);
  }
});

// ---- line shape ----------------------------------------------------------------------------

function stats(bass) {
  let steps = 0;
  let intervals = 0;
  let chordTones = 0;
  let inner = 0;
  let notes = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { out, bars } = render('jazz', PROG, { seed, bass: { rhythm: 'quarters', approach: 'chromatic', ...bass } });
    out.forEach((events, i) => {
      const chord = bars[i].chords[0].chord;
      const info = analyseChord(chord, 'jazz', 0);
      const b = mains(events);
      for (let k = 1; k < b.length; k++) { intervals++; if (Math.abs(b[k].midi - b[k - 1].midi) <= 2) steps++; }
      for (const n of b.slice(1, 3)) { inner++; if (info.category(mod12(n.midi - chord.root)) === 0) chordTones++; }
      notes += b.length;
    });
  }
  return { stepRate: steps / intervals, chordToneRate: chordTones / inner, notes };
}

test('line: the slider moves a line from scales towards arpeggios', () => {
  const scales = stats({ line: 0, tension: 0 });
  const arps = stats({ line: 100, tension: 0 });
  assert.ok(scales.stepRate > arps.stepRate + 0.15, `steps ${scales.stepRate.toFixed(2)} vs ${arps.stepRate.toFixed(2)}`);
  assert.ok(arps.chordToneRate > scales.chordToneRate + 0.1, `chord tones ${arps.chordToneRate.toFixed(2)} vs ${scales.chordToneRate.toFixed(2)}`);
});

test('tension: with none, beats one and three are chord tones; turned up, colour tones appear there', () => {
  const colourOnStrong = (tension) => {
    let colour = 0;
    let total = 0;
    let nonChord = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { out, bars } = render('jazz', PROG, { seed, bass: { rhythm: 'quarters', tension, line: 50, approach: 'chromatic' } });
      out.forEach((events, i) => {
        const chord = bars[i].chords[0].chord;
        const info = analyseChord(chord, 'jazz', tension / 100);
        const beat3 = mains(events)[2];
        total++;
        const cat = info.category(mod12(beat3.midi - chord.root));
        if (cat === 1) colour++;
        if (cat > 0) nonChord++;
      });
    }
    return { colour: colour / total, nonChord: nonChord / total };
  };
  const none = colourOnStrong(0);
  const lots = colourOnStrong(100);
  assert.ok(none.nonChord < 0.06, `${none.nonChord.toFixed(2)} of beat threes were not chord tones with tension 0`);
  assert.ok(lots.colour > none.colour + 0.1, `colour tones on beat three: ${lots.colour.toFixed(2)} vs ${none.colour.toFixed(2)}`);
});

// ---- general musicality --------------------------------------------------------------------

test('lines: in range, no repeated notes or giant leaps, first note is the root, across settings', () => {
  const settings = [
    { rhythm: 'quarters' }, { rhythm: 'skips', line: 80 }, { rhythm: 'eighths', tension: 70 }, { rhythm: 'two' },
    { rhythm: 'mixed', approach: 'enclosure', line: 10 }, { rhythm: 'quarters', approach: 'fifth', tension: 100, line: 100 },
  ];
  for (const bass of settings) {
    let repeats = 0;
    let moves = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const { out, bars } = render('jazz', 'C13sus4 | F#m7b5/C | Bbmaj7#11 | E7#9b13 | Adim7/Eb | Db6/9 | G+7 | Ab5 | Dm7 G7 | C6 C6/9 D7 G7 | C7alt', { seed, bass });
      out.forEach((events, i) => {
        const b = mains(events);
        assert.ok(b.length > 0);
        for (const e of bassOf(events)) assert.ok(e.midi >= LO && e.midi <= HI, `${JSON.stringify(bass)}: ${e.midi}`);
        const first = bars[i].chords[0].chord;
        assert.equal(mod12(b[0].midi), first.bass ?? first.root, 'starts on the root (or slash bass)');
        for (let k = 1; k < b.length; k++) {
          const d = Math.abs(b[k].midi - b[k - 1].midi);
          moves++;
          if (d === 0) repeats++;
          assert.ok(d <= 12, `leap of ${d}`);
        }
      });
    }
    assert.ok(repeats / moves < 0.12, `${JSON.stringify(bass)}: ${(repeats / moves).toFixed(2)} of moves repeat the note`);
  }
});

test('lines vary: bars over the same chord are not copies of each other', () => {
  for (const rhythm of ['quarters', 'eighths']) {
    const shapes = new Set();
    const { out } = render('jazz', Array(12).fill('Cmaj7').join(' | '), { seed: 3, bass: { rhythm } });
    for (const events of out) shapes.add(bassOf(events).map((e) => e.midi).join());
    assert.ok(shapes.size >= 9, `${rhythm}: only ${shapes.size} different lines in 12 bars`);
  }
});

test('lines are reproducible for a seed, and change with it', () => {
  const run = (seed) => JSON.stringify(render('jazz', PROG, { seed, bass: { rhythm: 'mixed' } }).out.map(bassOf));
  assert.equal(run(9), run(9));
  assert.notEqual(run(9), run(10));
});

test('chord tones by chord type: the analysis names the notes a player would choose', () => {
  const info = (sym, flavor) => analyseChord(parseChord(sym), flavor, 0.25);
  const m7 = info('Dm7');
  assert.deepEqual([...m7.chordTones].sort((a, b) => a - b), [0, 3, 7, 10]);
  assert.ok(m7.colour.has(2) && m7.colour.has(5) && m7.colour.has(9), 'minor 7: 9th, 11th and 13th are colour');
  const dom = info('G7');
  assert.ok(dom.colour.has(2) && dom.colour.has(9));
  assert.equal(dom.category(1), 3, 'a flat 9 over plain G7 is chromatic');
  assert.ok(info('G7#9b13').colour.has(3) && info('G7b9').colour.has(1), 'written alterations count as colour');
  assert.ok(info('Cmaj7').colour.has(2) && !info('Cmaj7').colour.has(5), 'no 4th over a major 7th');
  const blues = info('C7', 'blues');
  assert.ok(blues.chordTones.has(9) && blues.chordTones.has(10), 'the 6th and b7 are chord tones in the blues');
  assert.ok(blues.scale.has(3) && blues.scale.has(6), 'blue notes pass through');
});

// ---- blues ---------------------------------------------------------------------------------

const TWELVE = 'C7 | F7 | C7 | C7 | F7 | F7 | C7 | C7 | G7 | F7 | C7 | G7';

test('blues: "boogie" plays eight eighths a bar, with a half-step lead into changes', () => {
  let leads = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { out, bars } = render('blues', TWELVE, { seed, bass: { pattern: 'boogie' } });
    out.forEach((events, i) => {
      const b = bassOf(events);
      assert.equal(b.length, 8);
      assert.ok(b[0].beat === 0 && Math.abs(b[7].beat - 3.5) < 0.5);
      const next = nextRootOf(bars, i);
      if (next !== bars[i].chords[0].chord.root && [1, 11].includes(mod12(b[7].midi - next))) leads++;
    });
  }
  assert.ok(leads > 40, `the boogie should lead into chord changes (${leads})`);
});

test('blues: "walking throughout" walks every bar; the default boogie walks at the turnaround', () => {
  const walk = render('blues', TWELVE, { seed: 2, bass: { pattern: 'walk', rhythm: 'quarters' } }).out;
  for (const events of walk) assert.equal(bassOf(events).length, 4);
  const mixed = render('blues', TWELVE, { seed: 2, bass: { pattern: 'mixed' } }).out;
  assert.equal(bassOf(mixed[11]).length <= 5 && bassOf(mixed[11]).length >= 4, true, 'the last bar walks');
  const boogieBars = mixed.slice(0, 11).filter((e) => bassOf(e).length === 8).length;
  assert.ok(boogieBars >= 8, `most other bars are the eight-note boogie (${boogieBars})`);
});

test('blues walking uses the blues tones: 6ths and flat 7ths turn up, and it sounds in the electric-bass range', () => {
  let sixths = 0;
  for (let seed = 1; seed <= 30; seed++) {
    for (const events of render('blues', 'C7 | C7 | C7 | C7', { seed, bass: { pattern: 'walk', rhythm: 'quarters', line: 70 } }).out) {
      for (const e of mains(events)) if ([9, 10].includes(mod12(e.midi))) sixths++;
      for (const e of bassOf(events)) assert.ok(e.midi >= LO && e.midi <= HI);
    }
  }
  assert.ok(sixths > 20, `${sixths} sixths and flat sevenths`);
});

// ---- odd meters ----------------------------------------------------------------------------

for (const ts of ['6/8', '7/8', '10/8']) {
  test(`${ts}: the walking line follows the groupings, in every rhythm`, () => {
    const meter = getMeter(ts);
    const starts = meter.groupSpans.map((g) => g.start);
    for (const rhythm of ['quarters', 'skips', 'eighths', 'two', 'mixed']) {
      for (let seed = 1; seed <= 12; seed++) {
        const { out } = render('jazz', 'Am7 | Dm7 | E7 | Am7', { seed, ts, bass: { rhythm } });
        out.forEach((events) => {
          const b = bassOf(events);
          assert.ok(b.length >= starts.length, `${ts} ${rhythm}: ${b.length} notes`);
          for (const s of starts) assert.ok(b.some((e) => Math.abs(e.beat - s) < 1e-6 && !e.ghost), `${ts} ${rhythm}: a note on the group at ${s}`);
          for (const e of b) assert.ok(e.beat >= 0 && e.beat < meter.quarters && e.midi >= LO && e.midi <= HI);
        });
      }
    }
  });
}

test('rock ignores the walking settings', () => {
  const a = JSON.stringify(render('rock', 'C | G | Am | F', { seed: 5 }).out);
  const b = JSON.stringify(render('rock', 'C | G | Am | F', { seed: 5, bass: { rhythm: 'eighths', line: 100, tension: 100, approach: 'enclosure', pattern: 'walk' } }).out);
  assert.equal(a, b);
});

test('the bass setting reaches the audio events untouched by feel and humanising (durations positive, velocities in range)', () => {
  for (const rhythm of ['quarters', 'skips', 'eighths', 'two']) {
    for (const events of render('jazz', PROG, { seed: 8, bass: { rhythm } }).out) {
      for (const e of bassOf(events)) {
        assert.ok(e.dur > 0 && e.vel > 0 && e.vel <= 1 && Number.isFinite(e.beat));
        assert.equal(e.timbre, 'double');
      }
    }
  }
});

// ---- saved with the setup ------------------------------------------------------------------

import { sanitize, defaultState } from '../src/app/state.js';
import { buildTrackData, dataFromLocalSave, setupSignature } from '../src/app/tracks-model.js';

test('bass settings live in the app state, checked on the way in, and a new style brings its own', () => {
  assert.deepEqual(defaultState().config.bass, defaultBass(getStyle('jazz')));
  assert.deepEqual(sanitize({ config: { style: 'blues' } }).config.bass, defaultBass(getStyle('blues')), 'missing -> the style default');
  const s = sanitize({ config: { style: 'jazz', bass: { rhythm: 'eighths', line: 999, approach: 'nonsense' } } });
  assert.deepEqual(s.config.bass, { ...defaultBass(getStyle('jazz')), rhythm: 'eighths', line: 100 });
});

test('a track keeps the bass line and notices when it changes', () => {
  const state = defaultState();
  state.config.bass = { ...state.config.bass, rhythm: 'two', tension: 80 };
  const data = buildTrackData(state);
  assert.deepEqual(data.config.bass, state.config.bass);
  const changed = { ...state, config: { ...state.config, bass: { ...state.config.bass, line: 5 } } };
  assert.notEqual(setupSignature(data), setupSignature(buildTrackData(changed)), 'a different bass line is an edit');
  assert.equal(setupSignature(data), setupSignature(buildTrackData(state)));
  const local = dataFromLocalSave({ name: 'x', text: 'C7 | F7', key: 'C', timeSignature: '4/4', style: 'blues', tempo: 100 });
  assert.deepEqual(local.config.bass, defaultBass(getStyle('blues')));
});
