// Latin jazz: the claves, the Latin bass figures, the Latin brushes ballad, and the snare sound.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getStyle, renderBar } from '../src/styles/index.js';
import { CLAVE_IDS, CLAVES, applySnareSound, claveBar } from '../src/styles/drumming.js';
import { LATIN_BASS_STEPS } from '../src/styles/figures.js';
import { DRUM_PARTS, partOf } from '../src/styles/drumparts.js';
import { GROOVES, PATTERNS, SNARE_SOUNDS, bandSwing, grooveSwing, inactiveControls, optionsFor, optionsForMeter, GROUPS } from '../src/styles/settings.js';
import { parseProgression } from '../src/theory/progression.js';
import { getMeter } from '../src/theory/meter.js';
import { createRng } from '../src/engine/rng.js';
import { mod12 } from '../src/theory/notes.js';

const PROG = 'Dm7 | G7 | Cmaj7 | A7 | Dm7 G7 | Cmaj7 | Am7 D7 | Gmaj7';
const SAME = 'Cm7 | Cm7 | Cm7 | Cm7'; // a chord that never changes

function render(styleId, { kit, bass, ts = '4/4', text = PROG, chorus = 1, seed = 1, swing } = {}) {
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
const drums = (bars) => bars.flat().filter((e) => e.inst === 'drums');
const bass = (bar) => bar.filter((e) => e.inst === 'bass').sort((a, b) => a.beat - b.beat);
const claveHits = (bar, voice = 'rim', minVel = 0.3) => bar.filter((e) => e.voice === voice && e.vel > minVel).map((e) => +e.beat.toFixed(2));

// ---- the claves ------------------------------------------------------------------------------

test('the claves are the son, rumba and bossa nova claves, in 3-2 and 2-3', () => {
  assert.deepEqual(CLAVE_IDS, ['son32', 'son23', 'rumba32', 'rumba23', 'bossa32', 'bossa23']);
  assert.deepEqual(CLAVES.son, [[0, 1.5, 3], [1, 2]]);
  assert.deepEqual(CLAVES.rumba, [[0, 1.5, 3.5], [1, 2]]);
  assert.deepEqual(CLAVES.bossa, [[0, 1.5, 3], [1, 2.5]]);
  for (const name of ['son', 'rumba', 'bossa']) {
    const [three, two] = CLAVES[name];
    assert.equal(three.length, 3);
    assert.equal(two.length, 2);
    assert.deepEqual([0, 1, 2, 3].map((i) => claveBar(`${name}32`, i)), [three, two, three, two], `${name} 3-2`);
    assert.deepEqual([0, 1, 2, 3].map((i) => claveBar(`${name}23`, i)), [two, three, two, three], `${name} 2-3`);
  }
  // the three sides differ only where they should: rumba moves the last hit of the three side, bossa the last of the two side
  assert.deepEqual(CLAVES.son[0].slice(0, 2), CLAVES.rumba[0].slice(0, 2));
  assert.notEqual(CLAVES.son[0][2], CLAVES.rumba[0][2]);
  assert.deepEqual(CLAVES.son[1], CLAVES.rumba[1]);
  assert.notDeepEqual(CLAVES.son[1], CLAVES.bossa[1]);
});

test('Latin grooves play the clave you choose on the cross-stick, and their own when it is left alone', () => {
  const own = { bossa: 'bossa32', afro: 'son32', latinballad: 'son32' };
  const quiet = { snare: 0, ghosts: 0, fills: 0, crash: 0 };
  for (const groove of ['bossa', 'afro', 'latinballad']) {
    const lowVel = groove === 'latinballad' ? 0.3 : 0.55;
    const play = (clave) => render('jazz', { kit: { groove, clave, ...quiet }, text: SAME }).map((bar) => claveHits(bar, 'rim', lowVel));
    const expected = (id) => [0, 1, 2, 3].map((i) => claveBar(id, i));
    assert.deepEqual(play('auto'), expected(own[groove]), `${groove}'s own clave`);
    for (const id of CLAVE_IDS) assert.deepEqual(play(id), expected(id), `${groove} with ${id}`);
  }
});

test('"mixed" clave changes every four bars, stays put inside the four, and only plays real claves', () => {
  const quiet = { snare: 0, ghosts: 0, fills: 0, crash: 0, clave: 'mixed' };
  const seen = new Set();
  for (let chorus = 1; chorus <= 12; chorus++) {
    const bars = render('jazz', { kit: { groove: 'bossa', ...quiet }, chorus, seed: 4, text: 'C | C | C | C | C | C | C | C' }).map((b) => claveHits(b, 'rim', 0.55));
    for (const start of [0, 4]) {
      const block = bars.slice(start, start + 4);
      const which = CLAVE_IDS.filter((id) => block.every((hits, i) => JSON.stringify(hits) === JSON.stringify(claveBar(id, i))));
      assert.ok(which.length >= 1, `chorus ${chorus} bars ${start}-${start + 3} are not one clave: ${JSON.stringify(block)}`);
      which.forEach((w) => seen.add(w));
    }
  }
  assert.ok(seen.size >= 3, `mixed only ever played ${[...seen]}`);
});

// ---- the snare sound -------------------------------------------------------------------------

test('the snare sound plays the snare part as a snare, a cross-stick or a stick click, and leaves brushes alone', () => {
  const ev = [
    { inst: 'drums', voice: 'snare', beat: 1, vel: 0.9, dur: 0.3 }, { inst: 'drums', voice: 'rim', beat: 2, vel: 0.6, dur: 0.15 },
    { inst: 'drums', voice: 'brush', beat: 3, vel: 0.5, dur: 0.2 }, { inst: 'drums', voice: 'kick', beat: 0, vel: 0.8, dur: 0.3 },
    { inst: 'bass', midi: 40, beat: 0, vel: 0.8, dur: 1 },
  ];
  const voices = (list) => list.map((e) => e.voice ?? 'bass');
  assert.equal(applySnareSound(ev, 'snare'), ev, 'the default changes nothing');
  assert.deepEqual(voices(applySnareSound(ev, 'rim')), ['rim', 'rim', 'brush', 'kick', 'bass']);
  assert.deepEqual(voices(applySnareSound(ev, 'stick')), ['stick', 'stick', 'brush', 'kick', 'bass'], 'a stick click also replaces the clave');
  const out = applySnareSound(ev, 'rim');
  assert.deepEqual(out.map((e) => [e.beat, e.vel, e.dur]), ev.map((e) => [e.beat, e.vel, e.dur]), 'timing and level are kept');
  assert.equal(ev[0].voice, 'snare', 'the original events are not changed');
});

test('in every style the snare sound reaches the drums: no snare drum is left when it is a cross-stick or sticks', () => {
  for (const styleId of ['jazz', 'blues', 'rock']) {
    const plain = drums(render(styleId, { kit: { groove: 'classic', snareSound: 'snare', ghosts: 100, snare: 100, fills: 100 } }));
    assert.ok(plain.some((e) => e.voice === 'snare'), `${styleId} has no snare to change`);
    for (const sound of ['rim', 'stick']) {
      const changed = drums(render(styleId, { kit: { groove: 'classic', snareSound: sound, ghosts: 100, snare: 100, fills: 100 } }));
      assert.ok(!changed.some((e) => e.voice === 'snare'), `${styleId}/${sound} still has a snare drum`);
      assert.ok(changed.some((e) => e.voice === sound), `${styleId}/${sound} plays no ${sound}`);
      assert.equal(changed.length, plain.length, `${styleId}/${sound} changed how many notes there are`);
    }
  }
});

test('"mixed" snare sound changes bar by bar between all three, differently in each run', () => {
  const kit = { groove: 'classic', snareSound: 'mixed', ghosts: 0, snare: 0, fills: 0 };
  const perBar = (seed) => render('blues', { kit, seed, text: 'C7 | C7 | C7 | C7 | C7 | C7 | C7 | C7 | C7 | C7 | C7 | C7' })
    .map((bar) => [...new Set(bar.filter((e) => ['snare', 'rim', 'stick'].includes(e.voice)).map((e) => e.voice))]);
  const a = perBar(1);
  assert.ok(a.every((v) => v.length === 1), 'a bar keeps to one sound');
  assert.deepEqual([...new Set(a.flat())].sort(), ['rim', 'snare', 'stick']);
  assert.notDeepEqual(perBar(2), a);
});

test('the snare sound and clave voices are on the drum mixer', () => {
  assert.equal(partOf('rim'), 'snare');
  assert.equal(partOf('stick'), 'snare');
  assert.ok(DRUM_PARTS.find((p) => p.id === 'snare').voices.includes('stick'));
  assert.deepEqual(SNARE_SOUNDS.map((o) => o.id), ['snare', 'rim', 'stick', 'mixed']);
});

test('the synth can play the cross-stick, the stick click and the brush voices', async () => {
  const { playDrum } = await import('../src/audio/voices.js');
  const generic = () => new Proxy(function () {}, {
    get: (_, k) => (k === 'connect' ? (n) => n : k === 'then' || typeof k === 'symbol' ? undefined : generic()),
    apply: () => generic(),
    set: () => true,
  });
  for (const voice of ['rim', 'stick', 'brush', 'swish', 'brushCrash']) {
    const made = [];
    const ctx = new Proxy({ sampleRate: 44100, currentTime: 0, createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) }, {
      get: (t, k) => (k in t ? t[k] : (...a) => { made.push(k); return generic(); }),
    });
    playDrum(ctx, generic(), voice, 0, 0.7);
    assert.ok(made.length > 0, `${voice} makes no sound`);
  }
});

