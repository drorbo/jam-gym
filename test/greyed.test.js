import test from 'node:test';
import assert from 'node:assert/strict';
import { getStyle, renderBar, defaultBass, defaultComp, defaultKit } from '../src/styles/index.js';
import { GROUPS, effectiveOption, inactiveControls, isOddMeter, optionsForMeter } from '../src/styles/settings.js';
import { parseProgression } from '../src/theory/progression.js';
import { getMeter } from '../src/theory/meter.js';
import { createRng } from '../src/engine/rng.js';

const FOUR = 'C7 | F7 | C7 | G7 | Cm7 F7 | Bb13 A7#9 | Dm7 G7 | C7alt';
const ODD = 'Dm7 | G7 | Cmaj7 | A7 | Dm7 G7 | Cmaj7 | Am7 D7 | Gmaj7';
const INST = { bass: 'bass', comp: 'chords', kit: 'drums' };
const DEFAULTS = { bass: defaultBass, comp: defaultComp, kit: defaultKit };

const field = (group, id) => GROUPS[group].fields.find((f) => f.id === id);
const listIds = (group, id, styleId, ts) => optionsForMeter(field(group, id), styleId, ts).map((o) => o.id);

/** The notes one instrument plays, over a few seeds and two choruses, so a chance-based control can still show itself. */
function notes(styleId, ts, group, settings) {
  const style = getStyle(styleId);
  const meter = getMeter(ts);
  const { bars } = parseProgression(ts === '4/4' ? FOUR : ODD, { timeSignature: ts });
  const all = [];
  for (const seed of [1, 2, 3, 4]) {
    for (const chorus of [1, 2]) {
      const state = {};
      bars.forEach((bar, i) => {
        all.push(renderBar(style, {
          segments: bar.chords, nextChord: (bars[i + 1] ?? bars[0]).chords.find((s) => s.chord)?.chord ?? null,
          barIndex: i, barCount: bars.length, isFirstBar: i === 0, isLastBar: i === bars.length - 1,
          chorus, bpm: 100, meter, beatsPerBar: meter.quarters, state, seed, [group]: settings, rng: createRng(seed * 1000 + chorus * 37 + i),
        }));
      });
    }
  }
  return JSON.stringify(all.map((b) => b.filter((e) => e.inst === INST[group]).map((e) => [e.voice ?? e.midi, +e.beat.toFixed(3), +e.vel.toFixed(2), +e.dur.toFixed(2), +(e.dt ?? 0).toFixed(4)])));
}

test('in 6/8, 7/8 and 10/8 the lists leave out choices that sound like another one', () => {
  for (const ts of ['6/8', '7/8', '10/8']) {
    const figures = ['grouproots', 'bounce', 'arp', 'stepin']; // the /8 figures, for every style
    assert.deepEqual(listIds('bass', 'pattern', 'blues', ts), ['mixed', 'walk', 'boogie', ...figures]);
    assert.deepEqual(listIds('bass', 'pattern', 'rock', ts), ['mixed', 'eighths', 'pushes', 'quarters', 'melodic', ...figures]);
    assert.deepEqual(listIds('bass', 'rhythm', 'jazz', ts), ['quarters', 'skips', 'eighths', 'mixed']);
    assert.deepEqual(listIds('comp', 'rhythm', 'jazz', ts), ['auto']);
    // 4/4 grooves are left out; each style has grooves built from the groups instead (Bembé is 6/8 only)
    const bembe = ts === '6/8' ? ['bembe'] : [];
    assert.deepEqual(listIds('kit', 'groove', 'blues', ts), ['classic', 'pushgroups', 'halfgroups', 'tomdrive', 'rimgroups', 'traingroups', 'mixed']);
    assert.deepEqual(listIds('kit', 'groove', 'rock', ts), ['classic', 'pushgroups', 'halfgroups', 'tomdrive', 'bell', ...bembe, 'mixed']);
    assert.deepEqual(listIds('kit', 'groove', 'jazz', ts), ['classic', 'brushes', 'sweep', 'pushgroups', 'tomdrive', 'bell', ...bembe, 'rimgroups', 'mixed']);
    assert.deepEqual(listIds('bass', 'pattern', 'jazz', ts), ['walk', ...figures]); // the Latin bass figures are 4/4 figures
  }
  // 4/4 keeps every choice
  assert.equal(listIds('bass', 'pattern', 'blues', '4/4').length, 10);
  assert.equal(listIds('bass', 'pattern', 'rock', '4/4').length, 12);
  assert.equal(listIds('kit', 'groove', 'rock', '4/4').length, 8);
  assert.deepEqual(listIds('bass', 'pattern', 'jazz', '4/4'), ['walk', 'pedal', 'vamp', 'space', 'funk', 'bossa', 'tumbao', 'bolero', 'mixed']);
});

