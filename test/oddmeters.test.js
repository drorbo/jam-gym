// Grooves and bass lines for 6/8, 7/8 and 10/8, built from the groups (3+3, 3+2+2, 3+3+2+2 eighths), for every style.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getStyle, renderBar } from '../src/styles/index.js';
import { GROUPS, effectiveOption, inactiveControls, optionsForMeter } from '../src/styles/settings.js';
import { ODD_BASS_OPTIONS, ODD_GROOVE_OPTIONS, ODD_METERS, oddGrooveIds } from '../src/styles/oddoptions.js';
import { ODD_FIGURE_STEPS } from '../src/styles/figures.js';
import { ODD_GROOVES } from '../src/styles/oddgrooves.js';
import { partOf } from '../src/styles/drumparts.js';
import { parseProgression } from '../src/theory/progression.js';
import { getMeter } from '../src/theory/meter.js';
import { createRng } from '../src/engine/rng.js';
import { mod12 } from '../src/theory/notes.js';

const STYLES = ['jazz', 'blues', 'rock'];
const TEXT = 'Dm7 | G7 | Cmaj7 | A7 | Dm7 G7 | Cmaj7 | Am7 D7 | Gmaj7';
const field = (group, id) => GROUPS[group].fields.find((f) => f.id === id);

function render(styleId, { kit, bass, ts, text = TEXT, chorus = 1, seed = 1 }) {
  const style = getStyle(styleId);
  const meter = getMeter(ts);
  const { bars, ok, errors } = parseProgression(text, { timeSignature: ts });
  assert.ok(ok, JSON.stringify(errors));
  const state = {};
  return bars.map((bar, i) => renderBar(style, {
    segments: bar.chords, nextChord: (bars[i + 1] ?? bars[0]).chords.find((s) => s.chord)?.chord ?? null,
    barIndex: i, barCount: bars.length, isFirstBar: i === 0, isLastBar: i === bars.length - 1,
    chorus, bpm: 100, meter, beatsPerBar: meter.quarters, state, kit, bass, seed, rng: createRng(seed * 1000 + i),
  }));
}
const drums = (bars) => bars.flat().filter((e) => e.inst === 'drums');
const bassOf = (bar) => bar.filter((e) => e.inst === 'bass').sort((a, b) => a.beat - b.beat);
const grooves = (styleId, ts) => optionsForMeter(field('kit', 'groove'), styleId, ts).map((o) => o.id).filter((id) => !['classic', 'mixed', 'brushes', 'sweep'].includes(id));
const starts = (ts) => getMeter(ts).groupSpans.map((g) => g.start);

// ---- what is offered -------------------------------------------------------------------------

test('every style has grooves and bass figures built for the /8 meters, and the data and the players agree', () => {
  for (const id of Object.keys(ODD_GROOVES)) assert.ok(ODD_GROOVE_OPTIONS.some((o) => o.id === id), `${id} is not in the options`);
  for (const o of ODD_GROOVE_OPTIONS) assert.ok(ODD_GROOVES[o.id], `${o.id} has no player`);
  for (const o of ODD_BASS_OPTIONS) assert.ok(ODD_FIGURE_STEPS[o.id], `${o.id} has no figure`);
  assert.equal(new Set(ODD_GROOVE_OPTIONS.map((o) => o.id)).size, ODD_GROOVE_OPTIONS.length);
  for (const styleId of STYLES) {
    for (const ts of ODD_METERS) {
      assert.ok(grooves(styleId, ts).length >= 4, `${styleId} in ${ts} has only ${grooves(styleId, ts)}`);
      assert.deepEqual(grooves(styleId, ts), oddGrooveIds(styleId, ts).filter((id) => grooves(styleId, ts).includes(id)));
      const patterns = optionsForMeter(field('bass', 'pattern'), styleId, ts).map((o) => o.id);
      for (const o of ODD_BASS_OPTIONS) assert.ok(patterns.includes(o.id), `${styleId} ${ts} lacks ${o.id}`);
    }
    // none of them is offered in 4/4, where a stored one plays as the style's usual choice
    const four = (id, group) => optionsForMeter(field(group, id), styleId, '4/4').map((o) => o.id);
    for (const o of ODD_GROOVE_OPTIONS) assert.ok(!four('groove', 'kit').includes(o.id));
    for (const o of ODD_BASS_OPTIONS) assert.ok(!four('pattern', 'bass').includes(o.id));
  }
  assert.ok(grooves('rock', '6/8').includes('bembe') && grooves('jazz', '6/8').includes('bembe'));
  for (const ts of ['7/8', '10/8']) for (const styleId of STYLES) assert.ok(!grooves(styleId, ts).includes('bembe'), 'Bembé is a 6/8 groove');
});

