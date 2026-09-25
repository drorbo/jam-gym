import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PRESETS } from '../src/styles/presets.js';
import { getStyle, listStyles, renderBar, defaultBass, defaultComp, defaultKit } from '../src/styles/index.js';
import { inactiveControls } from '../src/styles/settings.js';
import {
  MAX_NAME, MAX_PRESETS, PRESET_KEYS, applySettings, builtinPresets, cleanName, describePreset, emptyLibrary, mergeLibraries, presetSignature, randomId,
  removePreset, restorePreset, sanitizeLibrary, sanitizePresetSettings, savePreset, settingsFromConfig,
} from '../src/app/presets.js';
import { defaultState } from '../src/app/state.js';
import { parseProgression } from '../src/theory/progression.js';
import { getMeter } from '../src/theory/meter.js';
import { createRng } from '../src/engine/rng.js';

const settings = (over = {}) => sanitizePresetSettings({ style: 'blues', ...over });
let clock = 1_000;
const opts = () => ({ now: (clock += 10), makeId: () => randomId() });

// ---- the built-in presets ---------------------------------------------------------------------

test('there are three built-in presets for every style, each with a name, a description and valid settings', () => {
  for (const style of listStyles()) {
    const list = builtinPresets(style.id);
    assert.equal(list.length, 3, `${style.id} has ${list.length} presets`);
    assert.equal(new Set(list.map((p) => p.name)).size, 3, 'names must differ');
    for (const p of list) {
      assert.ok(p.name && p.blurb && p.tempo >= 40 && p.tempo <= 220, p.id);
      assert.equal(p.settings.style, style.id);
      assert.deepEqual(sanitizePresetSettings(p.settings), p.settings, `${p.id} is not stable under checking`);
      assert.deepEqual(Object.keys(p.settings), [...PRESET_KEYS, 'tempo']);
      assert.equal(p.settings.tempo, p.tempo, `${p.id} does not carry its tempo`);
    }
  }
  assert.equal(new Set(BUILTIN_PRESETS.map((p) => p.id)).size, BUILTIN_PRESETS.length, 'ids must be unique');
});

test('each style has a preset that is exactly the style as it has always been, and the others differ from it and from each other', () => {
  for (const style of listStyles()) {
    const [first, ...rest] = builtinPresets(style.id);
    const defaults = sanitizePresetSettings({ style: style.id, bass: defaultBass(style), comp: defaultComp(style), kit: defaultKit(style) });
    assert.equal(presetSignature(first.settings), presetSignature({ ...defaults, swing: first.settings.swing }), `${style.id}'s first preset is not the plain style`);
    const sigs = new Set([first, ...rest].map((p) => presetSignature(p.settings)));
    assert.equal(sigs.size, 3, `${style.id} has two identical presets`);
  }
});

test('no built-in preset asks for a setting that does nothing, and every one plays', () => {
  const text = 'Dm7 | G7 | Cmaj7 | A7 | Dm7 G7 | Cmaj7 | Am7 D7 | Gmaj7';
  for (const p of builtinPresets()) {
    for (const group of ['bass', 'comp', 'kit']) {
      const defaults = { bass: defaultBass, comp: defaultComp, kit: defaultKit }[group](getStyle(p.style));
      const idle = inactiveControls(group, p.settings[group], p.style);
      for (const id of Object.keys(idle)) assert.equal(p.settings[group][id], defaults[id], `${p.id}: ${group}.${id} is set but greyed out (${idle[id]})`);
    }
    const style = getStyle(p.style);
    const { bars } = parseProgression(text);
    const state = {};
    bars.forEach((bar, i) => {
      const events = renderBar(style, {
        segments: bar.chords, nextChord: (bars[i + 1] ?? bars[0]).chords.find((s) => s.chord)?.chord ?? null,
        barIndex: i, barCount: bars.length, isFirstBar: i === 0, isLastBar: i === bars.length - 1, chorus: 1, bpm: p.tempo,
        meter: getMeter('4/4'), beatsPerBar: 4, state, seed: 1, swing: p.settings.swing / 100, bass: p.settings.bass, comp: p.settings.comp,
        kit: p.settings.kit, rng: createRng(1000 + i),
      });
      for (const inst of ['drums', 'bass', 'chords']) assert.ok(events.some((e) => e.inst === inst), `${p.id}: bar ${i} has no ${inst}`);
    });
  }
});