// ---- the Latin brushes ballad ----------------------------------------------------------------

test('the Latin brushes ballad sweeps on every beat with a soft clave, and is all brushes', () => {
  const kit = { groove: 'latinballad', fills: 100, wild: 100, crash: 100, snare: 100, ghosts: 100, cymbal: 100 };
  for (const chorus of [1, 2, 3]) {
    const all = drums(render('jazz', { kit, chorus, seed: 5 }));
    const voices = new Set(all.map((e) => e.voice));
    for (const need of ['swish', 'rim', 'kick', 'hatPedal']) assert.ok(voices.has(need), `no ${need}`);
    for (const banned of ['ride', 'snare', 'crash', 'hatOpen', 'hat']) assert.ok(!voices.has(banned), `a ballad on brushes plays ${banned}`);
  }
  for (const bar of render('jazz', { kit: { groove: 'latinballad', fills: 0, crash: 0 } })) {
    const sweeps = bar.filter((e) => e.voice === 'swish' && Number.isInteger(+e.beat.toFixed(2)) === true).map((e) => Math.round(e.beat));
    assert.deepEqual([...new Set(sweeps)], [0, 1, 2, 3], 'one sweep on each beat');
  }
  assert.ok(drums(render('jazz', { kit, chorus: 2, seed: 5 })).some((e) => e.voice === 'brushCrash'), 'a crash is a brushed crash');
});

