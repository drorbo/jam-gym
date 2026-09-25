import test from 'node:test';
import assert from 'node:assert/strict';
import { getStyle, renderBar, defaultKit, defaultBass } from '../src/styles/index.js';
import { GROOVES, GROUPS, PATTERNS, optionsFor, optionsForMeter, grooveSwing, sanitizeKit, sanitizeBass, fieldsFor, inactiveControls } from '../src/styles/settings.js';
import { parseProgression } from '../src/theory/progression.js';
import { getMeter } from '../src/theory/meter.js';
import { createRng } from '../src/engine/rng.js';

const PROG = 'C7 | F7 | C7 | G7 | Cm7 F7 | Bb13 A7#9 | Dm7 G7 | C7alt';
const DRUM_VOICES = new Set(['kick', 'snare', 'hat', 'hatOpen', 'hatPedal', 'ride', 'crash', 'tomHigh', 'tomMid', 'tomLow']);

function render(styleId, { kit, bass, swing, ts = '4/4', text = PROG, chorus = 1, seed = 1 } = {}) {
  const style = getStyle(styleId);
  const meter = getMeter(ts);
  const { bars, ok } = parseProgression(text, { timeSignature: ts });
  assert.ok(ok);
  const state = {};
  return bars.map((bar, i) => renderBar(style, {
    segments: bar.chords, nextChord: (bars[i + 1] ?? bars[0]).chords.find((s) => s.chord)?.chord ?? null,
    barIndex: i, barCount: bars.length, isFirstBar: i === 0, isLastBar: i === bars.length - 1,
    chorus, bpm: 100, meter, beatsPerBar: meter.quarters, state, kit, bass, swing, seed, rng: createRng(seed * 1000 + i),
  }));
}

const signature = (bars) => JSON.stringify(bars.map((b) => b.filter((e) => e.inst === 'drums').map((e) => [e.voice, +e.beat.toFixed(3)])));

for (const styleId of ['blues', 'rock']) {
  const ids = optionsForMeter({ options: GROOVES }, styleId, '4/4').map((o) => o.id); // the 4/4 grooves

  test(`${styleId}: every drum groove is well-formed, inside the bar, and different from the classic one`, () => {
    const classic = signature(render(styleId, { kit: { groove: 'classic' } }));
    for (const groove of ids.filter((id) => id !== 'classic')) {
      for (const chorus of [1, 2]) {
        const bars = render(styleId, { kit: { groove }, chorus });
        bars.forEach((events, i) => {
          const drums = events.filter((e) => e.inst === 'drums');
          assert.ok(drums.length >= 3, `${groove} bar ${i} is too empty`);
          for (const e of drums) {
            assert.ok(DRUM_VOICES.has(e.voice), `${groove}: unknown voice ${e.voice}`);
            assert.ok(e.beat >= 0 && e.beat < 4, `${groove}: beat ${e.beat} outside the bar`);
            assert.ok(e.dur > 0 && e.vel > 0 && e.vel <= 1.0001, `${groove}: bad dur/vel ${e.dur}/${e.vel}`);
          }
        });
      }
      if (groove !== 'mixed') assert.notEqual(signature(render(styleId, { kit: { groove } })), classic, `${groove} plays like the classic groove`);
    }
  });

  test(`${styleId}: every groove works at the extremes of every drum slider`, () => {
    for (const groove of ids) {
      for (const v of [0, 100]) {
        const kit = { groove, cymbal: v, kick: v, snare: v, ghosts: v, fills: v, wild: v, crash: v };
        for (const seed of [1, 2, 3]) {
          for (const events of render(styleId, { kit, seed })) {
            for (const e of events) assert.ok(Number.isFinite(e.beat) && Number.isFinite(e.vel), `${groove}/${v}`);
          }
        }
      }
    }
  });

  test(`${styleId}: "mixed" uses several grooves, holding each for four bars`, () => {
    const differentBlocks = new Set();
    for (let chorus = 1; chorus <= 12; chorus++) differentBlocks.add(signature(render(styleId, { kit: { groove: 'mixed' }, chorus, seed: 4 }).slice(0, 1)));
    assert.ok(differentBlocks.size > 1, 'mixed never changes groove');
  });

  test(`${styleId}: the default groove is the classic one, and a groove the style does not have plays the classic`, () => {
    assert.equal(defaultKit(getStyle(styleId)).groove, 'classic');
    const other = styleId === 'blues' ? 'fourfloor' : 'purdie';
    assert.equal(signature(render(styleId, { kit: { groove: other } })), signature(render(styleId, { kit: { groove: 'classic' } })));
  });

  test(`${styleId}: grooves apply in 4/4 only; the other meters still play under any groove setting`, () => {
    for (const ts of ['6/8', '7/8', '10/8']) {
      const text = ts === '6/8' ? 'C7 | F7 | G7' : 'C7 | F7 | G7 | C7';
      const bars = render(styleId, { kit: { groove: ids.at(-2) }, ts, text });
      bars.forEach((events) => assert.ok(events.some((e) => e.inst === 'drums')));
    }
  });
}