// ---- settings ---------------------------------------------------------------------------------

test('a preset holds the band and nothing else, and applying it leaves the rest of the setup alone', () => {
  const state = defaultState();
  const current = settingsFromConfig(state.config);
  assert.deepEqual(Object.keys(current), PRESET_KEYS);
  const blues = builtinPresets('blues')[1];
  const applied = applySettings({ ...state.config, loop: false, tempoRamp: { ...state.config.tempoRamp, enabled: true }, countIn: false }, blues.settings);
  assert.ok(!('tempo' in applied), 'the tempo belongs to the song, not the configuration');
  assert.equal(applied.style, 'blues');
  assert.equal(applied.kit.groove, 'slow');
  assert.equal(applied.loop, false);
  assert.equal(applied.countIn, false);
  assert.equal(applied.tempoRamp.enabled, true);
  assert.deepEqual(applied.modulation, state.config.modulation);
  // applying copies: changing the result cannot change the preset
  applied.kit.groove = 'classic';
  assert.equal(blues.settings.kit.groove, 'slow');
});

test('junk settings are repaired the way a saved track repairs them', () => {
  const s = sanitizePresetSettings({ style: 'polka', swing: 'lots', bass: { pattern: 'nonsense', line: 500 }, kit: { levels: { kick: -3, bogus: 1 } }, sounds: { drums: 'kazoo' }, tempo: 999, loop: false });
  assert.equal(s.style, 'jazz');
  assert.ok(s.swing >= 50 && s.swing <= 75);
  assert.equal(s.bass.line, 100);
  assert.equal(s.kit.levels.kick, 0);
  assert.equal(s.sounds.drums, 'auto');
  assert.equal(s.tempo, 220, 'a tempo out of range is clamped');
  assert.ok(!('loop' in s));
  assert.ok(!('tempo' in sanitizePresetSettings({ tempo: 'fast' })) && !('tempo' in sanitizePresetSettings({})), 'no tempo stays no tempo');
  assert.equal(sanitizePresetSettings({ tempo: 100.4 }).tempo, 100);
  assert.deepEqual(sanitizePresetSettings(null), sanitizePresetSettings({}));
});

// ---- a person's own list ----------------------------------------------------------------------

test('saving under a new name adds a preset, under an existing name (any case) updates it, and the list stays sorted', () => {
  let r = savePreset(emptyLibrary(), { name: '  My   shuffle ', settings: settings() }, opts());
  assert.ok(r.ok && !r.replaced);
  assert.equal(r.item.name, 'My shuffle');
  const id = r.item.id;
  r = savePreset(r.lib, { name: 'Another', settings: settings() }, opts());
  assert.deepEqual(r.lib.items.map((p) => p.name), ['Another', 'My shuffle']);
  const changed = savePreset(r.lib, { name: 'MY SHUFFLE', settings: settings({ swing: 72 }) }, opts());
  assert.ok(changed.replaced);
  assert.equal(changed.lib.items.length, 2);
  assert.equal(changed.item.id, id, 'an update keeps the id');
  assert.equal(changed.lib.items.find((p) => p.id === id).settings.swing, 72);
  assert.ok(changed.item.updatedAt > r.item.updatedAt);
});

test('names are cleaned, must not be empty, and the list has a limit', () => {
  assert.equal(cleanName('a\tb\nc'), 'a b c');
  assert.equal([...cleanName('x'.repeat(200))].length, MAX_NAME);
  assert.equal(savePreset(emptyLibrary(), { name: '   ', settings: settings() }, opts()).ok, false);
  let lib = emptyLibrary();
  for (let i = 0; i < MAX_PRESETS; i++) lib = savePreset(lib, { name: `P${i}`, settings: settings() }, opts()).lib;
  const full = savePreset(lib, { name: 'One too many', settings: settings() }, opts());
  assert.equal(full.ok, false);
  assert.match(full.error, /50 presets/);
  assert.ok(savePreset(lib, { name: 'p3', settings: settings({ swing: 60 }) }, opts()).ok, 'updating a preset still works when full');
});