test('the Latin brushes ballad is straight whatever the swing, and Cymbal, Kick, Snare and Ghost notes each change it', () => {
  const still = { groove: 'latinballad', fills: 0, crash: 0 };
  const at = (swing) => JSON.stringify(render('jazz', { kit: still, swing }).map((b) => b.filter((e) => e.inst === 'drums').map((e) => [e.voice, +e.beat.toFixed(4)])));
  assert.equal(at(0.5), at(0.75));
  for (const slider of ['cymbal', 'kick', 'snare', 'ghosts']) {
    const sig = (v) => JSON.stringify([1, 2, 3, 4, 5, 6].map((seed) => render('jazz', { kit: { ...still, [slider]: v }, seed })));
    assert.notEqual(sig(5), sig(95), `${slider} does nothing`);
  }
  assert.equal(grooveSwing('jazz', 'latinballad'), 50);
});

// ---- the Latin bass figures ------------------------------------------------------------------

const BASS_PROG = 'Dm7 | G7 | Cmaj7 | Cmaj7';
const notesOf = (pattern, text = BASS_PROG, extra = {}) => render('jazz', { bass: { pattern }, text, ...extra }).map(bass);

test('bossa: root, fifth and root on the dotted pulse (1, the "and" of 2, 4), straight, and always inside the bass range', () => {
  const [bar] = notesOf('bossa', SAME);
  assert.deepEqual(bar.map((e) => e.beat), [0, 1.5, 3]);
  const root = bar[0].midi;
  assert.equal(mod12(bar[1].midi - root), 7, 'a fifth on the "and" of two');
  assert.equal(mod12(bar[2].midi - root), 0);
  assert.ok(bar.every((e) => e.fixed && e.midi >= 28 && e.midi <= 52), 'straight and in range');
  assert.ok(bar[0].dur > 1, 'the root is held');
});