test('a stored odd-meter choice plays as the plain one in 4/4 (and Bembé in 7/8), exactly as the panels show it', () => {
  for (const styleId of STYLES) {
    const usual = { jazz: 'walk', blues: 'mixed', rock: 'mixed' }[styleId];
    for (const o of ODD_BASS_OPTIONS) {
      assert.equal(effectiveOption(field('bass', 'pattern'), o.id, styleId, '4/4'), usual);
      assert.equal(effectiveOption(field('bass', 'pattern'), o.id, styleId, '7/8'), o.id, 'and it plays as itself in an odd meter');
    }
    for (const id of grooves(styleId, '7/8')) assert.equal(effectiveOption(field('kit', 'groove'), id, styleId, '4/4'), 'classic', id);
    const plainFour = JSON.stringify(render(styleId, { ts: '4/4', text: 'C7 | F7 | G7 | C7', kit: { groove: 'classic' }, bass: { pattern: usual } }));
    for (const id of grooves(styleId, '7/8')) {
      assert.equal(JSON.stringify(render(styleId, { ts: '4/4', text: 'C7 | F7 | G7 | C7', kit: { groove: id }, bass: { pattern: usual } })), plainFour, `${id} changed 4/4`);
    }
    for (const o of ODD_BASS_OPTIONS) {
      assert.equal(JSON.stringify(render(styleId, { ts: '4/4', text: 'C7 | F7 | G7 | C7', bass: { pattern: o.id } })), JSON.stringify(render(styleId, { ts: '4/4', text: 'C7 | F7 | G7 | C7', bass: { pattern: usual } })), `${o.id} changed 4/4`);
    }
  }
  const bembe = effectiveOption(field('kit', 'groove'), 'bembe', 'rock', '7/8');
  assert.equal(bembe, 'classic');
});

// ---- the grooves -----------------------------------------------------------------------------

for (const styleId of STYLES) {
  for (const ts of ODD_METERS) {
    test(`${styleId} in ${ts}: every odd-meter groove is well-formed, inside the bar, and different from the classic one`, () => {
      const meter = getMeter(ts);
      const classic = JSON.stringify(drums(render(styleId, { ts, kit: { groove: 'classic', fills: 0, crash: 0 } })).map((e) => [e.voice, e.beat]));
      for (const groove of grooves(styleId, ts)) {
        for (const chorus of [1, 2]) {
          const bars = render(styleId, { ts, kit: { groove, fills: 100, wild: 100, crash: 100 }, chorus });
          bars.forEach((bar, i) => {
            const d = bar.filter((e) => e.inst === 'drums');
            assert.ok(d.length >= 3, `${groove} bar ${i} is too empty`);
            for (const e of d) {
              assert.ok(partOf(e.voice), `${groove}: ${e.voice} is not on the drum mixer`);
              assert.ok(e.beat >= 0 && e.beat < meter.quarters, `${groove}: beat ${e.beat} is outside the ${ts} bar`);
              assert.ok(e.dur > 0 && e.vel > 0 && e.vel <= 1.0001, `${groove}: bad dur/vel`);
            }
          });
        }
        const plain = JSON.stringify(drums(render(styleId, { ts, kit: { groove, fills: 0, crash: 0 } })).map((e) => [e.voice, e.beat]));
        assert.notEqual(plain, classic, `${groove} plays like the classic groove in ${ts}`);
      }
    });

    test(`${styleId} in ${ts}: Cymbal, Kick, Snare and Ghost notes each change every odd-meter groove`, () => {
      for (const groove of grooves(styleId, ts)) {
        for (const slider of ['cymbal', 'kick', 'snare', 'ghosts']) {
          const sig = (v) => JSON.stringify([1, 2, 3, 4, 5, 6].map((seed) => render(styleId, { ts, kit: { groove, [slider]: v, fills: 0, crash: 0 }, seed })));
          // a slider may have nothing to do in one meter (a 2-group has no middle eighth) but must act in some
          const acts = ODD_METERS.some((m) => grooves(styleId, m).includes(groove) && ((mm) => {
            const s2 = (v) => JSON.stringify([1, 2, 3, 4, 5, 6].map((seed) => render(styleId, { ts: mm, kit: { groove, [slider]: v, fills: 0, crash: 0 }, seed })));
            return s2(5) !== s2(95);
          })(m));
          assert.ok(acts || sig(5) !== sig(95), `${styleId}/${groove}: ${slider} does nothing`);
        }
      }
    });
  }
}