test('every style offers grooves, and stored settings keep or repair them', () => {
  assert.deepEqual(optionsForMeter({ options: GROOVES }, 'jazz', '4/4').map((o) => o.id), ['classic', 'brushes', 'sweep', 'bossa', 'afro', 'straightride', 'jazzfunk', 'latinballad', 'mixed']);
  assert.ok(fieldsFor('kit', 'blues').some((f) => f.id === 'groove'));
  assert.equal(sanitizeKit({ groove: 'purdie' }).groove, 'purdie');
  assert.equal(sanitizeKit({ groove: 'polka' }).groove, 'classic');
});

// ---- bass patterns ---------------------------------------------------------------------------

for (const styleId of ['blues', 'rock']) {
  const patterns = optionsForMeter({ options: PATTERNS }, styleId, '4/4').map((p) => p.id); // the 4/4 patterns

  test(`${styleId}: every bass pattern makes in-range notes inside the bar`, () => {
    for (const pattern of patterns) {
      for (const chorus of [1, 2]) {
        const bars = render(styleId, { bass: { pattern }, chorus, seed: chorus });
        bars.forEach((events, i) => {
          const notes = events.filter((e) => e.inst === 'bass');
          assert.ok(notes.length > 0, `${pattern} bar ${i} has no bass`);
          for (const n of notes) {
            assert.ok(n.midi >= 24 && n.midi <= 60, `${pattern}: ${n.midi} out of range`);
            assert.ok(n.beat >= 0 && n.beat < 4 && n.dur > 0, `${pattern}: bad note position`);
          }
        });
      }
    }
  });

  test(`${styleId}: the bass patterns are not all the same`, () => {
    const sigs = new Set(patterns.map((pattern) => JSON.stringify(render(styleId, { bass: { pattern } })[0].filter((e) => e.inst === 'bass').map((e) => [e.midi, +e.beat.toFixed(2)]))));
    assert.ok(sigs.size >= patterns.length - 2, `only ${sigs.size} distinct patterns out of ${patterns.length}`);
  });

  test(`${styleId}: bass patterns still play in 6/8, 7/8 and 10/8`, () => {
    for (const ts of ['6/8', '7/8', '10/8']) {
      for (const pattern of patterns) {
        const bars = render(styleId, { bass: { pattern }, ts, text: 'C7 | F7 | G7 | C7' });
        bars.forEach((events) => assert.ok(events.some((e) => e.inst === 'bass'), `${pattern} in ${ts}`));
      }
    }
  });
}

test('blues: a fixed-figure pattern shuts off the walking controls, and says why', () => {
  const off = inactiveControls('bass', { pattern: 'stoptime' }, 'blues');
  assert.deepEqual(Object.keys(off).sort(), ['approach', 'line', 'rhythm', 'tension']);
  assert.match(off.rhythm, /Stop-time plays a fixed figure/);
  assert.deepEqual(inactiveControls('bass', { pattern: 'walk' }, 'blues'), {});
});

test('blues: the named boogie figures play exactly that figure', () => {
  const third = 4;
  const want = { classic: [0, third, 7, 9, 10, 9, 7, third], chicago: [0, 7, 9, 7, 0, 7, 9, 7] };
  for (const [pattern, figure] of Object.entries(want)) {
    for (let seed = 1; seed <= 6; seed++) {
      const notes = render('blues', { bass: { pattern }, text: 'C7 | C7', seed })[0]
        .filter((e) => e.inst === 'bass').sort((a, b) => a.beat - b.beat).map((e) => e.midi % 12);
      assert.deepEqual(notes.slice(0, 7), figure.slice(0, 7), `${pattern}, seed ${seed}`);
    }
  }
});

test('bass settings accept every new pattern and repair unknown ones', () => {
  for (const p of PATTERNS) assert.equal(sanitizeBass({ pattern: p.id }).pattern, p.id);
  assert.equal(sanitizeBass({ pattern: 'nonsense' }, defaultBass(getStyle('rock'))).pattern, 'mixed');
});