test('tumbao: the "and" of two and four, and the next chord\'s root a half beat early, but only when the chord changes', () => {
  const [held] = notesOf('tumbao', SAME);
  assert.deepEqual(held.map((e) => e.beat), [1.5, 3], 'nothing to anticipate over a chord that stays');
  const [first] = notesOf('tumbao', BASS_PROG); // Dm7 into G7
  assert.deepEqual(first.map((e) => e.beat), [1.5, 3, 3.5]);
  assert.equal(mod12(first[2].midi), 7, 'the anticipation is G, the next root');
  assert.equal(mod12(first[0].midi), 2, 'the tumbao itself is on D');
});

test('bolero: long roots, the fifth on three, and the next root anticipated', () => {
  const [first] = notesOf('bolero', BASS_PROG);
  assert.deepEqual(first.map((e) => e.beat), [0, 2, 3.5]);
  assert.ok(first[0].dur > 1.5, 'a long root');
  assert.equal(mod12(first[2].midi), 7);
  assert.deepEqual(notesOf('bolero', SAME)[0].map((e) => e.beat), [0, 2]);
});

test('the Latin bass figures are straight whatever the swing, and each is different from walking and from each other', () => {
  const sig = (pattern, swing) => JSON.stringify(render('jazz', { bass: { pattern }, swing }).map((b) => bass(b).map((e) => [e.midi, +e.beat.toFixed(4)])));
  for (const pattern of ['bossa', 'tumbao', 'bolero']) assert.equal(sig(pattern, 0.5), sig(pattern, 0.75), `${pattern} moved with the swing`);
  assert.notEqual(sig('walk', 0.5), sig('walk', 0.75), 'walking does swing');
  assert.equal(new Set(['walk', 'bossa', 'tumbao', 'bolero'].map((p) => sig(p, 0.5))).size, 4);
  for (const pattern of Object.keys(LATIN_BASS_STEPS)) {
    for (const chorus of [1, 2]) for (const bar of notesOf(pattern, PROG, { chorus })) {
      assert.ok(bar.length >= 2);
      for (const e of bar) assert.ok(e.midi >= 24 && e.midi <= 60 && e.beat >= 0 && e.beat < 4 && e.dur > 0 && e.vel > 0 && e.vel <= 1);
    }
  }
});

test('"mixed" Latin bass changes figure every four bars and never walks', () => {
  const shapes = new Set();
  for (let chorus = 1; chorus <= 12; chorus++) {
    const bars = render('jazz', { bass: { pattern: 'mixed' }, chorus, seed: 3, text: 'C | C | C | C | C | C | C | C' }).map(bass);
    for (const start of [0, 4]) {
      const block = bars.slice(start, start + 4).map((b) => b.map((e) => e.beat).join());
      assert.equal(new Set(block).size, 1, `chorus ${chorus} bars ${start}-${start + 3} changed figure inside four bars`);
      shapes.add(block[0]);
    }
  }
  assert.ok(shapes.size >= 2, 'never changed figure');
  assert.ok([...shapes].every((s) => ['0,1.5,3', '1.5,3', '0,2'].includes(s)), `not a Latin figure: ${[...shapes]}`);
});

test('in 6/8, 7/8 and 10/8 the Latin bass figures and grooves play as a walk and as sticks, and the lists say so', () => {
  const field = (id) => GROUPS.bass.fields.find((f) => f.id === id);
  for (const ts of ['6/8', '7/8', '10/8']) {
    const text = 'Dm7 | G7 | Cmaj7 | A7';
    for (const pattern of ['pedal', 'vamp', 'space', 'funk', 'bossa', 'tumbao', 'bolero', 'mixed']) {
      assert.equal(JSON.stringify(render('jazz', { bass: { pattern }, ts, text })), JSON.stringify(render('jazz', { bass: { pattern: 'walk' }, ts, text })), `${pattern} in ${ts}`);
    }
    for (const groove of ['bossa', 'afro', 'latinballad']) {
      assert.equal(JSON.stringify(render('jazz', { kit: { groove }, ts, text })), JSON.stringify(render('jazz', { kit: { groove: 'classic' }, ts, text })), `${groove} in ${ts}`);
    }
    assert.deepEqual(optionsForMeter(field('pattern'), 'jazz', ts).map((o) => o.id), ['walk', 'grouproots', 'bounce', 'arp', 'stepin'], 'the Latin figures are left out, the group figures are in');
  }
  assert.equal(optionsForMeter(field('pattern'), 'jazz', '4/4').length, 9);
});

// ---- swing -----------------------------------------------------------------------------------