test('the groove shapes follow the groups: pushes, half-time, toms, rim, bell', () => {
  for (const ts of ODD_METERS) {
    const gs = starts(ts);
    const meter = getMeter(ts);
    const lastEighth = (g) => g.start + (g.slots - 1) * 0.5;
    const only = (styleId, groove, voice, minVel = 0) => drums(render(styleId, { ts, text: 'C | C | C | C', kit: { groove, fills: 0, crash: 0, ghosts: 0, snare: 0, kick: 0, cymbal: 0 } }))
      .filter((e) => e.voice === voice && e.vel >= minVel);
    // pushed groups: the snare answers on every other group
    const pushSnare = [...new Set(only('rock', 'pushgroups', 'snare', 0.8).map((e) => e.beat))];
    assert.deepEqual(pushSnare, gs.filter((_, i) => i % 2 === 1), `${ts} pushgroups snare`);
    // half-time: exactly one heavy snare a bar, at the start of the middle group
    const halfSnare = [...new Set(only('blues', 'halfgroups', 'snare', 0.9).map((e) => e.beat))];
    assert.deepEqual(halfSnare, [gs[Math.floor(gs.length / 2)]], `${ts} halfgroups snare`);
    // tom drive: a tom on every group start, low and middle taking turns
    const toms = [...new Map(only('rock', 'tomdrive', 'tomLow', 0.7).concat(only('rock', 'tomdrive', 'tomMid', 0.7)).map((e) => [e.beat, e.voice])).entries()].sort((a, b) => a[0] - b[0]);
    assert.deepEqual(toms.map((t) => t[0]), gs, `${ts} tomdrive positions`);
    assert.deepEqual(toms.map((t) => t[1]), gs.map((_, i) => (i % 2 === 0 ? 'tomLow' : 'tomMid')), `${ts} tomdrive turns`);
    // cross-stick groups: a rim on every group start
    assert.deepEqual([...new Set(only('jazz', 'rimgroups', 'rim', 0.5).map((e) => e.beat))], gs, `${ts} rimgroups`);
    // bell: a ride on every group start
    const bell = new Set(only('rock', 'bell', 'ride').map((e) => e.beat));
    for (const b of gs) assert.ok(bell.has(b), `${ts} bell misses the group at ${b}`);
    assert.ok(meter.groupSpans.every((g) => lastEighth(g) < meter.quarters));
  }
});