// ---- jazz brushes ---------------------------------------------------------------------------

const BRUSH_VOICES = new Set([...DRUM_VOICES, 'brush', 'swish', 'brushCrash']);

test('jazz: brushes and ballad sweeps play brush voices, with no ride or stick crash, and sticks stay as they were', () => {
  const sticks = render('jazz', { kit: { groove: 'classic' } }).flat().filter((e) => e.inst === 'drums');
  assert.ok(sticks.some((e) => e.voice === 'ride'));
  assert.ok(!sticks.some((e) => e.voice === 'brush' || e.voice === 'swish'));
  assert.equal(defaultKit(getStyle('jazz')).groove, 'classic');
  for (const groove of ['brushes', 'sweep']) {
    for (const chorus of [1, 2]) {
      const drums = render('jazz', { kit: { groove }, chorus, text: 'Dm7 | G7 | Cmaj7 | A7 | Dm7 G7 | Cmaj7 | Am7 D7 | Gmaj7' }).flat().filter((e) => e.inst === 'drums');
      assert.ok(drums.some((e) => e.voice === 'swish'), `${groove} has no sweep`);
      assert.ok(drums.some((e) => e.voice === 'kick') && drums.some((e) => e.voice === 'hatPedal'), `${groove} lost its kick or hat`);
      assert.ok(!drums.some((e) => ['ride', 'crash', 'hatOpen'].includes(e.voice)), `${groove} still has stick cymbals`);
      for (const e of drums) assert.ok(BRUSH_VOICES.has(e.voice) && e.vel > 0 && e.vel <= 1.0001 && e.beat >= 0 && e.beat < 4, `${groove}: ${e.voice} ${e.beat} ${e.vel}`);
    }
    if (groove === 'brushes') assert.ok(render('jazz', { kit: { groove } }).flat().some((e) => e.voice === 'brush'), 'the swing groove plays brush taps');
  }
});

test('jazz: brushes work at every slider extreme and in every meter', () => {
  for (const groove of ['brushes', 'sweep']) {
    for (const ts of ['4/4', '6/8', '7/8', '10/8']) {
      for (const v of [0, 100]) {
        const kit = { groove, cymbal: v, kick: v, snare: v, ghosts: v, fills: v, wild: v, crash: v };
        const text = ts === '4/4' ? PROG : 'Dm7 | G7 | Cmaj7 | A7';
        for (const events of render('jazz', { kit, ts, text })) {
          const drums = events.filter((e) => e.inst === 'drums');
          assert.ok(drums.length > 0, `${groove} ${ts} empty bar`);
          for (const e of drums) assert.ok(BRUSH_VOICES.has(e.voice) && Number.isFinite(e.beat) && e.vel > 0, `${groove} ${ts}`);
        }
      }
    }
  }
});

test('the synth kit can play the brush and swish voices', async () => {
  const { playDrum } = await import('../src/audio/voices.js');
  const made = [];
  const node = () => new Proxy(function () {}, {
    get: (_, k) => (k === 'connect' ? (n) => n : k === 'then' ? undefined : typeof k === 'symbol' ? undefined : node()),
    apply: () => node(),
    set: () => true,
  });
  const ctx = new Proxy({ sampleRate: 44100, currentTime: 0, createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) }, {
    get: (t, k) => (k in t ? t[k] : (...a) => { made.push(k); return node(); }),
  });
  for (const voice of ['brush', 'swish', 'brushCrash']) {
    made.length = 0;
    playDrum(ctx, node(), voice, 0, 0.6);
    assert.ok(made.includes('createBufferSource'), `${voice} makes no sound`);
  }
});

// ---- the drum mixer ---------------------------------------------------------------------------

test('drum mixer: every voice any style or groove plays belongs to a mixer channel', async () => {
  const { partOf, DRUM_PARTS } = await import('../src/styles/drumparts.js');
  const voices = new Set();
  for (const styleId of ['jazz', 'blues', 'rock']) {
    for (const g of optionsFor({ options: GROOVES }, styleId).map((o) => o.id)) { // every groove, of every meter
      for (const ts of ['4/4', '7/8']) {
        for (const chorus of [1, 2]) {
          for (const seed of [1, 2, 3]) {
            const text = ts === '4/4' ? PROG : 'C7 | F7 | G7 | C7';
            for (const bar of render(styleId, { kit: { groove: g, fills: 100, wild: 100, crash: 100, cymbal: 100, kick: 100, snare: 100, ghosts: 100 }, ts, text, chorus, seed })) {
              for (const e of bar) if (e.inst === 'drums') voices.add(e.voice);
            }
          }
        }
      }
    }
  }
  assert.ok(voices.size >= 10, `only saw ${[...voices]}`);
  for (const v of voices) assert.ok(partOf(v), `${v} is not on any mixer channel`);
  assert.equal(new Set(DRUM_PARTS.flatMap((p) => p.voices)).size, DRUM_PARTS.flatMap((p) => p.voices).length, 'a voice is on two channels');
});