test('a stored choice that is not offered in the /8 meters shows as the one it plays like', () => {
  const f = field('bass', 'pattern');
  assert.equal(effectiveOption(f, 'gallop', 'rock', '7/8'), 'eighths');
  assert.equal(effectiveOption(f, 'held', 'rock', '6/8'), 'quarters');
  assert.equal(effectiveOption(f, 'stoptime', 'blues', '10/8'), 'boogie');
  assert.equal(effectiveOption(f, 'gallop', 'rock', '4/4'), 'gallop');
  assert.equal(effectiveOption(f, 'melodic', 'rock', '7/8'), 'melodic');
  assert.equal(effectiveOption(field('bass', 'rhythm'), 'two', 'jazz', '6/8'), 'quarters');
  assert.ok(isOddMeter('6/8') && !isOddMeter('4/4'));
});

// each case: the controls that must be greyed out (and, checked against the real notes, that they really do nothing)
const IDLE = [
  ['blues', '4/4', 'kit', { groove: 'slow' }, ['snare']],
  ['blues', '4/4', 'kit', { groove: 'chicago' }, ['snare']],
  ['blues', '4/4', 'kit', { groove: 'train' }, ['snare', 'ghosts']],
  ['rock', '4/4', 'kit', { groove: 'fourfloor' }, ['kick', 'ghosts']],
  ['rock', '4/4', 'kit', { groove: 'stomp' }, ['kick', 'ghosts']],
  ['rock', '4/4', 'kit', { groove: 'diddley' }, ['kick', 'ghosts']],
  ['rock', '4/4', 'kit', { groove: 'ride' }, ['ghosts']],
  ['rock', '4/4', 'kit', { groove: 'funk' }, ['snare']],
  ['jazz', '7/8', 'kit', { groove: 'brushes' }, ['kick']],
  ['jazz', '4/4', 'kit', { groove: 'classic' }, ['clave']],
  ['jazz', '4/4', 'kit', { groove: 'brushes' }, ['clave', 'snareSound']],
  ['jazz', '4/4', 'kit', { groove: 'sweep' }, ['clave', 'snareSound']],
  ['jazz', '7/8', 'kit', { groove: 'bossa' }, ['clave']], // in 6/8, 7/8 and 10/8 a Latin groove plays as sticks
  ['jazz', '4/4', 'bass', { pattern: 'pedal' }, ['rhythm', 'line', 'tension', 'approach']],
  ['jazz', '4/4', 'bass', { pattern: 'vamp' }, ['rhythm', 'line', 'tension', 'approach']],
  ['jazz', '4/4', 'bass', { pattern: 'space' }, ['rhythm', 'line', 'tension', 'approach']],
  ['jazz', '4/4', 'bass', { pattern: 'funk' }, ['rhythm', 'line', 'tension', 'approach']],
  ['jazz', '4/4', 'bass', { pattern: 'bossa' }, ['rhythm', 'line', 'tension', 'approach']],
  ['jazz', '4/4', 'bass', { pattern: 'tumbao' }, ['rhythm', 'line', 'tension', 'approach']],
  ['jazz', '4/4', 'bass', { pattern: 'bolero' }, ['rhythm', 'line', 'tension', 'approach']],
  ['jazz', '4/4', 'bass', { pattern: 'mixed' }, ['rhythm', 'line', 'tension', 'approach']],
  ['blues', '4/4', 'bass', { pattern: 'stoptime' }, ['rhythm', 'line', 'tension', 'approach']],
  ['blues', '7/8', 'bass', { pattern: 'triplets' }, ['rhythm', 'line', 'tension', 'approach']],
  ['rock', '4/4', 'bass', { pattern: 'melodic' }, ['fills']],
  ['rock', '4/4', 'bass', { pattern: 'boogie' }, ['line']],
  ['jazz', '4/4', 'bass', { rhythm: 'two' }, ['tension']],
  ['jazz', '6/8', 'bass', { rhythm: 'quarters' }, ['tension']],
  ['blues', '6/8', 'bass', { rhythm: 'skips', pattern: 'mixed' }, ['line', 'tension']],
  ['blues', '6/8', 'bass', { rhythm: 'quarters', pattern: 'walk' }, ['tension']],
  ['jazz', '7/8', 'kit', {}, ['kick']],
  ['blues', '7/8', 'kit', {}, ['snare']], // the classic groove: the group downbeats have the snare
  ['rock', '10/8', 'kit', {}, ['snare']],
  ['rock', '7/8', 'kit', { groove: 'bembe' }, ['snare']], // a 6/8-only groove plays as the classic one in 7/8
  ['jazz', '7/8', 'kit', { groove: 'sweep' }, ['kick']],
  ['rock', '6/8', 'bass', {}, ['fills']],
  ['jazz', '6/8', 'comp', {}, ['rhythm', 'variety']],
  ['blues', '7/8', 'comp', {}, ['rhythm', 'variety']],
  ['rock', '10/8', 'comp', {}, ['rhythm', 'variety']],
];

