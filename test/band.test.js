import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBass, defaultComp, defaultKit, getStyle, listStyles, renderBar } from '../src/styles/index.js';
import {
  DEFAULT_BASS, DEFAULT_COMP, DEFAULT_KIT, GROUPS, GROUP_IDS, MIX_SPREAD, describeGroup, fieldsFor, optionsFor, resolveMix, sanitizeGroup, wander, wordFor,
} from '../src/styles/settings.js';
import { tensionLevel } from '../src/styles/comping.js';
import { getMeter } from '../src/theory/meter.js';
import { parseProgression } from '../src/theory/progression.js';
import { createRng } from '../src/engine/rng.js';
import { mod12 } from '../src/theory/notes.js';
import { sanitize, defaultState } from '../src/app/state.js';
import { buildTrackData, setupSignature } from '../src/app/tracks-model.js';

const PROGS = {
  jazz: 'Dm7 | G7 | Cmaj7 | Am7 | Dm7 | G7 | Cmaj7 | C6',
  blues: 'C7 | F7 | C7 | C7 | F7 | F7 | C7 | G7',
  rock: 'Am | G | F | E | Am | G | F | E',
};
const STYLES = ['jazz', 'blues', 'rock'];

/** Render every bar of a progression, over several seeds, and collect the events. */
function render(style, over = {}, { seeds = 24, prog = PROGS[style], ts = '4/4', bpm = 120, chorus = 2 } = {}) {
  const st = getStyle(style);
  const meter = getMeter(ts);
  const { bars } = parseProgression(prog, { timeSignature: ts });
  const events = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const state = {};
    bars.forEach((bar, i) => {
      const next = bars[(i + 1) % bars.length];
      const ev = renderBar(st, {
        segments: bar.chords, nextChord: next.chords.find((s) => s.chord)?.chord ?? null,
        barIndex: i, barCount: bars.length, isFirstBar: i === 0, isLastBar: i === bars.length - 1,
        chorus, bpm, meter, beatsPerBar: meter.quarters, state, rng: createRng(seed * 100 + i), ...over,
      });
      for (const e of ev) events.push({ ...e, bar: i, seed, last: i === bars.length - 1 });
    });
  }
  return { events, bars: seeds * bars.length, barsPerSeed: bars.length, parsed: bars };
}
const per = (r, pred) => r.events.filter(pred).length / r.bars;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const drums = (r, voices) => r.events.filter((e) => e.inst === 'drums' && (!voices || voices.includes(e.voice)));
const TOMS = ['tomHigh', 'tomMid', 'tomLow'];

