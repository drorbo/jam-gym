import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresetsController } from '../src/app/presets-controller.js';
import { builtinPresets, loadLibrary, mergeLibraries, sanitizeLibrary } from '../src/app/presets.js';
import { createStore, defaultState } from '../src/app/state.js';
import { ApiError } from '../src/app/api.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const tick = () => new Promise((r) => setImmediate(r));

/** A store with a tracks slice (so identity can appear), and a controller wired to a fake server. */
function setup({ me = null, storage = memory(), server = null, ids = ['aaaaaaaa1', 'bbbbbbbb2', 'cccccccc3', 'dddddddd4'] } = {}) {
  const store = createStore({ ...defaultState(), tracks: { me } });
  let clock = 1_000_000;
  const remote = server ?? { items: [], deleted: {} }; // what the fake server holds
  const calls = [];
  const api = {
    async syncPresets(payload) {
      calls.push(payload);
      if (api.fail) throw api.fail;
      if (api.gate) await api.gate;
      const merged = mergeLibraries(remote, sanitizeLibrary({ items: payload.presets, deleted: Object.fromEntries(payload.deleted.map((d) => [d.id, d.at])) }));
      remote.items = merged.items;
      remote.deleted = merged.deleted;
      return {
        presets: merged.items.map((p) => ({ id: p.id, name: p.name, data: p.settings, updatedAt: p.updatedAt })),
        deleted: Object.entries(merged.deleted).map(([id, at]) => ({ id, at })),
      };
    },
  };
  const ctrl = createPresetsController({ store, api, storage, now: () => (clock += 100), makeId: () => ids.shift(), setTimer: () => null });
  return { store, ctrl, api, calls, remote, storage, setMe: (m) => store.set({ tracks: { me: m } }) };
}

test('without an account presets stay on this device: saved, listed, remembered next time, and never sent anywhere', async () => {
  const { store, ctrl, calls, storage } = setup();
  ctrl.start();
  const r = ctrl.saveCurrent('My band');
  assert.ok(r.ok);
  assert.deepEqual(store.get().presets.items.map((p) => p.name), ['My band']);
  assert.match(store.get().presets.note.text, /kept on this device/);
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(store.get().presets.sync, 'local');
  // a new page load finds it
  const again = setup({ storage });
  assert.deepEqual(again.store.get().presets.items.map((p) => p.name), ['My band']);
});

test('saving keeps the whole band, applying it puts it back, and the chords, key, tempo and meter are never touched', () => {
  const { store, ctrl } = setup();
  const [, slow] = builtinPresets('blues');
  ctrl.apply(slow);
  assert.equal(store.get().song.tempo, 58, 'a built-in preset sets its own tempo');
  store.set({ song: { ...store.get().song, tempo: 77, key: 'Eb', timeSignature: '4/4' }, config: { ...store.get().config, loop: false } });
  assert.ok(ctrl.isActive(slow));
  ctrl.saveCurrent('Slow one');
  const saved = store.get().presets.items[0];
  ctrl.apply(builtinPresets('rock')[0]);
  assert.equal(store.get().config.style, 'rock');
  store.set({ song: { ...store.get().song, tempo: 77 } }); // back to the tempo we had
  assert.ok(!ctrl.isActive(saved));
  const song = store.get().song;
  ctrl.apply(saved);
  assert.ok(ctrl.isActive(saved));
  assert.equal(store.get().config.kit.groove, 'slow');
  assert.equal(store.get().config.sounds.keys, 'organ');
  assert.deepEqual(store.get().song, song);
  assert.equal(store.get().config.loop, false);
});

test('when an account appears the list is sent, and the server\'s presets are merged in', async () => {
  const server = { items: sanitizeLibrary({ items: [{ id: 'server001', name: 'From my other device', settings: { style: 'rock' }, updatedAt: 5 }] }).items, deleted: {} };
  const { store, ctrl, calls, setMe } = setup({ server });
  ctrl.start();
  ctrl.saveCurrent('Made offline');
  assert.equal(calls.length, 0);
  setMe({ id: 'ABC', displayName: 'Player-1234' }); // the first saved track creates an account
  await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].presets.map((p) => p.name), ['Made offline']);
  assert.deepEqual(store.get().presets.items.map((p) => p.name), ['From my other device', 'Made offline']);
  assert.equal(store.get().presets.sync, 'synced');
});

test('with an account every change is sent, including a deletion and its undo', async () => {
  const { store, ctrl, calls, remote } = setup({ me: { id: 'ABC' } });
  ctrl.start();
  ctrl.saveCurrent('Keeper');
  await tick(); await tick();
  assert.deepEqual(remote.items.map((p) => p.name), ['Keeper']);
  const id = store.get().presets.items[0].id;
  ctrl.remove(id);
  assert.equal(store.get().presets.note.undo, true);
  await tick(); await tick();
  assert.deepEqual(remote.items, []);
  assert.ok(id in remote.deleted);
  ctrl.undo();
  await tick(); await tick();
  assert.deepEqual(remote.items.map((p) => p.name), ['Keeper'], 'bringing it back beats the deletion on the server too');
  assert.deepEqual(remote.deleted, {});
  assert.ok(calls.length >= 3);
});