test('a Latin groove or a Latin bass figure asks for a straight swing; nothing else does', () => {
  const kit = (groove) => ({ groove });
  const bassOf = (pattern) => ({ pattern });
  assert.equal(bandSwing('jazz', kit('bossa'), bassOf('walk')), 50);
  assert.equal(bandSwing('jazz', kit('classic'), bassOf('tumbao')), 50);
  assert.equal(bandSwing('jazz', kit('latinballad'), bassOf('bolero')), 50);
  assert.equal(bandSwing('jazz', kit('classic'), bassOf('mixed')), 50);
  assert.equal(bandSwing('jazz', kit('classic'), bassOf('walk')), null);
  assert.equal(bandSwing('jazz', kit('brushes'), bassOf('walk')), null);
  assert.equal(bandSwing('blues', kit('bossa'), bassOf('mixed')), null, 'a Latin groove stored under another style asks for nothing');
  assert.equal(bandSwing('rock', kit('classic'), bassOf('bolero')), null);
  for (const o of [...GROOVES, ...PATTERNS].filter((x) => x.swing !== undefined)) assert.equal(o.swing, 50);
});

test('the new controls exist for the right styles and every dropdown of them has a Mixed choice', () => {
  const kit = GROUPS.kit.fields;
  assert.deepEqual(kit.find((f) => f.id === 'snareSound').options.map((o) => o.id), ['snare', 'rim', 'stick', 'mixed']);
  assert.deepEqual(kit.find((f) => f.id === 'clave').styles, ['jazz']);
  assert.ok(kit.find((f) => f.id === 'clave').options.some((o) => o.id === 'mixed'));
  assert.equal(kit.find((f) => f.id === 'snareSound').styles, undefined, 'every style has the snare sound');
});

// ---- the jazz-funk groove --------------------------------------------------------------------

const latinDrums = (groove, opts = {}) => render('jazz', { kit: { groove, ...opts.kit }, seed: opts.seed ?? 1 });

test('jazz-funk drums lock with the jazz-funk bass riff: the kick sits on the riff\'s accents, and never off them', () => {
  const riff = new Set(bass(render('jazz', { bass: { pattern: 'funk' }, text: SAME })[0]).map((e) => +e.beat.toFixed(2)));
  assert.deepEqual([...riff].sort((a, b) => a - b), [0, 0.75, 1.5, 2, 2.75, 3.25, 3.5]);
  const kicks = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    for (const kick of [0, 50, 100]) {
      for (const bar of render('jazz', { kit: { groove: 'jazzfunk', kick, fills: 0, crash: 0 }, text: SAME, seed })) {
        for (const e of bar) if (e.voice === 'kick') kicks.add(+e.beat.toFixed(2));
      }
    }
  }
  for (const b of kicks) assert.ok(riff.has(b), `a kick at ${b} is not on the bass riff`);
  for (const b of [0, 1.5, 2.75]) assert.ok(kicks.has(b), `the kick misses the riff's accent at ${b}`);
  for (const b of [0.75, 2, 3.5]) assert.ok(kicks.has(b), `the kick never plays the riff's note at ${b}`);
});

test('jazz-funk drums: a backbeat on two and four, sixteenth hats, ghosted snares, straight, and asks for a straight swing', () => {
  const bars = render('jazz', { kit: { groove: 'jazzfunk', fills: 0, crash: 0, ghosts: 100, cymbal: 100 }, text: SAME });
  for (const bar of bars) {
    const snares = bar.filter((e) => e.voice === 'snare' && e.vel > 0.8).map((e) => +e.beat.toFixed(2));
    assert.deepEqual(snares, [1, 3], 'the backbeat');
    const hats = bar.filter((e) => e.voice === 'hat').map((e) => +e.beat.toFixed(2));
    assert.equal(hats.length, 16, 'a hat on every sixteenth at full Cymbal');
    assert.ok(bar.some((e) => e.voice === 'snare' && e.vel < 0.4), 'ghosted snares');
    assert.ok(bar.filter((e) => e.inst === 'drums').every((e) => e.fixed), 'straight sixteenths');
  }
  const at = (swing) => JSON.stringify(render('jazz', { kit: { groove: 'jazzfunk', fills: 0, crash: 0 }, swing }).map((b) => b.filter((e) => e.inst === 'drums').map((e) => [e.voice, +e.beat.toFixed(4)])));
  assert.equal(at(0.5), at(0.75), 'the drums moved with the Swing slider');
  assert.equal(grooveSwing('jazz', 'jazzfunk'), 50);
  assert.equal(bandSwing('jazz', { groove: 'jazzfunk' }, { pattern: 'walk' }), 50);
});