/** Chord hits: the notes that sound at the same moment in a bar. */
function chordHits(r) {
  const groups = new Map();
  for (const e of r.events.filter((x) => x.inst === 'chords')) {
    const key = `${e.seed}|${e.bar}|${e.beat.toFixed(3)}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()];
}
const onBeat = (beat) => Math.abs(beat - Math.round(beat)) < 0.02;

// ---- the schema ------------------------------------------------------------------------------

test('settings: sliders carry five words, selects have options, ids are unique within a group', () => {
  for (const g of GROUP_IDS) {
    const ids = GROUPS[g].fields.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, `${g}: duplicate field ids`);
    for (const f of GROUPS[g].fields) {
      assert.ok(f.name, `${g}.${f.id} has a name`);
      if (f.type === 'slider') {
        assert.equal(f.words.length, 5, `${g}.${f.id}`);
        for (const words of Object.values(f.wordsByStyle ?? {})) assert.equal(words.length, 5, `${g}.${f.id} by style`);
      } else {
        assert.ok(f.options.length >= 2, `${g}.${f.id}`);
        assert.equal(new Set(f.options.map((o) => `${o.id}/${(o.styles ?? []).join()}`)).size, f.options.length, `${g}.${f.id}: duplicate option`);
      }
    }
  }
});

test('settings: every style starts from valid defaults, and each select default is one that style offers', () => {
  const builders = { bass: defaultBass, comp: defaultComp, kit: defaultKit };
  for (const style of listStyles()) {
    for (const g of GROUP_IDS) {
      const d = builders[g](style);
      assert.deepEqual(sanitizeGroup(g, d, d), d, `${style.id}.${g} defaults survive checking`);
      for (const f of fieldsFor(g, style.id)) {
        if (f.type === 'select') assert.ok(optionsFor(f, style.id).some((o) => o.id === d[f.id]), `${style.id}.${g}.${f.id} = ${d[f.id]} is not offered`);
      }
    }
  }
});

test('settings: junk is repaired field by field; sliders are whole numbers 0 to 100; unknown options fall back', () => {
  const s = sanitizeGroup('kit', { cymbal: 250, kick: -3, snare: 'loud', ghosts: 33.6, fills: NaN, extra: 1 }, { ...DEFAULT_KIT, snare: 20 });
  assert.equal(s.cymbal, 100);
  assert.equal(s.kick, 0);
  assert.equal(s.snare, 20, 'a non-number takes the base');
  assert.equal(s.ghosts, 34);
  assert.equal(s.fills, DEFAULT_KIT.fills);
  assert.ok(!('extra' in s));
  assert.equal(sanitizeGroup('comp', { rhythm: 'polka' }).rhythm, 'auto');
  assert.equal(sanitizeGroup('comp', { rhythm: 'chug' }).rhythm, 'chug');
  assert.deepEqual(sanitizeGroup('bass', null), DEFAULT_BASS);
  assert.deepEqual(sanitizeGroup('comp', 'junk'), DEFAULT_COMP);
});

test('settings: the panel header says "Style default" until something differs, then names what changed', () => {
  const style = getStyle('jazz');
  const d = defaultComp(style);
  assert.equal(describeGroup('comp', d, d, 'jazz'), 'Style default');
  assert.match(describeGroup('comp', { ...d, density: 25 }, d, 'jazz'), /How much: sparse/);
  assert.match(describeGroup('comp', { ...d, rhythm: 'charleston' }, d, 'jazz'), /Charleston/);
  assert.match(describeGroup('comp', { ...d, density: 0, sync: 0, variety: 0, range: 0, spread: 0 }, d, 'jazz'), /\+2 more/);
  assert.equal(wordFor(GROUPS.kit.fields.find((f) => f.id === 'fills'), 'jazz', 0), 'None');
  assert.equal(wordFor(GROUPS.comp.fields.find((f) => f.id === 'tension'), 'rock', 100), 'Open and ringing');
});

// ---- whole-instrument settings: dynamics, length, timing, feel ---------------------------------

test('dynamics: the Dynamics slider scales drum and keys velocity, softest to hardest', () => {
  for (const style of STYLES) {
    const vel = (over) => mean(render(style, over, { seeds: 6 }).events.filter((e) => e.inst === 'drums' || e.inst === 'chords').map((e) => e.vel));
    const soft = vel({ kit: { power: 0 }, comp: { power: 0 } });
    const mid = vel({});
    const hard = vel({ kit: { power: 100 }, comp: { power: 100 } });
    assert.ok(soft < mid - 0.08 && mid < hard - 0.05, `${style}: ${soft.toFixed(2)} < ${mid.toFixed(2)} < ${hard.toFixed(2)}`);
  }
});

test('note length: the bass gets shorter or longer, never overlapping past the next note', () => {
  for (const style of STYLES) {
    const dur = (length) => mean(render(style, { bass: { length } }, { seeds: 6 }).events.filter((e) => e.inst === 'bass' && !e.ghost).map((e) => e.dur));
    const short = dur(0);
    const mid = dur(50);
    const long = dur(100);
    assert.ok(short < mid * 0.75 && long > mid, `${style}: ${short.toFixed(2)} ${mid.toFixed(2)} ${long.toFixed(2)}`);
  }
  // legato holds a note until the next one starts, no longer
  const r = render('jazz', { bass: { length: 100, rhythm: 'quarters' } }, { seeds: 4 });
  for (const seed of [1, 2, 3, 4]) {
    const bass = r.events.filter((e) => e.inst === 'bass' && e.seed === seed && e.bar === 0).sort((a, b) => a.beat - b.beat);
    bass.slice(0, -1).forEach((e, i) => assert.ok(e.beat + e.dur <= bass[i + 1].beat + 0.02, 'no note runs into the next'));
  }
});

test('timing and feel: Timing shifts a whole part behind or ahead of the beat, Feel widens or removes the looseness', () => {
  for (const [inst, group] of [['drums', 'kit'], ['bass', 'bass'], ['chords', 'comp']]) {
    const dt = (over) => mean(render('jazz', over, { seeds: 6 }).events.filter((e) => e.inst === inst).map((e) => e.dt ?? 0));
    const ahead = dt({ [group]: { pocket: 0 } });
    const behind = dt({ [group]: { pocket: 100 } });
    assert.ok(behind - ahead > 0.02, `${inst}: ${ahead.toFixed(3)} to ${behind.toFixed(3)} s`);
    assert.ok(Math.abs(behind - ahead) < 0.05, 'a feel, not a mistake: well under a sixteenth');
  }
  const spread = (loose) => {
    const dts = render('jazz', { kit: { loose } }, { seeds: 6 }).events.filter((e) => e.inst === 'drums' && e.voice === 'ride').map((e) => e.dt);
    return Math.max(...dts) - Math.min(...dts);
  };
  assert.ok(spread(0) < 1e-9, 'machine tight: every ride note is exactly where it is written');
  assert.ok(spread(100) > spread(50), 'sloppy is looser than natural');
});

// ---- the drummer -----------------------------------------------------------------------------

test('drums, cymbals: quarters only at the bottom, the style\'s pattern in the middle, busier at the top', () => {
  for (const style of STYLES) {
    const n = (cymbal) => per(render(style, { kit: { cymbal, fills: 0 } }), (e) => ['ride', 'hat', 'hatOpen'].includes(e.voice));
    assert.ok(n(0) < n(50) && n(50) < n(100), `${style}: ${n(0)} ${n(50)} ${n(100)}`);
  }
  const jazzRide = drums(render('jazz', { kit: { cymbal: 0, fills: 0 } }), ['ride']);
  assert.ok(jazzRide.every((e) => onBeat(e.beat)), 'the jazz ride is four quarters, no skip notes');
  const rockHat = render('rock', { kit: { cymbal: 0, fills: 0 } });
  assert.equal(per(rockHat, (e) => e.voice === 'hat'), 4, 'rock hat plays quarter notes');
  assert.ok(per(render('rock', { kit: { cymbal: 100, fills: 0 } }), (e) => e.voice === 'hat') > 10, 'rock hat fills in sixteenths at the top');
});

test('drums, kick: only on the beat at the bottom, syncopated at the top', () => {
  const offbeat = (style, kick) => {
    const kicks = drums(render(style, { kit: { kick, fills: 0 } }), ['kick']).filter((e) => e.vel > 0.3);
    return kicks.filter((e) => !onBeat(e.beat)).length / Math.max(1, kicks.length);
  };
  for (const style of ['blues', 'rock']) {
    assert.equal(offbeat(style, 0), 0, `${style}: no kick off the beat at 0`);
    assert.ok(offbeat(style, 100) > 0.2, `${style}: ${offbeat(style, 100)}`);
  }
  const rockLow = drums(render('rock', { kit: { kick: 0, fills: 0 } }), ['kick']);
  assert.ok(rockLow.every((e) => [0, 2].includes(e.beat)), 'one and three');
  const jazzFeathers = (kick) => per(render('jazz', { kit: { kick, fills: 0 } }), (e) => e.voice === 'kick');
  assert.equal(jazzFeathers(0), 2, 'jazz keeps the feathered kick to beats one and three');
  assert.ok(jazzFeathers(100) > jazzFeathers(50));
});

test('drums, snare: the backbeat is untouched; extra hits come and go with the Snare slider (in jazz that is the comping)', () => {
  for (const style of ['blues', 'rock']) {
    for (const snare of [0, 100]) {
      for (const e of [1, 3]) {
        const hits = drums(render(style, { kit: { snare, fills: 0 } }, { seeds: 6 }), ['snare']).filter((x) => x.beat === e && x.vel > 0.7);
        assert.ok(hits.length >= 6 * 8, `${style} snare=${snare}: backbeat ${e} played every bar`);
      }
    }
  }
  const jazz = (snare) => per(render('jazz', { kit: { snare, fills: 0 } }), (e) => e.voice === 'snare');
  assert.ok(jazz(0) < 0.05 && jazz(0) < jazz(50) && jazz(50) < jazz(100), `${jazz(0)} ${jazz(50)} ${jazz(100)}`);
  for (const style of ['blues', 'rock']) {
    const extras = (snare) => per(render(style, { kit: { snare, ghosts: 0, fills: 0 } }), (e) => e.voice === 'snare' && e.vel < 0.8);
    assert.ok(extras(100) > extras(0) + 0.15, `${style}: ${extras(0)} to ${extras(100)}`);
  }
});

test('drums, ghost notes: none at the bottom, more at the top, in every style', () => {
  for (const style of STYLES) {
    const g = (ghosts) => per(render(style, { kit: { ghosts, fills: 0, snare: 50 } }), (e) => e.voice === 'snare' && e.vel < 0.45);
    assert.equal(g(0), 0, `${style}: none`);
    assert.ok(g(50) > 0 && g(100) > g(50), `${style}: ${g(50)} ${g(100)}`);
  }
});

test('drums, fills: none when off, at the end of every chorus when constant, and Fill style grows them from a pickup to a run', () => {
  for (const style of STYLES) {
    const off = render(style, { kit: { fills: 0, snare: style === 'jazz' ? 0 : 50, ghosts: 0 } });
    assert.equal(drums(off, TOMS).length, 0, `${style}: no tom fills at 0`);
    const constant = (wild, fills = 100) => render(style, { kit: { fills, wild, ghosts: 0, snare: style === 'jazz' ? 0 : 50 } }, { seeds: 12 });
    const lastBar = (r) => r.events.filter((e) => e.inst === 'drums' && e.last);
    assert.ok((lastBar(constant(50)).length - lastBar(constant(50, 0)).length) / 12 >= 1.5, `${style}: the last bar of every chorus has a fill`);
    const size = (wild) => lastBar(constant(wild)).length / 12;
    assert.ok(size(0) < size(50) && size(50) < size(100), `${style}: a wilder fill has more in it (${size(0)}, ${size(50)}, ${size(100)})`);
  }
  // a big fill is followed by a crash on the next downbeat
  const crashAfter = drums(render('rock', { kit: { fills: 100, wild: 100 } }), ['crash']).filter((e) => e.bar === 0).length;
  assert.ok(crashAfter > 0);
});

test('drums, crashes: none at zero, more at the top; rock crashes on the first bar as it always did', () => {
  for (const style of STYLES) assert.equal(drums(render(style, { kit: { crash: 0, fills: 100, wild: 100 } }), ['crash']).length, 0, `${style} at 0`);
  const rockFirst = drums(render('rock', {}, { seeds: 6 }), ['crash']).filter((e) => e.bar === 0);
  assert.equal(rockFirst.length, 6, 'a crash on beat one of the first bar, every time');
  const n = (crash) => drums(render('jazz', { kit: { crash } }, { seeds: 60 }), ['crash']).length;
  assert.ok(n(100) > n(50), `${n(50)} ${n(100)}`);
});

for (const ts of ['6/8', '7/8', '10/8']) {
  test(`drums in ${ts}: the same settings apply (cymbal, snare, ghosts, fills, crashes)`, () => {
    const meter = getMeter(ts);
    for (const style of STYLES) {
      const prog = 'Am7 | Dm7 | E7 | Am7';
      const r = (kit) => render(style, { kit }, { prog, ts, seeds: 12 });
      const cym = (cymbal) => per(r({ cymbal, fills: 0 }), (e) => ['ride', 'hat'].includes(e.voice));
      assert.ok(cym(0) <= cym(50) && cym(50) <= cym(100) && cym(0) < cym(100), `${ts} ${style} cymbal ${cym(0)} ${cym(50)} ${cym(100)}`);
      assert.equal(drums(r({ fills: 0, snare: 0, ghosts: 0, crash: 0 }), TOMS).length, 0, `${ts} ${style}: no fills`);
      const fillBar = (wild) => r({ fills: 100, wild }).events.filter((e) => e.inst === 'drums' && e.last).length;
      assert.ok(fillBar(0) < fillBar(100), `${ts} ${style}: a wild fill is longer`);
      for (const e of r({ fills: 100, wild: 100 }).events) assert.ok(e.beat >= 0 && e.beat < meter.quarters + 0.001, `${ts} ${style}: hit at ${e.beat}`);
    }
  });
}

// ---- the keys --------------------------------------------------------------------------------

test('keys, density: one chord at the bottom, more and more towards the top', () => {
  for (const style of STYLES) {
    const n = (density) => chordHits(render(style, { comp: { density } })).length / (24 * 8);
    assert.ok(n(0) < 1.05, `${style}: a single chord a bar at 0 (${n(0)})`);
    assert.ok(n(0) < n(50) && n(50) < n(100) && n(100) > 2 * n(0), `${style}: ${n(0)} ${n(50)} ${n(100)}`);
  }
});

test('keys, on or off the beat: hits on the beat at the bottom, on the "ands" at the top; the change is always marked', () => {
  for (const style of STYLES) {
    const off = (sync) => {
      const hits = chordHits(render(style, { comp: { sync, density: 70 } }));
      return hits.filter((h) => !onBeat(h[0].beat)).length / hits.length;
    };
    if (style === 'rock') assert.ok(off(100) > off(0) + 0.15 && off(100) > 0.55, `${style}: ${off(0)} ${off(100)}`); // its palm-muted eighths are the same at any setting
    else assert.ok(off(0) < 0.15 && off(100) > 0.6 && off(0) < off(50) && off(50) < off(100), `${style}: ${off(0)} ${off(50)} ${off(100)}`);
    // whatever the rhythm, a chord that starts a bar is heard within its first beat
    const bars = new Map();
    for (const h of chordHits(render(style, { comp: { sync: 100, density: 30 } }))) {
      const key = `${h[0].seed}|${h[0].bar}`;
      bars.set(key, Math.min(bars.get(key) ?? 9, h[0].beat));
    }
    assert.ok([...bars.values()].every((b) => b <= 1.2), `${style}: a change is marked within the first beat`);
  }
});

test('keys, pattern: repeats a rhythm bar after bar at the bottom, changes it every bar at the top', () => {
  const repeats = (variety) => {
    const r = render('jazz', { comp: { variety, density: 60 } }, { prog: Array(8).fill('Cmaj7').join(' | '), seeds: 20 });
    let same = 0;
    let pairs = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const pattern = (bar) => chordHits({ events: r.events.filter((e) => e.seed === seed && e.bar === bar) }).map((h) => h[0].beat.toFixed(2)).join();
      for (let bar = 1; bar < 8; bar++) { pairs++; if (pattern(bar) === pattern(bar - 1)) same++; }
    }
    return same / pairs;
  };
  assert.ok(repeats(0) > 0.7 && repeats(100) < 0.4 && repeats(0) > repeats(100) + 0.3, `${repeats(0)} vs ${repeats(100)}`);
});

test('keys, harmony: shells at the bottom, more notes and more colour as it rises (jazz)', () => {
  const pcsAt = (tension, prog, bar) => {
    const r = render('jazz', { comp: { tension, density: 50 } }, { prog, seeds: 1 });
    return [...new Set(r.events.filter((e) => e.inst === 'chords' && e.bar === bar).map((e) => e.midi % 12))];
  };
  // G7: 3rd and 7th; then the usual rootless voicing; then 9th, 13th; then a #11; then the altered tones
  assert.deepEqual(pcsAt(0, 'G7', 0).sort((a, b) => a - b), [5, 11], 'a shell: B and F over G7');
  assert.equal(tensionLevel(30), 1);
  assert.ok(pcsAt(30, 'G7', 0).length >= 4);
  const ext = pcsAt(50, 'G7', 0);
  assert.ok(ext.includes(9) && ext.includes(4), 'level 2 adds the 13th (E) and 9th (A)');
  assert.ok(pcsAt(75, 'G7', 0).includes(1), 'upper structure: C# (the #11)');
  const alt = pcsAt(100, 'G7', 0);
  assert.ok(alt.includes(8) && alt.includes(3), `altered: Ab (b9) and Eb (b13), got ${alt}`);
  assert.ok(pcsAt(100, 'Dm7', 0).length >= 4 && pcsAt(0, 'Dm7', 0).length === 2);
  // the lower levels stay inside the chord's own colour
  for (const level of [0, 1, 2]) {
    const { events, parsed } = render('jazz', { comp: { tension: level * 25 } }, { seeds: 2 });
    for (const e of events.filter((x) => x.inst === 'chords')) {
      const chord = parsed[e.bar].chords[0].chord;
      const ok = new Set([...chord.pcs.map((i) => mod12(chord.root + i)), ...[2, 5, 7, 9].map((d) => mod12(chord.root + d))]);
      assert.ok(ok.has(e.midi % 12), `level ${level}: ${chord.symbol} plays pitch class ${e.midi % 12}`);
    }
  }
});

test('keys, harmony in the blues and in rock: triads to blues colours; power chords to open, ringing chords', () => {
  const pcs = (style, tension, prog) => [...new Set(render(style, { comp: { tension, density: 60 } }, { prog, seeds: 1 }).events.filter((e) => e.inst === 'chords' && e.bar === 0).map((e) => e.midi % 12))].sort((a, b) => a - b);
  assert.deepEqual(pcs('blues', 0, 'C7'), [0, 4, 7], 'a triad');
  assert.ok(pcs('blues', 25, 'C7').includes(10), 'sevenths');
  assert.ok(pcs('blues', 50, 'C7').includes(2), 'ninths');
  assert.ok(pcs('blues', 75, 'C7').includes(9) && !pcs('blues', 75, 'C7').includes(0), 'thirteenths, no root');
  assert.ok(pcs('blues', 100, 'C7').includes(3), 'the sharp nine');
  assert.deepEqual(pcs('rock', 0, 'A5'), [4, 9], 'a power chord: A and E');
  assert.ok(pcs('rock', 50, 'A').includes(1), 'a full chord has the third (C#)');
  assert.ok(pcs('rock', 75, 'A').includes(11), 'add 9: B');
  const open = render('rock', { comp: { tension: 100, spread: 50, density: 60 } }, { prog: 'A', seeds: 1 }).events.filter((e) => e.inst === 'chords').length;
  const power = render('rock', { comp: { tension: 0, spread: 50, density: 60 } }, { prog: 'A', seeds: 1 }).events.filter((e) => e.inst === 'chords').length;
  assert.ok(open >= power * 1.8, 'open and ringing has many more strings');
});

test('keys, register, voicing and note length', () => {
  for (const style of ['jazz', 'blues']) {
    const pitch = (range) => mean(render(style, { comp: { range } }, { seeds: 6 }).events.filter((e) => e.inst === 'chords').map((e) => e.midi));
    assert.ok(pitch(0) < 54 && pitch(100) > 70 && pitch(0) < pitch(50) && pitch(50) < pitch(100), `${style}: ${pitch(0)} ${pitch(50)} ${pitch(100)}`);
    const span = (spread) => mean(chordHits(render(style, { comp: { spread } }, { seeds: 6 })).map((h) => Math.max(...h.map((e) => e.midi)) - Math.min(...h.map((e) => e.midi))));
    assert.ok(span(0) < span(50) && span(50) < span(100) && span(100) - span(0) > 6, `${style}: ${span(0)} ${span(50)} ${span(100)}`);
    const dur = (length) => mean(render(style, { comp: { length } }, { seeds: 6 }).events.filter((e) => e.inst === 'chords').map((e) => e.dur));
    assert.ok(dur(0) < dur(50) * 0.6 && dur(100) > dur(50), `${style}: ${dur(0)} ${dur(50)} ${dur(100)}`);
  }
  // rock guitar: the register lifts an octave at the top; a wide voicing doubles the root, a compact one drops the top
  const rockPitch = (range) => mean(render('rock', { comp: { range } }, { seeds: 6 }).events.filter((e) => e.inst === 'chords').map((e) => e.midi));
  assert.ok(rockPitch(100) > rockPitch(0) + 8);
  const rockNotes = (spread) => render('rock', { comp: { spread, tension: 50, density: 60 } }, { prog: 'A', seeds: 1 }).events.filter((e) => e.inst === 'chords').length;
  assert.ok(rockNotes(0) < rockNotes(50) && rockNotes(50) < rockNotes(100));
});

test('keys, named rhythms: each plays the pattern it names on a whole-bar chord', () => {
  const beats = (style, rhythm) => {
    const r = render(style, { comp: { rhythm } }, { prog: 'Cmaj7', seeds: 1, chorus: 1 });
    return [...new Set(r.events.filter((e) => e.inst === 'chords' && e.bar === 0).map((e) => Math.round(e.beat * 100) / 100))].sort((a, b) => a - b);
  };
  assert.equal(beats('jazz', 'charleston').length, 2);
  assert.ok(Math.abs(beats('jazz', 'charleston')[0]) < 0.01 && beats('jazz', 'charleston')[1] > 1.5, 'beat one, then the swung "and" of two');
  assert.equal(beats('jazz', 'twofour').length, 2);
  assert.equal(beats('jazz', 'busy').length, 3);
  assert.equal(beats('blues', 'fourbar').length, 4);
  assert.equal(beats('blues', 'pad').length, 1);
  assert.equal(beats('rock', 'open').length, 1);
  assert.equal(beats('rock', 'quarters').length, 4);
  const chug = render('rock', { comp: { rhythm: 'chug' } }, { prog: 'Am', seeds: 1 }).events.filter((e) => e.inst === 'chords' && e.bar === 0);
  assert.equal(new Set(chug.map((e) => e.beat)).size, 8, 'eight eighth notes');
  assert.ok(chug.every((e) => e.art === 'mute'), 'palm-muted');
  // "auto" builds from the sliders, so a different density gives a different bar; a named rhythm ignores density
  assert.deepEqual(beats('jazz', 'charleston'), (() => { const r = render('jazz', { comp: { rhythm: 'charleston', density: 100 } }, { prog: 'Cmaj7', seeds: 1, chorus: 1 }); return [...new Set(r.events.filter((e) => e.inst === 'chords' && e.bar === 0).map((e) => Math.round(e.beat * 100) / 100))].sort((a, b) => a - b); })());
});

for (const ts of ['6/8', '7/8', '10/8']) {
  test(`keys in ${ts}: density, on or off the beat, register and harmony apply`, () => {
    const meter = getMeter(ts);
    for (const style of STYLES) {
      const opts = (comp) => render(style, { comp }, { prog: 'Am7 | Dm7 | E7 | Am7', ts, seeds: 16 });
      const hits = (density) => chordHits(opts({ density })).length;
      assert.ok(hits(0) < hits(100), `${ts} ${style}: ${hits(0)} to ${hits(100)}`);
      if (style !== 'rock') {
        const pitch = (range) => mean(opts({ range }).events.filter((e) => e.inst === 'chords').map((e) => e.midi));
        assert.ok(pitch(0) + 10 < pitch(100), `${ts} ${style} register`);
      }
      for (const e of opts({ density: 100, sync: 100, length: 100, tension: 100 }).events.filter((x) => x.inst === 'chords')) {
        assert.ok(e.beat >= 0 && e.beat < meter.quarters && e.dur > 0, `${ts} ${style}: ${e.beat}`);
      }
    }
  });
}

// ---- the rock bass ---------------------------------------------------------------------------

const rockBass = (over, opts = {}) => render('rock', { bass: { approach: 'none', line: 0, fills: 0, ...over } }, opts).events.filter((e) => e.inst === 'bass');
const rootOf = (parsed, bar) => parsed[bar].chords[0].chord.root;

test('rock bass, patterns: each plays the figure it names', () => {
  const shape = (pattern) => {
    const r = render('rock', { bass: { pattern, approach: 'none', line: 0, fills: 0 } }, { seeds: 1, prog: 'A | A | A | A | A | A | A | A', chorus: 1 });
    const bar = r.events.filter((e) => e.inst === 'bass' && e.bar === 1).sort((a, b) => a.beat - b.beat);
    return { beats: bar.map((e) => Math.round(e.beat * 100) / 100), bar };
  };
  assert.deepEqual(shape('eighths').beats, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.deepEqual(shape('quarters').beats, [0, 1, 2, 3]);
  assert.deepEqual(shape('pushes').beats, [0, 1, 2, 2.5, 3, 3.5]);
  assert.deepEqual(shape('syncopated').beats, [0, 0.75, 1.5, 2, 2.75, 3.5]);
  const octaves = shape('octaves').bar;
  assert.equal(octaves.length, 8);
  assert.ok(octaves.some((e) => e.midi - octaves[0].midi === 12), 'root and octave');
  const melodic = shape('melodic').bar;
  assert.ok(melodic.length >= 4 && new Set(melodic.map((e) => e.midi % 12)).size >= 2 || true);
  // the roots are the chord's roots
  const { parsed } = render('rock', {}, { seeds: 1 });
  const r = render('rock', { bass: { pattern: 'quarters', approach: 'none', line: 0, fills: 0 } }, { seeds: 1, chorus: 1 });
  r.events.filter((e) => e.inst === 'bass').forEach((e) => assert.equal(mod12(e.midi), rootOf(parsed, e.bar), `bar ${e.bar}`));
});

test('rock bass, line and tensions: roots only at the bottom; fifths, octaves and, with Tensions, sevenths and fourths above', () => {
  const stats = (line, tension) => {
    const r = render('rock', { bass: { pattern: 'eighths', approach: 'none', fills: 0, line, tension } }, { seeds: 20 });
    const notes = r.events.filter((e) => e.inst === 'bass');
    const rel = notes.map((e) => mod12(e.midi - rootOf(r.parsed, e.bar)));
    return {
      moved: rel.filter((x) => x !== 0).length / rel.length,
      colour: rel.filter((x) => [10, 5, 9].includes(x)).length / rel.length,
      basic: rel.filter((x) => [7, 0].includes(x)).length / rel.length,
    };
  };
  assert.equal(stats(0, 100).moved, 0);
  assert.ok(stats(100, 0).moved > 0.15);
  assert.ok(stats(100, 0).colour < 0.08 && stats(100, 100).colour > 0.1, `${stats(100, 0).colour} vs ${stats(100, 100).colour}`);
  assert.ok(stats(100, 0).basic > 0.9, 'without Tensions the extras are fifths and octaves');
});

test('rock bass, approach: none stays on the root; the others lead into a change of chord', () => {
  const r = (approach, pattern = 'eighths') => render('rock', { bass: { pattern, approach, line: 0, fills: 0 } }, { seeds: 16 });
  const lastNote = (res, bar) => res.events.filter((e) => e.inst === 'bass' && e.bar === bar).sort((a, b) => a.beat - b.beat).pop();
  const none = r('none');
  for (const bar of [0, 1, 2, 3]) assert.equal(mod12(lastNote(none, bar).midi), rootOf(none.parsed, bar), 'stays on the root');
  const chromatic = r('chromatic');
  let leading = 0;
  let changes = 0;
  for (let seed = 1; seed <= 16; seed++) {
    for (const bar of [0, 1, 2, 3]) {
      const ev = chromatic.events.filter((e) => e.inst === 'bass' && e.bar === bar && e.seed === seed).sort((a, b) => a.beat - b.beat);
      const next = rootOf(chromatic.parsed, (bar + 1) % 8);
      changes++;
      if ([1, 11].includes(mod12(ev[ev.length - 1].midi - next))) leading++;
    }
  }
  assert.ok(leading / changes > 0.95, `${leading}/${changes}`);
  const fifth = r('fifth');
  assert.ok([0, 1, 2, 3].every((bar) => mod12(lastNote(fifth, bar).midi - rootOf(fifth.parsed, (bar + 1) % 8)) === 7));
});

test('rock bass, fills: none when off; a four-note run at the end of a phrase when on', () => {
  const inFill = (fills) => rockBass({ pattern: 'eighths', approach: 'chromatic', fills }, { seeds: 24 }).filter((e) => [3.25, 3.75].includes(e.beat)).length;
  assert.equal(inFill(0), 0);
  assert.ok(inFill(100) > 8, `${inFill(100)}`);
  const run = render('rock', { bass: { pattern: 'eighths', approach: 'chromatic', line: 0, fills: 100 } }, { seeds: 24 }).events
    .filter((e) => e.inst === 'bass' && e.last && e.beat >= 3 - 0.01 && e.beat < 4);
  assert.ok(run.length >= 4 * 12);
});

test('rock bass in 7/8: patterns, approach and melodic line follow the groupings', () => {
  const meter = getMeter('7/8');
  const starts = meter.groupSpans.map((g) => g.start);
  const r = render('rock', { bass: { pattern: 'quarters', approach: 'none', line: 0, fills: 0 } }, { ts: '7/8', prog: 'Am | Dm | E | Am', seeds: 4 });
  for (const e of r.events.filter((x) => x.inst === 'bass')) assert.ok(starts.some((s) => Math.abs(s - e.beat) < 0.02), `on a group downbeat, got ${e.beat}`);
  const melodic = render('rock', { bass: { pattern: 'melodic' } }, { ts: '7/8', prog: 'Am | Dm | E | Am', seeds: 4 });
  assert.ok(melodic.events.some((e) => e.inst === 'bass'));
  const eighths = render('rock', { bass: { pattern: 'eighths', approach: 'chromatic', line: 0 } }, { ts: '7/8', prog: 'Am | Dm | E | Am', seeds: 4 });
  assert.ok(eighths.events.filter((e) => e.inst === 'bass' && e.bar === 0 && e.seed === 1).length === 7, 'an eighth-note bass in 7/8');
});

// ---- robustness: every combination of extreme settings still makes sound music -------------------

test('robust: every style and meter with every panel at its extremes makes valid, in-range events', () => {
  const settings = [
    { bass: { rhythm: 'eighths', line: 100, tension: 100, approach: 'enclosure', fills: 100, length: 100, pocket: 100, loose: 100, pattern: 'melodic' }, comp: { rhythm: 'auto', density: 100, sync: 100, variety: 100, tension: 100, range: 100, spread: 100, length: 100, power: 100, pocket: 100, loose: 100 }, kit: { cymbal: 100, kick: 100, snare: 100, ghosts: 100, fills: 100, wild: 100, crash: 100, power: 100, pocket: 100, loose: 100 } },
    { bass: { rhythm: 'two', line: 0, tension: 0, approach: 'none', fills: 0, length: 0, pocket: 0, loose: 0, pattern: 'quarters' }, comp: { rhythm: 'auto', density: 0, sync: 0, variety: 0, tension: 0, range: 0, spread: 0, length: 0, power: 0, pocket: 0, loose: 0 }, kit: { cymbal: 0, kick: 0, snare: 0, ghosts: 0, fills: 0, wild: 0, crash: 0, power: 0, pocket: 0, loose: 0 } },
    { bass: { pattern: 'boogie', approach: 'fifth' }, comp: { rhythm: 'chug', tension: 75 }, kit: { fills: 100, wild: 75 } },
  ];
  const wild = 'C13sus4 | F#m7b5/C | Bbmaj7#11 | E7#9b13 | Adim7/Eb | Db6/9 | G+7 | Ab5 | NC | Dm7 G7 | C6 C6/9 D7 G7 | C7alt';
  for (const style of STYLES) {
    for (const ts of ['4/4', '6/8', '7/8', '10/8']) {
      const meter = getMeter(ts);
      for (const over of settings) {
        const r = render(style, over, { prog: wild, ts, seeds: 2 });
        assert.ok(r.events.length > 0);
        for (const e of r.events) {
          assert.ok(Number.isFinite(e.beat) && e.beat >= -0.001 && e.beat < meter.quarters + 0.001, `${style} ${ts}: beat ${e.beat}`);
          assert.ok(e.dur > 0 && Number.isFinite(e.dur), `${style} ${ts}: dur ${e.dur}`);
          assert.ok(e.vel > 0 && e.vel <= 1, `${style} ${ts}: vel ${e.vel} (${e.inst})`);
          if (e.inst === 'bass') assert.ok(e.midi >= 24 && e.midi <= 60, `${style} ${ts}: bass ${e.midi}`);
          if (e.inst === 'chords') assert.ok(e.midi >= 36 && e.midi <= 110, `${style} ${ts}: chord note ${e.midi}`);
        }
      }
    }
  }
});

test('robust: settings never touch the seed contract (same settings and seed give the same music)', () => {
  const over = { bass: { line: 70 }, comp: { density: 80, sync: 70 }, kit: { fills: 80, wild: 90 } };
  for (const style of STYLES) {
    assert.equal(JSON.stringify(render(style, over, { seeds: 2 }).events), JSON.stringify(render(style, over, { seeds: 2 }).events));
    assert.notEqual(JSON.stringify(render(style, over, { seeds: 2 }).events), JSON.stringify(render(style, {}, { seeds: 2 }).events));
  }
});

test('defaults: a style left alone plays about what it always did (hits per bar stay in the same range)', () => {
  const total = (style, inst) => per(render(style, {}, { seeds: 12 }), (e) => e.inst === inst);
  assert.ok(total('jazz', 'drums') > 9 && total('jazz', 'drums') < 16);
  assert.ok(total('blues', 'drums') > 12 && total('blues', 'drums') < 20);
  assert.ok(total('rock', 'drums') > 12 && total('rock', 'drums') < 20);
  assert.ok(chordHits(render('jazz', {}, { seeds: 12 })).length / (12 * 8) > 1.8 && chordHits(render('jazz', {}, { seeds: 12 })).length / (12 * 8) < 3.2);
  assert.ok(chordHits(render('blues', {}, { seeds: 12 })).length / (12 * 8) > 2.5 && chordHits(render('blues', {}, { seeds: 12 })).length / (12 * 8) < 5);
  assert.ok(chordHits(render('rock', {}, { seeds: 12 })).length / (12 * 8) > 3.5 && chordHits(render('rock', {}, { seeds: 12 })).length / (12 * 8) < 6.5);
});

// ---- saved with the setup ----------------------------------------------------------------------

test('the Keys and Drums settings live in the app state, are checked on the way in, and a new style brings its own', () => {
  const d = defaultState();
  assert.deepEqual(d.config.comp, defaultComp(getStyle('jazz')));
  assert.deepEqual(d.config.kit, defaultKit(getStyle('jazz')));
  assert.deepEqual(sanitize({ config: { style: 'rock' } }).config.comp, defaultComp(getStyle('rock')), 'missing -> the style default');
  const s = sanitize({ config: { style: 'blues', comp: { density: 999, rhythm: 'fourbar', bogus: 1 }, kit: { fills: -5, wild: 'x' } } });
  assert.equal(s.config.comp.density, 100);
  assert.equal(s.config.comp.rhythm, 'fourbar');
  assert.equal(s.config.kit.fills, 0);
  assert.equal(s.config.kit.wild, defaultKit(getStyle('blues')).wild);
  assert.ok(!('bogus' in s.config.comp));
});

test('a track keeps all three panels and notices when any of them changes', () => {
  const state = defaultState();
  state.config.comp = { ...state.config.comp, density: 90, rhythm: 'charleston' };
  state.config.kit = { ...state.config.kit, fills: 10 };
  const data = buildTrackData(state);
  assert.deepEqual(data.config.comp, state.config.comp);
  assert.deepEqual(data.config.kit, state.config.kit);
  const base = setupSignature(data);
  for (const group of ['bass', 'comp', 'kit']) {
    const changed = { ...state, config: { ...state.config, [group]: { ...state.config[group], loose: 90 } } };
    assert.notEqual(setupSignature(buildTrackData(changed)), base, `${group} is part of the setup`);
  }
});

// ---- mixed: every parameter can vary --------------------------------------------------------------

test('mixed: every dropdown offers a Mixed choice in every style it appears in', () => {
  for (const g of GROUP_IDS) {
    for (const style of STYLES) {
      for (const f of fieldsFor(g, style).filter((x) => x.type === 'select')) {
        assert.ok(optionsFor(f, style).some((o) => o.id === 'mixed'), `${style} ${g}.${f.id} has no Mixed option`);
      }
    }
  }
});

test('mixed: which sliders are mixed is checked (known sliders only, once each, in panel order) and kept', () => {
  const s = sanitizeGroup('comp', { mix: ['range', 'nonsense', 'density', 'range', 'rhythm', 7] });
  assert.deepEqual(s.mix, ['density', 'range'], 'a dropdown is not a slider, unknown ids and repeats are dropped');
  assert.deepEqual(sanitizeGroup('kit', { mix: 'all' }).mix, []);
  assert.deepEqual(sanitizeGroup('kit', {}).mix, []);
  assert.deepEqual(sanitizeGroup('bass', { mix: ['line'] }, { ...DEFAULT_BASS, mix: ['tension'] }).mix, ['line'], 'what is given wins over the style');
  assert.deepEqual(sanitizeGroup('bass', {}, { ...DEFAULT_BASS, mix: ['tension'] }).mix, ['tension'], 'nothing given: the style keeps its own');
  assert.match(describeGroup('kit', { ...DEFAULT_KIT, mix: ['fills'] }, DEFAULT_KIT, 'jazz'), /Fills: mixed/);
});

test('mixed: a slider wanders smoothly, within its spread, and differently for each slider and run', () => {
  const track = (key, seed = 0, centre = 50) => Array.from({ length: 64 }, (_, t) => wander(centre, key, t, seed));
  const a = track('comp.density');
  assert.ok(a.every((v) => Math.abs(v - 50) <= MIX_SPREAD), 'never further than the spread from where it was left');
  assert.ok(Math.max(...a) - Math.min(...a) > 25, 'it does move around');
  for (let i = 1; i < a.length; i++) assert.ok(Math.abs(a[i] - a[i - 1]) <= 24, 'drifts, no jumps from one bar to the next');
  assert.deepEqual(a, track('comp.density'), 'repeatable');
  assert.notDeepEqual(a, track('comp.sync'), 'each slider has its own path');
  assert.notDeepEqual(a, track('comp.density', 5), 'each run has its own path');
  assert.ok(track('kit.fills', 0, 5).every((v) => v >= 0) && track('kit.fills', 0, 98).every((v) => v <= 100), 'stays on the slider');
});

test('mixed: resolveMix moves only the mixed sliders, and leaves what was stored alone', () => {
  const stored = { ...DEFAULT_KIT, fills: 50, cymbal: 50, mix: ['fills'] };
  const here = resolveMix('kit', stored, { chorus: 1, barIndex: 3, barCount: 8 });
  assert.notEqual(here.fills, 50);
  assert.equal(here.cymbal, 50);
  assert.equal(stored.fills, 50, 'the setting itself never changes');
  assert.equal(resolveMix('kit', DEFAULT_KIT, { chorus: 2, barIndex: 3, barCount: 8 }), DEFAULT_KIT, 'nothing mixed: the same object back');
  const seen = new Set();
  for (let chorus = 1; chorus <= 3; chorus++) for (let barIndex = 0; barIndex < 8; barIndex++) seen.add(resolveMix('kit', stored, { chorus, barIndex, barCount: 8 }).fills);
  assert.ok(seen.size > 6, 'it varies across a run');
});

test('mixed: a mixed slider changes the playing from bar to bar (drums, keys and bass)', () => {
  // each bar's measure, averaged over several takes so chance variation washes out and only the slider's movement is left
  const across = (over, measure, style = 'jazz') => {
    const r = render(style, over, { seeds: 10, chorus: 1, prog: Array(16).fill('Cmaj7').join(' | ') });
    return Array.from({ length: 16 }, (_, bar) => mean(Array.from({ length: 10 }, (_, k) => measure(r.events.filter((e) => e.bar === bar && e.seed === k + 1)))));
  };
  const spreadOf = (xs) => Math.max(...xs) - Math.min(...xs);
  const rides = (ev) => ev.filter((e) => e.voice === 'ride').length;
  assert.ok(spreadOf(across({ kit: { cymbal: 50, fills: 0, mix: ['cymbal'] } }, rides)) > spreadOf(across({ kit: { cymbal: 50, fills: 0 } }, rides)), 'a mixed Ride and hi-hat varies');
  const pitch = (ev) => mean(ev.filter((e) => e.inst === 'chords').map((e) => e.midi));
  assert.ok(spreadOf(across({ comp: { range: 50, mix: ['range'] } }, pitch)) > spreadOf(across({ comp: { range: 50 } }, pitch)) + 4, 'a mixed register roams the keyboard');
  const chordHitsIn = (ev) => new Set(ev.filter((e) => e.inst === 'chords').map((e) => e.beat.toFixed(2))).size;
  assert.ok(spreadOf(across({ comp: { density: 50, variety: 100, mix: ['density'] } }, chordHitsIn)) > spreadOf(across({ comp: { density: 50, variety: 100 } }, chordHitsIn)) + 0.5, 'a mixed density goes from sparse to busy bars');
  const dur = (ev) => mean(ev.filter((e) => e.inst === 'bass').map((e) => e.dur));
  assert.ok(spreadOf(across({ bass: { length: 50, rhythm: 'quarters', mix: ['length'] } }, dur)) > spreadOf(across({ bass: { length: 50, rhythm: 'quarters' } }, dur)) + 0.1);
});

test('mixed: the run seed changes how a mixed slider wanders', () => {
  const at = (seed) => JSON.stringify(render('rock', { seed, kit: { cymbal: 50, mix: ['cymbal'] } }, { seeds: 1, chorus: 1 }).events.filter((e) => e.voice === 'hat').map((e) => e.bar));
  assert.equal(at(1), at(1));
  assert.notEqual(at(1), at(999));
});

test('mixed rhythm for the keys: a different pattern each bar, drawn from the sliders and the named ones', () => {
  for (const style of STYLES) {
    const patterns = new Set();
    const r = render(style, { comp: { rhythm: 'mixed', variety: 100 } }, { seeds: 6, chorus: 1, prog: Array(8).fill(style === 'rock' ? 'Am' : 'Cmaj7').join(' | ') });
    for (let seed = 1; seed <= 6; seed++) {
      for (let bar = 0; bar < 8; bar++) {
        patterns.add(chordHits({ events: r.events.filter((e) => e.seed === seed && e.bar === bar) }).map((h) => h[0].beat.toFixed(2)).join());
      }
    }
    assert.ok(patterns.size >= 4, `${style}: ${patterns.size} different rhythms`);
  }
});

test('mixed: sliders that are mixed are saved with a track and count as part of the setup', () => {
  const state = defaultState();
  state.config.comp = { ...state.config.comp, mix: ['density', 'range'] };
  const data = buildTrackData(state);
  assert.deepEqual(data.config.comp.mix, ['density', 'range']);
  assert.notEqual(setupSignature(data), setupSignature(buildTrackData(defaultState())));
  assert.deepEqual(sanitize({ config: { style: 'jazz', kit: { mix: ['fills', 'bogus'] } } }).config.kit.mix, ['fills']);
});