test('offline or a server error leaves the local presets alone, and the next sync catches up', async () => {
  const { store, ctrl, api, remote } = setup({ me: { id: 'ABC' } });
  ctrl.start();
  api.fail = new ApiError(0, 'offline', 'no connection');
  ctrl.saveCurrent('While offline');
  await tick(); await tick();
  assert.equal(store.get().presets.sync, 'offline');
  assert.deepEqual(store.get().presets.items.map((p) => p.name), ['While offline']);
  api.fail = new ApiError(500, 'server_error', 'oops');
  ctrl.saveCurrent('Second');
  await tick(); await tick();
  assert.equal(store.get().presets.sync, 'error');
  api.fail = null;
  ctrl.saveCurrent('Third');
  await tick(); await tick();
  assert.equal(store.get().presets.sync, 'synced');
  assert.deepEqual(remote.items.map((p) => p.name), ['Second', 'Third', 'While offline'], 'everything made while it was down arrives');
});

test('changes made while a sync is in flight are not lost when the answer arrives', async () => {
  const { store, ctrl, api, remote } = setup({ me: { id: 'ABC' } });
  ctrl.start();
  let open;
  api.gate = new Promise((r) => { open = r; });
  ctrl.saveCurrent('First');
  await tick();
  ctrl.saveCurrent('Made during the sync'); // the first request is still waiting
  open();
  api.gate = null;
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(store.get().presets.items.map((p) => p.name), ['First', 'Made during the sync']);
  assert.deepEqual(remote.items.map((p) => p.name), ['First', 'Made during the sync']);
  assert.equal(store.get().presets.sync, 'synced');
});

test('a full account is reported, and a broken or blocked storage does not break saving', async () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const { store, ctrl } = setup({ storage: blocked });
  assert.ok(ctrl.saveCurrent('Still works').ok);
  assert.equal(store.get().presets.items.length, 1);
  assert.equal(ctrl.saveCurrent('   ').ok, false);
  assert.equal(store.get().presets.note.kind, 'error');

  const bad = memory();
  bad.setItem('jamgym.presets.v1', '{not json');
  assert.deepEqual(loadLibrary(bad).items, []);
});

test('every preset sets its tempo: the built-in ones their best, your own the one you saved, while stopped and while playing', () => {
  const tempos = [];
  const store = createStore({ ...defaultState(), tracks: { me: null } });
  const player = { setTempo: (bpm) => tempos.push(bpm) };
  const ctrl = createPresetsController({ store, storage: memory(), player, now: () => 1_000, makeId: () => 'ididid001', setTimer: () => null });
  for (const preset of builtinPresets()) {
    tempos.length = 0;
    ctrl.apply(preset);
    assert.deepEqual(tempos, [preset.tempo], `${preset.id} did not set its tempo`);
    assert.match(store.get().presets.note.text, new RegExp(`tempo ${preset.tempo} BPM`));
  }

  // your own preset remembers the tempo it was saved at
  store.set({ song: { ...store.get().song, tempo: 83 } });
  ctrl.saveCurrent('Mine');
  const mine = store.get().presets.items[0];
  assert.equal(mine.settings.tempo, 83);
  store.set({ song: { ...store.get().song, tempo: 150 } });
  tempos.length = 0;
  ctrl.apply(mine);
  assert.deepEqual(tempos, [83]);
  assert.match(store.get().presets.note.text, /tempo 83 BPM/);

  // replacing it with the current settings takes the current tempo too
  store.set({ song: { ...store.get().song, tempo: 96 } });
  ctrl.saveCurrent('Mine');
  assert.equal(store.get().presets.items[0].settings.tempo, 96);
  assert.equal(store.get().presets.items.length, 1, 'replacing kept one preset');

  // a preset saved before tempo was included leaves the tempo alone
  const { tempo, ...old } = mine.settings;
  tempos.length = 0;
  ctrl.apply({ ...mine, settings: old });
  assert.deepEqual(tempos, []);
  assert.doesNotMatch(store.get().presets.note.text, /tempo/);

  // with no player at all (tests, a page still starting) the song's tempo is set directly
  const bare = createStore({ ...defaultState(), tracks: { me: null } });
  createPresetsController({ store: bare, storage: memory(), setTimer: () => null }).apply(builtinPresets('rock')[1]);
  assert.equal(bare.get().song.tempo, 80);
});

test('the tempo of a preset survives the trip to the account and back', async () => {
  const { store, ctrl, remote } = setup({ me: { id: 'ABC' } });
  ctrl.start();
  store.set({ song: { ...store.get().song, tempo: 71 } });
  ctrl.saveCurrent('Slowish');
  await tick(); await tick();
  assert.equal(remote.items[0].settings.tempo, 71);
  // another device
  const other = setup({ me: { id: 'ABC' }, server: remote });
  other.ctrl.start();
  await tick(); await tick();
  assert.equal(other.store.get().presets.items[0].settings.tempo, 71);
});