test('the controls that do nothing are greyed out, with a reason, and really do nothing', () => {
  for (const [styleId, ts, group, values, expected] of IDLE) {
    const idle = inactiveControls(group, { ...DEFAULTS[group](getStyle(styleId)), ...values }, styleId, ts);
    const label = `${styleId} ${ts} ${JSON.stringify(values)}`;
    for (const id of expected) {
      assert.ok(idle[id], `${label}: ${id} should be greyed out`);
      assert.ok(idle[id].endsWith('.'), `${label}: ${id} has no reason`);
      const f = field(group, id);
      // sliders at both ends; selects over everything the meter offers
      const variants = f.type === 'slider' ? [10, 90] : optionsForMeter(f, styleId, ts).map((o) => o.id);
      const played = new Set(variants.map((v) => notes(styleId, ts, group, { ...values, [id]: v })));
      assert.equal(played.size, 1, `${label}: ${id} is greyed out but changes the notes`);
    }
  }
});

test('nothing is greyed out at the style defaults in 4/4, and a control returns when its reason goes away', () => {
  for (const styleId of ['jazz', 'blues', 'rock']) {
    const style = getStyle(styleId);
    for (const group of ['bass', 'comp', 'kit']) {
      // the one thing greyed at the start is the jazz Clave: only a Latin groove plays one
      const expected = styleId === 'jazz' && group === 'kit' ? ['clave'] : [];
      assert.deepEqual(Object.keys(inactiveControls(group, DEFAULTS[group](style), styleId)), expected, `${styleId} ${group}`);
    }
  }
  const kit = { ...defaultKit(getStyle('rock')), groove: 'fourfloor' };
  assert.ok(inactiveControls('kit', kit, 'rock', '4/4').kick);
  assert.ok(!inactiveControls('kit', { ...kit, groove: 'classic' }, 'rock', '4/4').kick);
  assert.ok(!inactiveControls('kit', kit, 'jazz', '4/4').kick); // a groove that belongs to another style greys out nothing
  assert.ok(!inactiveControls('kit', { ...defaultKit(getStyle('jazz')), groove: 'brushes' }, 'jazz', '4/4').crash); // brushes have a crash of their own
});