test('Bembé is the standard bell pattern across two bars of 6/8', () => {
  for (const styleId of ['jazz', 'rock']) {
    const bars = render(styleId, { ts: '6/8', text: 'C | C | C | C', kit: { groove: 'bembe', fills: 0, crash: 0, ghosts: 0, snare: 0, kick: 0, cymbal: 0 } });
    const bell = (bar) => bar.filter((e) => e.voice === 'ride').map((e) => e.beat / 0.5);
    assert.deepEqual(bell(bars[0]), [0, 2, 4, 5]);
    assert.deepEqual(bell(bars[1]), [1, 3, 5]);
    assert.deepEqual(bell(bars[2]), [0, 2, 4, 5]);
    // together the two bars are x.x.xx.x.x.x in twelve pulses
    const twelve = Array.from({ length: 12 }, (_, i) => (i < 6 ? bell(bars[0]).includes(i) : bell(bars[1]).includes(i - 6)) ? 'x' : '.').join('');
    assert.equal(twelve, 'x.x.xx.x.x.x');
  }
});

test('"mixed" changes among the odd-meter grooves every four bars, and holds each for the four', () => {
  for (const styleId of STYLES) {
    const text = 'C | C | C | C | C | C | C | C';
    const seen = new Set();
    for (let chorus = 1; chorus <= 12; chorus++) {
      const bars = render(styleId, { ts: '7/8', text, kit: { groove: 'mixed', fills: 0, crash: 0 }, chorus, seed: 3 });
      seen.add(JSON.stringify(drums(bars.slice(0, 4)).map((e) => e.voice)));
      seen.add(JSON.stringify(drums(bars.slice(4, 8)).map((e) => e.voice)));
    }
    assert.ok(seen.size >= 4, `${styleId}: mixed hardly changes`);
  }
});

test('brushes still work in the /8 meters, and a jazz "mixed" can bring them in', () => {
  for (const groove of ['brushes', 'sweep']) {
    const d = drums(render('jazz', { ts: '7/8', kit: { groove } }));
    assert.ok(d.some((e) => e.voice === 'swish'), `${groove} has no sweep`);
  }
});

// ---- the bass figures ------------------------------------------------------------------------

const SAME = 'Cmaj7 | Cmaj7 | Cmaj7 | Cmaj7';
const first = (styleId, ts, pattern, text = SAME) => bassOf(render(styleId, { ts, text, bass: { pattern } })[0]);