test('jazz-funk drums: Cymbal, Kick, Snare and Ghost notes each change it, and it is only for jazz in 4/4', () => {
  for (const slider of ['cymbal', 'kick', 'snare', 'ghosts']) {
    const sig = (v) => JSON.stringify([1, 2, 3, 4, 5, 6].map((seed) => latinDrums('jazzfunk', { kit: { [slider]: v, fills: 0, crash: 0 }, seed })));
    assert.notEqual(sig(5), sig(95), `${slider} does nothing`);
  }
  for (const ts of ['6/8', '7/8', '10/8']) {
    const text = ts === '6/8' ? 'Dm7 | G7 | Cmaj7' : 'Dm7 | G7 | Cmaj7 | A7';
    assert.equal(JSON.stringify(render('jazz', { kit: { groove: 'jazzfunk' }, ts, text })), JSON.stringify(render('jazz', { kit: { groove: 'classic' }, ts, text })), `in ${ts} it plays as sticks`);
    assert.ok(!optionsForMeter(GROUPS.kit.fields.find((f) => f.id === 'groove'), 'jazz', ts).some((o) => o.id === 'jazzfunk'));
  }
  for (const styleId of ['blues', 'rock']) assert.ok(!optionsFor({ options: GROOVES }, styleId).some((o) => o.id === 'jazzfunk'));
});

test('"mixed" never picks jazz-funk, and it has no clave to choose', () => {
  const voices = new Set();
  for (let chorus = 1; chorus <= 12; chorus++) for (const e of drums(render('jazz', { kit: { groove: 'mixed' }, chorus, seed: 2 }))) voices.add(e.voice);
  assert.ok(!voices.has('rim'), 'mixed played a Latin or funk groove');
  const idle = inactiveControls('kit', { ...getStyle('jazz').kit, groove: 'jazzfunk' }, 'jazz', '4/4');
  assert.ok(idle.clave, 'only the Latin grooves play a clave');
  assert.ok(!idle.snareSound, 'the snare sound applies to its snare');
  const rim = drums(render('jazz', { kit: { groove: 'jazzfunk', snareSound: 'rim', fills: 0, crash: 0, ghosts: 0 } })).filter((e) => e.voice === 'rim').length;
  assert.ok(rim >= 8, 'as a cross-stick the backbeat is a rim click');
});

// ---- the fast straight ride (Metheny style) --------------------------------------------------

const ride = (opts = {}) => render('jazz', { kit: { groove: 'straightride', fills: 0, crash: 0, ...opts.kit }, text: SAME, seed: opts.seed ?? 1, swing: opts.swing });

test('straight ride: an even eighth-note ride with the beats a little stronger, thinned to quarters by Cymbal, and the foot on two and four', () => {
  for (const bar of ride({ kit: { cymbal: 60 } })) {
    const rides = bar.filter((e) => e.voice === 'ride' && e.beat % 0.5 === 0).sort((a, b) => a.beat - b.beat);
    assert.deepEqual(rides.map((e) => e.beat), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 'eight even notes');
    assert.ok(rides.every((e) => e.fixed), 'unswung');
    rides.forEach((e, i) => assert.ok(i % 2 === 0 ? e.vel > 0.55 : e.vel < 0.55, `note ${i}: the beats are stronger than the "ands"`));
    assert.deepEqual(bar.filter((e) => e.voice === 'hatPedal').map((e) => e.beat), [1, 3]);
  }
  for (const bar of ride({ kit: { cymbal: 0 } })) assert.deepEqual(bar.filter((e) => e.voice === 'ride').map((e) => e.beat), [0, 1, 2, 3], 'only the quarters at the bottom of Cymbal');
  const flutter = ride({ kit: { cymbal: 100 } }).flat().filter((e) => e.voice === 'ride' && e.beat % 0.5 !== 0);
  assert.ok(flutter.length > 0 && flutter.every((e) => e.vel < 0.4), 'a quiet flutter of sixteenths at the top');
});

