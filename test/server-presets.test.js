import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './harness.js';
import { MAX_PRESETS, builtinPresets, randomId, sanitizePresetSettings } from '../src/app/presets.js';
import { LIMITS } from '../server/config.js';

const withServer = (fn) => async () => {
  const s = await startTestServer();
  try { await fn(s); } finally { await s.close(); }
};

const wire = (id, name, at, over = {}) => ({ id, name, data: sanitizePresetSettings({ style: 'blues', ...over }), updatedAt: at });
const sync = (b, presets = [], deleted = []) => b.post('/api/presets/sync', { presets, deleted });

/** A person on a first device, and the same person on a second one (through their recovery code). */
async function twoDevices(browser) {
  const one = browser();
  assert.equal((await one.post('/api/session')).status, 200);
  const code = (await one.get('/api/me/recovery')).json.code;
  const two = browser();
  assert.equal((await two.post('/api/me/recover', { code })).status, 200);
  return { one, two };
}

test('presets need an identity, and one person cannot see or change another person\'s', withServer(async ({ browser }) => {
  const anon = browser();
  assert.equal((await sync(anon)).status, 401);

  const a = browser();
  await a.post('/api/session');
  const b = browser();
  await b.post('/api/session');
  const id = randomId();
  assert.equal((await sync(a, [wire(id, 'Mine', 100)])).json.presets.length, 1);
  assert.deepEqual((await sync(b)).json.presets, [], 'the other person sees nothing');
  // the same id on another account is a different preset
  const theirs = (await sync(b, [wire(id, 'Theirs', 50)])).json.presets;
  assert.deepEqual(theirs.map((p) => p.name), ['Theirs']);
  assert.deepEqual((await sync(a)).json.presets.map((p) => p.name), ['Mine']);
}));

test('a preset made on one device shows up on the other, with all its settings', withServer(async ({ browser }) => {
  const { one, two } = await twoDevices(browser);
  const preset = builtinPresets('rock')[2];
  const id = randomId();
  const sent = wire(id, 'Funky', 1_000, preset.settings);
  const back = await sync(one, [sent]);
  assert.equal(back.status, 200);
  assert.deepEqual(back.json.presets, [sent], 'the settings changed on the way in and out');
  assert.deepEqual((await sync(two)).json.presets, [sent]);
}));

test('a preset keeps its tempo on the server, and one without a tempo stays without', withServer(async ({ browser }) => {
  const { one, two } = await twoDevices(browser);
  const a = randomId();
  const b = randomId();
  await sync(one, [wire(a, 'With tempo', 100, { tempo: 66 }), wire(b, 'Without', 100)]);
  const got = Object.fromEntries((await sync(two)).json.presets.map((p) => [p.name, p.data.tempo]));
  assert.deepEqual(got, { 'With tempo': 66, Without: undefined });
}));

test('the latest change wins, whichever device sends it first', withServer(async ({ browser }) => {
  const { one, two } = await twoDevices(browser);
  const id = randomId();
  await sync(one, [wire(id, 'First', 100, { swing: 55 })]);
  await sync(two, [wire(id, 'Second', 300, { swing: 70 })]);
  const stale = await sync(one, [wire(id, 'Stale edit', 200, { swing: 60 })]); // older than what the server has
  assert.deepEqual(stale.json.presets.map((p) => [p.name, p.data.swing]), [['Second', 70]]);
  const same = await sync(two, [wire(id, 'Same time', 300)]);
  assert.equal(same.json.presets[0].name, 'Second', 'a tie keeps what is there');
}));

test('a deleted preset stays deleted on every device, until it is saved again afterwards', withServer(async ({ browser }) => {
  const { one, two } = await twoDevices(browser);
  const id = randomId();
  const T = Date.now() - 60_000; // real timestamps: a deletion marker older than 90 days is cleared
  await sync(one, [wire(id, 'Doomed', T + 100)]);
  await sync(two); // two now has it
  const del = await sync(one, [], [{ id, at: T + 500 }]);
  assert.deepEqual(del.json.presets, []);
  assert.deepEqual(del.json.deleted, [{ id, at: T + 500 }]);
  // device two still holds the old copy and sends it: it must not come back
  const again = await sync(two, [wire(id, 'Doomed', T + 100)]);
  assert.deepEqual(again.json.presets, []);
  // an edit made after the deletion does bring it back
  const revived = await sync(two, [wire(id, 'Back again', T + 900)]);
  assert.deepEqual(revived.json.presets.map((p) => p.name), ['Back again']);
  assert.deepEqual(revived.json.deleted, []);
  // and a deletion that is older than the current copy is ignored
  const old = await sync(one, [], [{ id, at: T + 800 }]);
  assert.equal(old.json.presets.length, 1);
}));