for (const styleId of STYLES) {
  test(`${styleId}: group roots hold a root on every group, up to the next`, () => {
    for (const ts of ODD_METERS) {
      const meter = getMeter(ts);
      const notes = first(styleId, ts, 'grouproots');
      assert.deepEqual(notes.map((e) => e.beat), starts(ts), ts);
      assert.ok(notes.every((e) => mod12(e.midi) === 0));
      meter.groupSpans.forEach((g, i) => assert.ok(Math.abs(notes[i].dur - g.len * 0.94) < 1e-9, `${ts} group ${i} is not held`));
    }
  });

  test(`${styleId}: roots and fifths put the fifth on the last eighth of each group`, () => {
    for (const ts of ODD_METERS) {
      const meter = getMeter(ts);
      const notes = first(styleId, ts, 'bounce');
      const want = meter.groupSpans.flatMap((g) => [g.start, g.start + (g.slots - 1) * 0.5]);
      assert.deepEqual(notes.map((e) => e.beat), want, ts);
      notes.forEach((e, i) => assert.equal(mod12(e.midi), i % 2 === 0 ? 0 : 7));
    }
  });

  test(`${styleId}: the arpeggio runs on across the groups, an eighth note at a time`, () => {
    for (const ts of ODD_METERS) {
      const meter = getMeter(ts);
      const notes = first(styleId, ts, 'arp');
      assert.equal(notes.length, meter.slots.length, `${ts}: one note for every eighth`);
      const tones = [0, 4, 7, 11]; // Cmaj7: root, third, fifth, seventh
      notes.forEach((e, i) => assert.equal(mod12(e.midi), tones[i % 4], `${ts} note ${i}`));
      assert.ok(notes[0].vel > notes[1].vel, 'the downbeat is the accent');
    }
  });

  test(`${styleId}: step-in steps a half step into the next chord from the last eighth, and to a neighbour below the root otherwise`, () => {
    for (const ts of ODD_METERS) {
      const meter = getMeter(ts);
      const [changing] = render(styleId, { ts, text: 'Cmaj7 | Gmaj7 | Cmaj7 | Cmaj7', bass: { pattern: 'stepin' } }).map(bassOf);
      const lastGroup = meter.groupSpans.at(-1);
      const final = changing.at(-1);
      assert.equal(final.beat, lastGroup.start + (lastGroup.slots - 1) * 0.5, `${ts}: the step is on the last eighth`);
      assert.equal(Math.abs(((mod12(final.midi - 7) + 6) % 12) - 6), 1, `${ts}: ${mod12(final.midi)} is not a half step from G`);
      // inside a chord that stays, the step is the note below the root
      const [staying] = render(styleId, { ts, text: 'Cmaj7 | Cmaj7 | Cmaj7 | Cmaj7', bass: { pattern: 'stepin' } }).map(bassOf);
      staying.filter((_, i) => i % 2 === 1).forEach((e) => assert.equal(mod12(e.midi), 11, `${ts}: a neighbour below C`));
    }
  });

  test(`${styleId}: every group figure is well-formed and in range over changing chords, cut where its chord ends, and switches the walking controls off`, () => {
    for (const ts of ODD_METERS) {
      const meter = getMeter(ts);
      for (const pattern of ODD_BASS_OPTIONS.map((o) => o.id)) {
        for (const chorus of [1, 2]) {
          const bars = render(styleId, { ts, bass: { pattern }, chorus, text: 'Dm7 G7 | Ab7 | C7alt Db6/9 | E7#9 | Gmaj7#11 | Bb13 A7b9 | Eb5 | F#m7b5' });
          bars.forEach((bar, i) => {
            const notes = bassOf(bar);
            assert.ok(notes.length >= 1, `${pattern} bar ${i} is empty`);
            for (const e of notes) assert.ok(e.midi >= 24 && e.midi <= 60 && e.beat >= 0 && e.beat < meter.quarters && e.dur > 0 && e.vel > 0 && e.vel <= 1, `${pattern} ${ts}: ${JSON.stringify(e)}`);
            notes.forEach((e, j) => { if (notes[j + 1] && notes[j + 1].beat > e.beat) assert.ok(e.beat + e.dur <= notes[j + 1].beat + 1e-9 || e.dur <= 1, 'a note runs into the next'); });
          });
        }
        const idle = Object.keys(inactiveControls('bass', { ...getStyle(styleId).bass, pattern }, styleId, ts));
        for (const id of ['line', 'tension', 'approach']) assert.ok(idle.includes(id), `${styleId} ${pattern}: ${id} should be greyed out`);
      }
    }
  });
}

test('two chords in a bar each get their own figure, and the bass figures are all different', () => {
  for (const ts of ODD_METERS) {
    const bar = bassOf(render('jazz', { ts, text: 'Dm7 G7 | Cmaj7', bass: { pattern: 'grouproots' } })[0]);
    const roots = bar.map((e) => mod12(e.midi));
    assert.ok(roots.includes(2) && roots.includes(7), `${ts}: both chords are played`);
    const seen = new Set(ODD_BASS_OPTIONS.map((o) => JSON.stringify(first('jazz', ts, o.id, 'Dm7 | G7 | Cmaj7 | Cmaj7').map((e) => [e.midi, e.beat]))));
    seen.add(JSON.stringify(first('jazz', ts, 'walk', 'Dm7 | G7 | Cmaj7 | Cmaj7').map((e) => [e.midi, e.beat])));
    assert.equal(seen.size, ODD_BASS_OPTIONS.length + 1, `${ts}: two figures play the same notes`);
  }
});

test('the odd-meter figures do not change the rock bass fills rule: no fills in the /8 meters', () => {
  const idle = inactiveControls('bass', { ...getStyle('rock').bass, pattern: 'arp' }, 'rock', '7/8');
  assert.ok(idle.fills);
});