test('deleting keeps a marker, and bringing it back removes the marker', () => {
  const made = savePreset(emptyLibrary(), { name: 'Gone', settings: settings() }, opts());
  const gone = removePreset(made.lib, made.item.id, 5_000);
  assert.deepEqual(gone.lib.items, []);
  assert.equal(gone.lib.deleted[made.item.id], 5_000);
  assert.equal(gone.removed.name, 'Gone');
  assert.equal(removePreset(gone.lib, 'nothere12345', 1).removed, null);
  const back = restorePreset(gone.lib, gone.removed, 6_000);
  assert.equal(back.items.length, 1);
  assert.equal(back.items[0].updatedAt, 6_000);
  assert.deepEqual(back.deleted, {});
});

test('two lists merge to the same result whichever way round: the latest change wins, and a deletion wins a tie', () => {
  const item = (id, name, at, swing = 60) => ({ id, name, settings: settings({ swing }), updatedAt: at });
  const a = { items: [item('aaaaaa1', 'Shared', 100, 55), item('aaaaaa2', 'Only A', 100)], deleted: { bbbbbb3: 300, cccccc4: 200 } };
  const b = { items: [item('aaaaaa1', 'Shared (renamed)', 200, 70), item('bbbbbb3', 'Deleted on A', 250), item('cccccc4', 'Tie', 200)], deleted: { aaaaaa2: 150 } };
  const ab = mergeLibraries(a, b);
  const ba = mergeLibraries(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(ab.items.map((p) => p.name), ['Shared (renamed)'], 'the newer edit wins; deletions that are newer or tied win too');
  assert.equal(ab.items[0].settings.swing, 70);
  assert.deepEqual(ab.deleted, { bbbbbb3: 300, cccccc4: 200, aaaaaa2: 150 });
  // a preset saved again after being deleted comes back
  const revived = mergeLibraries({ items: [], deleted: { aaaaaa2: 150 } }, { items: [item('aaaaaa2', 'Back', 400)], deleted: {} });
  assert.deepEqual(revived.items.map((p) => p.name), ['Back']);
  assert.deepEqual(revived.deleted, {});
});

test('a library from storage or the network is repaired, never trusted', () => {
  const lib = sanitizeLibrary({
    items: [
      { id: 'goodid12', name: 'Good', settings: { style: 'rock' }, updatedAt: 5 },
      { id: 'goodid12', name: 'Duplicate id', settings: {}, updatedAt: 9 },
      { id: 'x', name: 'Bad id', settings: {}, updatedAt: 5 },
      { id: 'noname12', name: '   ', settings: {}, updatedAt: 5 },
      { id: 'nostamp12', name: 'No time', settings: {} },
      { id: 'wire1234', name: 'From the wire', data: { style: 'blues' }, updatedAt: 7 },
      null, 'text', 4,
    ],
    deleted: { gone1234: 3, x: 3, bad12345: 'never' },
  });
  assert.deepEqual(lib.items.map((p) => p.name), ['From the wire', 'Good']); // sorted by name
  assert.equal(lib.items[0].settings.style, 'blues');
  assert.deepEqual(lib.deleted, { gone1234: 3 });
  for (const junk of [null, undefined, 5, 'x', [], { items: 'no' }]) assert.deepEqual(sanitizeLibrary(junk), emptyLibrary());
});

test('random ids are 12 letters and digits and do not repeat', () => {
  const ids = new Set(Array.from({ length: 500 }, () => randomId()));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9]{12}$/);
});

test('a preset is described in one line: style, groove and swing', () => {
  assert.equal(describePreset(builtinPresets('blues')[1].settings), 'Blues · Slow 12/8 · 67% swing · 58 BPM');
  assert.equal(describePreset(builtinPresets('jazz')[2].settings), 'Jazz · Latin: bossa nova · 50% swing · 120 BPM');
  assert.equal(describePreset(builtinPresets('rock')[0].settings), 'Rock · Classic rock · 50% swing · 120 BPM');
  assert.equal(describePreset({ style: 'polka', swing: 60, kit: {} }), 'Jazz · 60% swing', 'a preset without a tempo shows none');
});