test('settings are repaired on the way in, and junk is ignored without failing the rest', withServer(async ({ browser }) => {
  const { one } = await twoDevices(browser);
  const good = randomId();
  const r = await sync(one, [
    { id: good, name: '  Tidy   name ', data: { style: 'polka', bass: { pattern: 'nonsense' }, tempo: 999 }, updatedAt: 100 },
    { id: 'x', name: 'Bad id', data: {}, updatedAt: 100 },
    { id: randomId(), name: '   ', data: {}, updatedAt: 100 },
    { id: randomId(), name: 'No time', data: {} },
    null, 'text', 7,
  ], [{ id: 'bad', at: 1 }, { id: randomId(), at: 'never' }, null]);
  assert.equal(r.status, 200);
  assert.equal(r.json.presets.length, 1);
  assert.equal(r.json.presets[0].name, 'Tidy name');
  assert.equal(r.json.presets[0].data.style, 'jazz');
  assert.equal(r.json.presets[0].data.tempo, 220, 'a tempo out of range is clamped');
  assert.equal((await sync(one, 'nope')).status, 400);
  assert.equal((await one.post('/api/presets/sync', { presets: 'no' })).status, 400);
}));

test('there is a limit to how many presets a person keeps, and it does not lose the ones they have', withServer(async ({ browser }) => {
  const { one } = await twoDevices(browser);
  const many = Array.from({ length: MAX_PRESETS }, (_, i) => wire(randomId(), `P${i}`, 100 + i, builtinPresets('jazz')[i % 3].settings));
  const full = await sync(one, many);
  assert.equal(full.status, 200, 'fifty presets fit in one request');
  assert.equal(full.json.presets.length, MAX_PRESETS);
  const over = await sync(one, [wire(randomId(), 'One too many', 999)]);
  assert.equal(over.json.presets.length, MAX_PRESETS);
  assert.equal(over.json.skipped, 1);
  // updating one that exists still works when full
  const first = many[0];
  const upd = await sync(one, [{ ...first, name: 'Renamed', updatedAt: 5_000 }]);
  assert.ok(upd.json.presets.some((p) => p.name === 'Renamed') && !upd.json.skipped);
  assert.equal((await sync(one, Array.from({ length: MAX_PRESETS * 2 + 1 }, () => wire(randomId(), 'x', 1)))).status, 400);
  assert.equal((await sync(one, [], Array.from({ length: LIMITS.presetDeletions + 1 }, () => ({ id: randomId(), at: 1 })))).status, 400);
}));

test('a preset cannot be dated far in the future to beat every later change', withServer(async ({ browser }) => {
  const { one } = await twoDevices(browser);
  const id = randomId();
  await sync(one, [wire(id, 'From the future', Date.now() + 10 * 365 * 24 * 3600 * 1000)]);
  const later = await sync(one, [wire(id, 'Now', Date.now() + 5 * 60 * 1000)]);
  assert.equal(later.json.presets[0].name, 'Now');
}));

test('deleting an account removes its presets, and old deletion markers are cleared after 90 days', withServer(async ({ browser, db }) => {
  const { one } = await twoDevices(browser);
  const id = randomId();
  await sync(one, [wire(id, 'Kept', 100), wire(randomId(), 'Other', 100)], []);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM presets').get().c, 2);
  // an ancient deletion marker is purged on the next sync
  db.prepare("INSERT INTO presets(owner_id, id, name, data, updated_at, deleted) VALUES ((SELECT id FROM users LIMIT 1), 'ancient123', '', '{}', 1, 1)").run();
  await sync(one);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM presets WHERE id = 'ancient123'").get().c, 0);
  assert.equal((await one.del('/api/me')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM presets').get().c, 0);
}));