test('drum mixer: 50 is unity, 0 is silent, and the range is 12 dB either way', async () => {
  const { levelGain, levelDb, DEFAULT_LEVELS } = await import('../src/styles/drumparts.js');
  assert.equal(levelGain(50), 1);
  assert.equal(levelGain(0), 0);
  assert.equal(levelGain(100), 4);
  assert.equal(levelGain(25), 0.25);
  assert.equal(levelGain(500), 4);
  assert.ok(Math.abs(levelDb(100) - 12.04) < 0.01);
  assert.equal(levelDb(0), -Infinity);
  assert.ok(Object.values(DEFAULT_LEVELS).every((v) => v === 50));
});

test('drum mixer: levels are kept, repaired, and default to unity for older settings', () => {
  const kit = sanitizeKit({ levels: { kick: 80, snare: 999, hat: -5, toms: 'loud', nonsense: 1 } });
  assert.equal(kit.levels.kick, 80);
  assert.equal(kit.levels.snare, 100);
  assert.equal(kit.levels.hat, 0);
  assert.equal(kit.levels.toms, 50);
  assert.ok(!('nonsense' in kit.levels));
  assert.deepEqual(sanitizeKit({ cymbal: 20 }).levels, defaultKit(getStyle('jazz')).levels);
  assert.deepEqual(sanitizeKit(null).levels, sanitizeKit({}).levels);
});

test('drum mixer: the audio bus sets each channel and ignores what it does not know', async () => {
  const { Bus } = await import('../src/audio/engine.js');
  const gains = [];
  const generic = () => new Proxy(function () {}, {
    get: (_, k) => (k === 'connect' ? (n) => n : k === 'then' || typeof k === 'symbol' ? undefined : generic()),
    apply: () => generic(),
    set: () => true,
  });
  const ctx = {
    currentTime: 0, sampleRate: 44100, destination: generic(),
    createGain() {
      const calls = [];
      const g = { calls, gain: { value: 1, setTargetAtTime: (v) => calls.push(v) }, connect: (n) => n, disconnect() {} };
      gains.push(g);
      return g;
    },
  };
  const proxied = new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => generic()) });
  const bus = new Bus(proxied, {}, { drums: { volume: 1, muted: false }, bass: { volume: 1, muted: false }, chords: { volume: 1, muted: false } });
  bus.setDrumLevels({ kick: 100, snare: 0, hat: 25, bogus: 10 });
  assert.deepEqual(bus.drumOut.kick.calls, [4]);
  assert.deepEqual(bus.drumOut.snare.calls, [0]);
  assert.deepEqual(bus.drumOut.hat.calls, [0.25]);
  assert.deepEqual(bus.drumOut.toms.calls, []);
  bus.setDrumLevels();
  bus.setDrumLevels(undefined);
});

test('jazz: brushes have a brushed crash, so the Crashes slider still does something', () => {
  const crashes = (groove, crash) => render('jazz', { kit: { groove, crash, fills: 100, wild: 100 }, chorus: 2, seed: 5 }, 0)
    .flat().filter((e) => e.inst === 'drums' && /crash/i.test(e.voice));
  for (const groove of ['brushes', 'sweep']) {
    const loud = crashes(groove, 100);
    assert.ok(loud.length > 0, `${groove} never crashes`);
    assert.ok(loud.every((e) => e.voice === 'brushCrash' && e.dur >= 1.2), `${groove}: crashes are not brushed`);
    assert.equal(crashes(groove, 0).length, 0, `${groove}: Crashes at none still crashes`);
  }
  assert.ok(crashes('classic', 100).every((e) => e.voice === 'crash'), 'sticks keep the stick crash');
});

// ---- Latin jazz ---------------------------------------------------------------------------------