test('straight ride: a feathered kick with syncopated bombs, and a busy snare on the sixteenth grid', () => {
  const bars = ride({ seed: 3 });
  for (const bar of bars) {
    const feathered = bar.filter((e) => e.voice === 'kick' && [0, 2].includes(e.beat));
    assert.equal(feathered.length, 2);
    assert.ok(feathered.every((e) => e.vel < 0.45), 'feathered');
  }
  const bombs = (kick) => new Set(ride({ kit: { kick }, seed: 4 }).flat().filter((e) => e.voice === 'kick' && e.vel > 0.5).map((e) => e.beat));
  assert.equal(bombs(0).size, 0, 'no bombs at the bottom of Kick');
  const some = bombs(100);
  assert.ok(some.size >= 3 && [...some].every((b) => [0.75, 1.5, 2.75, 3.5].includes(b)), `bombs off the grid: ${[...some]}`);
  const grid = new Set([0.5, 0.75, 1.5, 1.75, 2.25, 2.5, 2.75, 3.25, 3.5]);
  for (const e of ride({ seed: 2 }).flat().filter((x) => x.voice === 'snare')) assert.ok(grid.has(e.beat), `a snare at ${e.beat}`);
  const count = (snare, ghosts = 100) => { let n = 0; for (let seed = 1; seed <= 12; seed++) n += ride({ kit: { snare, ghosts }, seed }).flat().filter((e) => e.voice === 'snare').length; return n; };
  assert.ok(count(95) > count(5) * 1.5, 'Snare makes it busier');
  const quiet = (ghosts) => ride({ kit: { ghosts, snare: 80 }, seed: 5 }).flat().filter((e) => e.voice === 'snare' && e.vel < 0.5).length;
  assert.ok(quiet(0) === 0 && quiet(100) > 0, 'Ghost notes are the quiet hits');
});

test('straight ride: unswung whatever the swing, straight fills, asks for a straight swing, and plays as sticks in the /8 meters', () => {
  const sig = (swing) => JSON.stringify(ride({ swing }).map((b) => b.filter((e) => e.inst === 'drums').map((e) => [e.voice, +e.beat.toFixed(4)])));
  assert.equal(sig(0.5), sig(0.75));
  assert.equal(grooveSwing('jazz', 'straightride'), 50);
  // the fills are in sixteenths, not triplets, and so are the jazz-funk groove's
  for (const groove of ['straightride', 'jazzfunk']) {
    let fills = 0;
    for (let seed = 1; seed <= 20; seed++) {
      for (const e of render('jazz', { kit: { groove, fills: 100, wild: 100 }, text: SAME, seed }).flat().filter((x) => x.inst === 'drums')) {
        assert.equal((e.beat * 4) % 1, 0, `${groove}: a note at ${e.beat} is off the sixteenth grid`);
        fills++;
      }
    }
    assert.ok(fills > 0);
  }
  for (const ts of ['6/8', '7/8', '10/8']) {
    const text = ts === '6/8' ? 'Dm7 | G7 | Cmaj7' : 'Dm7 | G7 | Cmaj7 | A7';
    assert.equal(JSON.stringify(render('jazz', { kit: { groove: 'straightride' }, ts, text })), JSON.stringify(render('jazz', { kit: { groove: 'classic' }, ts, text })));
  }
});

test('straight ride: Cymbal, Kick, Snare and Ghost notes each change it, mixed never picks it, and the snare sound applies', () => {
  for (const slider of ['cymbal', 'kick', 'snare', 'ghosts']) {
    const sig = (v) => JSON.stringify([1, 2, 3, 4, 5, 6].map((seed) => ride({ kit: { [slider]: v }, seed })));
    assert.notEqual(sig(5), sig(95), `${slider} does nothing`);
  }
  const idle = inactiveControls('kit', { ...getStyle('jazz').kit, groove: 'straightride' }, 'jazz', '4/4');
  assert.ok(idle.clave && !idle.snareSound && !idle.crash && !idle.fills);
  const voices = new Set();
  for (let chorus = 1; chorus <= 12; chorus++) for (const e of drums(render('jazz', { kit: { groove: 'mixed' }, chorus, seed: 2 }))) voices.add(`${e.voice}${e.fixed ? '*' : ''}`);
  assert.ok(![...voices].some((v) => v.endsWith('*')), 'mixed played a straight groove');
  const rim = ride({ kit: { snareSound: 'rim', snare: 100, ghosts: 100 } }).flat().filter((e) => e.voice === 'rim').length;
  assert.ok(rim > 0 && !ride({ kit: { snareSound: 'rim', snare: 100, ghosts: 100 } }).flat().some((e) => e.voice === 'snare'), 'as cross-sticks the comping is rim clicks');
});