const LATIN_PROG = 'Dm7 | G7 | Cmaj7 | A7 | Dm7 G7 | Cmaj7 | Am7 D7 | Gmaj7';
const field = (group, id) => GROUPS[group].fields.find((f) => f.id === id);
const latinDrums = (groove, opts = {}) => render('jazz', { kit: { groove, ...opts.kit }, text: LATIN_PROG, seed: opts.seed ?? 1, chorus: opts.chorus ?? 1, swing: opts.swing });

for (const groove of ['bossa', 'afro']) {
  test(`jazz ${groove}: a Latin groove plays kick, cross-stick and hat or ride, well-formed, with no stick-jazz comping`, () => {
    for (const chorus of [1, 2]) {
      for (const bar of latinDrums(groove, { chorus })) {
        const d = bar.filter((e) => e.inst === 'drums');
        const voices = new Set(d.map((e) => e.voice));
        assert.ok(voices.has('kick') && voices.has('rim'), `${groove}: missing kick or cross-stick`);
        assert.ok(voices.has(groove === 'bossa' ? 'hat' : 'ride'), `${groove}: missing its cymbal`);
        for (const e of d) assert.ok(e.beat >= 0 && e.beat < 4 && e.dur > 0 && e.vel > 0 && e.vel <= 1.0001 && Number.isFinite(e.beat), `${groove}: ${e.voice} ${e.beat}`);
      }
    }
  });

  test(`jazz ${groove}: it is straight whatever the swing, and choosing it asks for 50%`, () => {
    // no fill or crash, so what is left is the groove itself
    const still = { kit: { fills: 0, crash: 0 } };
    const at = (swing) => JSON.stringify(latinDrums(groove, { ...still, swing }).map((b) => b.filter((e) => e.inst === 'drums').map((e) => [e.voice, +e.beat.toFixed(4)])));
    assert.equal(at(0.5), at(0.75), 'the drums moved with the Swing slider');
    assert.equal(grooveSwing('jazz', groove), 50);
    assert.equal(grooveSwing('jazz', 'classic'), null);
    assert.equal(grooveSwing('blues', groove), null);
  });

  test(`jazz ${groove}: Cymbal, Kick, Snare and Ghost notes each change what it plays`, () => {
    for (const slider of ['cymbal', 'kick', 'snare', 'ghosts']) {
      const sig = (v) => JSON.stringify([1, 2, 3, 4, 5, 6].map((seed) => latinDrums(groove, { kit: { [slider]: v, fills: 0, crash: 0 }, seed })));
      assert.notEqual(sig(5), sig(95), `${groove}: ${slider} does nothing`);
    }
  });

  test(`jazz ${groove}: in 6/8, 7/8 and 10/8 it plays as sticks, and the list does not offer it`, () => {
    for (const ts of ['6/8', '7/8', '10/8']) {
      const text = ts === '6/8' ? 'Dm7 | G7 | Cmaj7' : 'Dm7 | G7 | Cmaj7 | A7';
      const asGroove = JSON.stringify(render('jazz', { kit: { groove }, ts, text }));
      const asSticks = JSON.stringify(render('jazz', { kit: { groove: 'classic' }, ts, text }));
      assert.equal(asGroove, asSticks, `${groove} in ${ts}`);
      assert.ok(!optionsForMeter(field('kit', 'groove'), 'jazz', ts).some((o) => o.id === groove));
    }
  });
}

test('jazz bossa: the clave alternates between the three side and the two side, bar by bar', () => {
  const rims = (bar) => bar.filter((e) => e.voice === 'rim' && e.vel > 0.55).map((e) => +e.beat.toFixed(2));
  const bars = latinDrums('bossa', { kit: { snare: 0, ghosts: 0 } });
  assert.deepEqual(rims(bars[0]), [0, 1.5, 3]);
  assert.deepEqual(rims(bars[1]), [1, 2.5], 'the bossa nova clave: the two side is 2 and the "and" of 3');
  assert.deepEqual(rims(bars[2]), [0, 1.5, 3]);
});

test('jazz: "mixed" never picks a Latin groove, and a Latin groove is not offered to blues or rock', () => {
  const seen = new Set();
  for (let chorus = 1; chorus <= 20; chorus++) for (const bar of latinDrums('mixed', { chorus, seed: 3 })) for (const e of bar) seen.add(e.voice);
  assert.ok(!seen.has('rim'), 'mixed played a cross-stick');
  for (const styleId of ['blues', 'rock']) assert.ok(!optionsFor({ options: GROOVES }, styleId).some((o) => o.id === 'bossa' || o.id === 'afro'));
});
