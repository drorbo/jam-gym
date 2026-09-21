import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../src/app/api.js';
import { createTracksController, initialTracksState } from '../src/app/tracks.js';
import { buildTrackData, dataFromLocalSave, setupSignature } from '../src/app/tracks-model.js';
import { createStore, defaultState } from '../src/app/state.js';
import { prepareTrackData } from '../server/trackdata.js';
import { startTestServer } from './harness.js';

// ---- helpers -------------------------------------------------------------------------------

/** fetch with a cookie jar, so each "browser" keeps its own session against the real test server. */
function jarFetch() {
  const jar = new Map();
  return {
    jar,
    fetch: async (url, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(url, { ...init, headers });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (/Max-Age=0/i.test(c) || !pair.slice(i + 1)) jar.delete(pair.slice(0, i)); else jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      return res;
    },
  };
}

/** A player stand-in that applies and reads the setup through the store, like the real one. */
function fakePlayer(store, { saved = [] } = {}) {
  return {
    saved,
    currentSetup: () => buildTrackData(store.get()),
    applySetup(data) {
      store.set({ song: { ...store.get().song, ...data.song }, config: { ...store.get().config, ...data.config }, mixer: data.mixer });
    },
    saveCurrent(name) {
      const item = { id: `local${saved.length}`, name };
      saved.push(item);
      return { ok: true, item };
    },
  };
}

function person(server, { search = '', storage = new Map() } = {}) {
  const j = jarFetch();
  const api = createApi({ fetch: j.fetch, base: server.base });
  const store = createStore({ ...defaultState(), saved: [], activeSaved: null });
  const player = fakePlayer(store);
  const store2 = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  const tracks = createTracksController({ store, player, api, storage: store2, search, setTimer: () => 0 });
  const set = (patch) => store.set(patch);
  const setSong = (song) => set({ song: { ...store.get().song, ...song } });
  const setConfig = (config) => set({ config: { ...store.get().config, ...config } });
  return { api, store, player, tracks, jar: j.jar, storage, setSong, setConfig, state: () => store.get().tracks };
}

const withServer = (fn, env) => async () => {
  const s = await startTestServer(env);
  try { await fn(s); } finally { await s.close(); }
};

// ---- the API client ------------------------------------------------------------------------

function recordingFetch(reply = () => ({ status: 200, json: {} })) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, ...init });
    const r = reply(url, init);
    return { ok: r.status < 400, status: r.status, headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? r.retryAfter ?? null : null) }, json: async () => r.json };
  };
  return { f, calls };
}

test('the API client sends what the server requires and builds correct URLs', async () => {
  const { f, calls } = recordingFetch(() => ({ status: 200, json: { items: [], total: 0, track: { id: 'x' }, tracks: [], me: null } }));
  const api = createApi({ fetch: f, base: 'https://example.test' });
  await api.browse({ q: 'Dm7 G7', style: '', meter: '7/8', bpmMin: 90, bpmMax: undefined, sort: null, limit: 20, offset: 0 });
  assert.equal(calls[0].url, 'https://example.test/api/browse?q=Dm7+G7&meter=7%2F8&bpmMin=90&limit=20&offset=0', 'empty values are left out');
  await api.getTrack('a/b c');
  assert.equal(calls[1].url, 'https://example.test/api/tracks/a%2Fb%20c', 'ids are encoded');
  await api.createTrack({ title: 't', data: {} });
  assert.equal(calls[2].method, 'POST');
  assert.equal(calls[2].headers['X-JG'], '1');
  assert.equal(calls[2].headers['Content-Type'], 'application/json');
  assert.equal(calls[2].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[2].body), { title: 't', data: {} });
  await api.me();
  assert.equal(calls[3].headers['Content-Type'], undefined, 'no body, no content type');
  assert.equal(calls[3].body, undefined);
  for (const [fn, method, path] of [
    [() => api.like('id1'), 'PUT', '/api/tracks/id1/like'], [() => api.unlike('id1'), 'DELETE', '/api/tracks/id1/like'],
    [() => api.publish('id1'), 'POST', '/api/tracks/id1/publish'], [() => api.unpublish('id1'), 'POST', '/api/tracks/id1/unpublish'],
    [() => api.copy('id1'), 'POST', '/api/tracks/id1/copy'], [() => api.deleteTrack('id1'), 'DELETE', '/api/tracks/id1'],
    [() => api.report('id1', 'why'), 'POST', '/api/tracks/id1/report'], [() => api.recoveryCode(), 'GET', '/api/me/recovery'],
    [() => api.deleteMe(), 'DELETE', '/api/me'], [() => api.session(), 'POST', '/api/session'], [() => api.myTracks(), 'GET', '/api/tracks/mine'],
  ]) {
    await fn();
    const c = calls.at(-1);
    assert.deepEqual([c.method, c.url], [method, `https://example.test${path}`]);
  }
});

test('failures become ApiErrors: server messages, rate limits and no connection', async () => {
  const errors = [
    { status: 404, json: { error: { code: 'not_found', message: 'That track was not found.' } } },
    { status: 429, json: { error: { code: 'rate_limited', message: 'Slow down.' } }, retryAfter: '30' },
    { status: 502, json: null },
  ];
  let i = 0;
  const api = createApi({ fetch: recordingFetch(() => errors[i++]).f });
  const e1 = await api.getTrack('x').catch((e) => e);
  assert.ok(e1 instanceof ApiError);
  assert.deepEqual([e1.status, e1.code, e1.message, e1.offline], [404, 'not_found', 'That track was not found.', false]);
  const e2 = await api.like('x').catch((e) => e);
  assert.deepEqual([e2.status, e2.code, e2.retryAfter], [429, 'rate_limited', 30]);
  const e3 = await api.me().catch((e) => e);
  assert.equal(e3.status, 502);
  assert.match(e3.message, /502/);
  const down = createApi({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  const e4 = await down.health().catch((e) => e);
  assert.equal(e4.offline, true);
  assert.equal(e4.code, 'offline');
  assert.match(e4.message, /Can't reach the server/);
});

// ---- the model -----------------------------------------------------------------------------

test('what the app saves is exactly what the server would store (no silent changes)', () => {
  const state = defaultState();
  state.song.progressionText = 'Dm7 G7 | Cmaj7 | Am7 D7';
  state.config = { ...state.config, style: 'blues', swing: 61, loop: false, countIn: false, sounds: { drums: 'rock', keys: 'organ' },
    modulation: { type: 'random', interval: 3, everyLoops: 2, randomMode: 'fifths' }, tempoRamp: { enabled: true, increment: 3, everyLoops: 2, maxBpm: 180 } };
  state.mixer.bass = { volume: 0.33, muted: true };
  const built = buildTrackData(state);
  const stored = prepareTrackData(built);
  assert.deepEqual(stored.data, built, 'sanitising changes nothing about a normal setup');
  assert.equal(setupSignature(stored.data), setupSignature(built));
  assert.ok(!('theme' in built) && !('saved' in built) && !('view' in built));
  // building does not alias the live state
  built.config.sounds.drums = 'jazz';
  assert.equal(state.config.sounds.drums, 'rock');
});

test('the fingerprint changes with every part of the setup, and ignores stray whitespace', () => {
  const base = buildTrackData(defaultState());
  const sig = setupSignature(base);
  const changed = (mut) => { const d = structuredClone(base); mut(d); return setupSignature(d) !== sig; };
  assert.ok(changed((d) => { d.song.progressionText += ' | C7'; }));
  assert.ok(changed((d) => { d.song.key = 'D'; }));
  assert.ok(changed((d) => { d.song.tempo += 1; }));
  assert.ok(changed((d) => { d.song.timeSignature = '7/8'; }));
  assert.ok(changed((d) => { d.config.style = 'rock'; }));
  assert.ok(changed((d) => { d.config.swing += 1; }));
  assert.ok(changed((d) => { d.config.loop = !d.config.loop; }));
  assert.ok(changed((d) => { d.config.countIn = !d.config.countIn; }));
  assert.ok(changed((d) => { d.config.sounds.keys = 'wurli'; }));
  assert.ok(changed((d) => { d.config.modulation.type = 'interval'; }));
  assert.ok(changed((d) => { d.config.tempoRamp.enabled = true; }));
  assert.ok(changed((d) => { d.mixer.drums.muted = true; }));
  assert.ok(changed((d) => { d.mixer.chords.volume = 0.1; }));
  assert.ok(!changed((d) => { d.song.progressionText = `  ${d.song.progressionText}  \n`; }), 'whitespace at the ends is not an edit');
});

test('old browser-only saves become full setups (missing parts take defaults) that the server accepts', () => {
  const item = { id: 'a', name: 'Old', text: 'Am7 | D7 | Gmaj7', key: 'G', timeSignature: '7/8', style: 'blues', tempo: 96, swing: null };
  const data = dataFromLocalSave(item);
  assert.deepEqual([data.v, data.song.key, data.song.tempo, data.song.timeSignature, data.song.progressionText], [1, 'G', 96, '7/8', 'Am7 | D7 | Gmaj7']);
  assert.equal(data.config.style, 'blues');
  assert.equal(data.config.swing, 67, 'no swing saved: the style default');
  assert.deepEqual(data.mixer, defaultState().mixer);
  assert.doesNotThrow(() => prepareTrackData(data));
  assert.equal(dataFromLocalSave({ ...item, swing: 58 }).config.swing, 58);
  assert.equal(dataFromLocalSave({ ...item, style: 'nonsense' }).config.style, 'jazz');
});

// ---- the controller against the real server -----------------------------------------------

test('start-up: offline server, online with no identity, and a returning visitor', withServer(async (server) => {
  const dead = person({ base: 'http://127.0.0.1:1' });
  await dead.tracks.init();
  assert.equal(dead.state().status, 'offline');

  const fresh = person(server);
  await fresh.tracks.init();
  assert.deepEqual([fresh.state().status, fresh.state().me, fresh.state().mine], ['online', null, []]);
  assert.equal(fresh.jar.size, 0, 'looking around sets no cookie');

  await fresh.tracks.save('Something');
  const returning = person(server);
  returning.jar.set('jg_session', fresh.jar.get('jg_session'));
  await returning.tracks.init();
  assert.equal(returning.state().me.displayName, fresh.state().me.displayName);
  assert.deepEqual(returning.state().mine.map((t) => t.title), ['Something']);
}));

test('saving: the first save makes an identity and shows the cookie note once; the same name updates', withServer(async (server) => {
  const storage = new Map();
  const a = person(server, { storage });
  await a.tracks.init();
  a.setSong({ progressionText: 'Em7 | A7 | Dmaj7', tempo: 111 });
  const t = await a.tracks.save('  My   tune ');
  assert.equal(t.title, 'My tune');
  assert.equal(a.state().me.trackCount, 1);
  assert.match(a.state().me.displayName, /^Player-/);
  assert.equal(a.state().cookieNote, true, 'told about the cookie the first time');
  assert.equal(storage.get('jamgym.tracks.note.v1'), '1');
  assert.equal(a.state().flash.text, 'Saved "My tune".');
  assert.equal(a.state().active.id, t.id);
  // saving again under the same name (any case) updates instead of duplicating
  a.setSong({ tempo: 140 });
  const again = await a.tracks.save('MY TUNE');
  assert.equal(again.id, t.id);
  assert.equal(a.state().mine.length, 1);
  assert.equal(a.state().mine[0].tempo, 140);
  assert.match(a.state().flash.text, /^Updated/);
  await a.tracks.save('   ');
  assert.equal(a.state().flash.kind, 'error');
  assert.equal(a.state().mine.length, 1);
  // a second person on the same computer never sees the note twice
  const b = person(server, { storage });
  await b.tracks.init();
  await b.tracks.save('Another');
  assert.equal(b.state().cookieNote, false);
}));

test('a broken setup is refused by the server and the message reaches the user', withServer(async (server) => {
  const a = person(server);
  await a.tracks.init();
  a.setSong({ progressionText: 'Cmaj7 | Xyz' });
  assert.equal(await a.tracks.save('Bad'), null);
  assert.equal(a.state().flash.kind, 'error');
  assert.match(a.state().flash.text, /Bar 2/);
  assert.equal(a.state().mine.length, 0);
}));

test('offline: saving falls back to this device instead of losing the work', async () => {
  const a = person({ base: 'http://127.0.0.1:1' });
  await a.tracks.init();
  const r = await a.tracks.save('Offline tune');
  assert.equal(r, null);
  assert.equal(a.player.saved.length, 1, 'kept locally');
  assert.match(a.state().flash.text, /offline.*saved on this device/i);
  assert.equal(a.state().status, 'offline');
});

test('loading a track restores the ENTIRE setup', withServer(async (server) => {
  const a = person(server);
  await a.tracks.init();
  a.setSong({ progressionText: 'Gm7 | C7 | Fmaj7 Bbmaj7', key: 'F', tempo: 173, timeSignature: '4/4' });
  a.setConfig({ style: 'rock', swing: 57, loop: false, countIn: false, sounds: { drums: 'electronic', keys: 'wurli' },
    modulation: { type: 'interval', interval: -2, everyLoops: 3, randomMode: 'any' }, tempoRamp: { enabled: true, increment: 6, everyLoops: 2, maxBpm: 200 } });
  a.store.set({ mixer: { drums: { volume: 0.2, muted: true }, bass: { volume: 0.9, muted: false }, chords: { volume: 0.45, muted: false } } });
  const saved = await a.tracks.save('Everything');
  const before = structuredClone(buildTrackData(a.store.get()));
  // wreck the state, then load
  a.setSong({ progressionText: 'C', key: 'C', tempo: 60 });
  a.setConfig({ style: 'jazz', swing: 65, loop: true, countIn: true, sounds: { drums: 'auto', keys: 'auto' }, modulation: { type: 'off', interval: 2, everyLoops: 1, randomMode: 'no-repeat' }, tempoRamp: { enabled: false, increment: 5, everyLoops: 2, maxBpm: 220 } });
  a.store.set({ mixer: defaultState().mixer });
  assert.notDeepEqual(buildTrackData(a.store.get()), before);
  const opened = await a.tracks.open(a.state().mine.find((t) => t.id === saved.id));
  assert.ok(opened);
  assert.deepEqual(buildTrackData(a.store.get()), before, 'every part of the setup is back');
  assert.equal(a.state().active.id, saved.id);
  assert.match(a.state().flash.text, /^Loaded "Everything"/);
  assert.equal(a.state().active.signature, setupSignature(buildTrackData(a.store.get())), 'not marked as edited');
  a.setSong({ tempo: 174 });
  assert.notEqual(a.state().active.signature, setupSignature(buildTrackData(a.store.get())), 'now it is');
}));

test('publishing, browsing, liking and copying between two people', withServer(async (server) => {
  const alice = person(server); const bob = person(server);
  await alice.tracks.init(); await bob.tracks.init();
  alice.setSong({ progressionText: 'Cm7 | F7 | Bbmaj7', key: 'Bb' });
  assert.equal(await alice.tracks.rename('Alice'), false, 'no identity yet, so nothing to rename');
  const t = await alice.tracks.save('Shared groove');
  assert.equal(await alice.tracks.rename('Alice'), true);
  assert.equal((await bob.api.browse({})).total, 0, 'private until published');
  await alice.tracks.setPublished(t.id, true);
  assert.equal(alice.state().mine[0].visibility, 'published');
  assert.equal(alice.state().me.publishedCount, 1);
  assert.match(alice.state().flash.text, /now public/);

  // bob browses
  await bob.tracks.setTab('browse');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(bob.state().browse.total, 1);
  const item = bob.state().browse.items[0];
  assert.deepEqual([item.title, item.author, item.likes, item.likedByMe], ['Shared groove', 'Alice', 0, false]);
  // like: the count changes at once and matches the server afterwards
  const pending = bob.tracks.toggleLike(t.id);
  assert.equal(bob.state().browse.items[0].likes, 1, 'optimistic');
  assert.equal(bob.state().browse.items[0].likedByMe, true);
  await pending;
  assert.deepEqual([bob.state().browse.items[0].likes, bob.state().browse.items[0].likedByMe], [1, true]);
  assert.equal((await alice.api.getTrack(t.id)).likes, 1);
  await bob.tracks.toggleLike(t.id);
  assert.equal(bob.state().browse.items[0].likes, 0);
  await bob.tracks.toggleLike(t.id);
  // alice cannot like her own: ignored quietly, no request
  await alice.tracks.refreshMine();
  await alice.tracks.toggleLike(t.id);
  assert.equal(alice.state().mine[0].likes, 1);
  // bob opens it from the list and it plays for him
  const opened = await bob.tracks.open(item, 'browse');
  assert.equal(bob.store.get().song.progressionText, 'Cm7 | F7 | Bbmaj7');
  assert.equal(bob.store.get().song.key, 'Bb');
  assert.equal(opened.author, 'Alice');
  assert.match(bob.state().flash.text, /by Alice/);
  // and saves a private copy
  const copy = await bob.tracks.copy(t.id);
  assert.equal(copy.title, 'Copy of Shared groove');
  assert.deepEqual(bob.state().mine.map((x) => x.title), ['Copy of Shared groove']);
  assert.equal(bob.state().mine[0].visibility, 'private');
}));

test('a failed like is rolled back and explained', async () => {
  const store = createStore({ ...defaultState(), saved: [], activeSaved: null });
  const api = { like: async () => { throw new ApiError(429, 'rate_limited', 'Too many requests.', 12); }, unlike: async () => ({}), me: async () => null };
  const c = createTracksController({ store, player: fakePlayer(store), api, setTimer: () => 0 });
  store.set({ tracks: { ...store.get().tracks, browse: { ...store.get().tracks.browse, items: [{ id: 'x', title: 't', likes: 4, likedByMe: false, isMine: false }], loaded: true } } });
  const p = c.toggleLike('x');
  assert.equal(store.get().tracks.browse.items[0].likes, 5);
  await p;
  assert.deepEqual([store.get().tracks.browse.items[0].likes, store.get().tracks.browse.items[0].likedByMe], [4, false], 'back to how it was');
  assert.equal(store.get().tracks.flash.kind, 'error');
  assert.match(store.get().tracks.flash.text, /Try again in 12 seconds/);
});

test('a slow old search can never overwrite a newer one', async () => {
  const store = createStore({ ...defaultState(), saved: [], activeSaved: null });
  const gates = [];
  const api = { browse: (params) => new Promise((resolve) => gates.push(() => resolve({ items: [{ id: params.q, title: params.q }], total: 1 }))) };
  const c = createTracksController({ store, player: fakePlayer(store), api, setTimer: () => 0 });
  const first = c.search({ q: 'old' });
  const second = c.search({ q: 'new' });
  gates[1]();               // the newer search finishes first
  await second;
  gates[0]();               // then the stale one arrives late
  await first;
  const b = store.get().tracks.browse;
  assert.deepEqual(b.items.map((t) => t.id), ['new']);
  assert.equal(b.params.q, 'new');
  assert.equal(b.loading, false);
});

test('searching by words, chords and filters through the real server, with paging', withServer(async (server) => {
  const a = person(server); const b = person(server);
  await a.tracks.init(); await b.tracks.init();
  for (const [title, text, style, tempo] of [['Blues one', 'C7 | F7 | C7 | G7', 'blues', 80], ['Jazz one', 'Dm7 | G7 | Cmaj7', 'jazz', 140], ['Jazz two', 'Am7 | D7 | Gmaj7', 'jazz', 200]]) {
    a.setSong({ progressionText: text, tempo }); a.setConfig({ style });
    const t = await a.tracks.save(title);
    await a.tracks.setPublished(t.id, true);
  }
  await b.tracks.search({});
  assert.equal(b.state().browse.total, 3);
  await b.tracks.search({ q: 'Dm7' });
  assert.deepEqual(b.state().browse.items.map((t) => t.title), ['Jazz one']);
  await b.tracks.search({ q: '', style: 'jazz', bpmMin: '150' });
  assert.deepEqual(b.state().browse.items.map((t) => t.title), ['Jazz two']);
  await b.tracks.search({ style: '', bpmMin: '', sort: 'new' });
  assert.deepEqual(b.state().browse.items.map((t) => t.title), ['Jazz two', 'Jazz one', 'Blues one']);
  assert.equal(b.state().browse.loading, false);
  assert.equal(b.state().browse.error, null);
}));

test('reports remove a track from the reporter\'s results once it is hidden', withServer(async (server) => {
  const a = person(server);
  await a.tracks.init();
  const t = await a.tracks.save('Bad one');
  await a.tracks.setPublished(t.id, true);
  const reporters = [person(server), person(server), person(server)];
  for (const r of reporters) await r.tracks.init();
  await reporters[0].tracks.search({});
  await reporters[0].tracks.report(t.id, 'spam');
  assert.equal(reporters[0].state().browse.items.length, 1, 'one report is not enough');
  assert.match(reporters[0].state().flash.text, /Thanks/);
  await reporters[1].tracks.report(t.id, 'spam');
  await reporters[2].tracks.search({});
  await reporters[2].tracks.report(t.id, 'spam');
  assert.equal(reporters[2].state().browse.items.length, 0);
  assert.equal(reporters[2].state().browse.total, 0);
}));

test('account: rename, recovery code shown and hidden, recovering on another device, deleting everything', withServer(async (server) => {
  const a = person(server);
  await a.tracks.init();
  await a.tracks.save('Keep');
  assert.equal(await a.tracks.rename('x'), false, 'too short');
  assert.equal(a.state().flash.kind, 'error');
  assert.equal(await a.tracks.rename('Nina'), true);
  assert.equal(a.state().me.displayName, 'Nina');
  assert.equal(a.state().recovery, null);
  await a.tracks.showRecovery();
  const code = a.state().recovery;
  assert.match(code, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  a.tracks.hideRecovery();
  assert.equal(a.state().recovery, null);
  const phone = person(server);
  await phone.tracks.init();
  assert.equal(await phone.tracks.recover('WRONG-CODE'), false);
  assert.equal(await phone.tracks.recover(code), true);
  assert.equal(phone.state().me.displayName, 'Nina');
  assert.deepEqual(phone.state().mine.map((t) => t.title), ['Keep']);
  assert.match(phone.state().flash.text, /Signed in as Nina/);
  assert.equal(await phone.tracks.deleteAccount(), true);
  assert.deepEqual([phone.state().me, phone.state().mine], [null, []]);
  await a.tracks.refreshMine();
  assert.deepEqual(a.state().mine, [], 'the original browser shares the same deleted identity');
}));

test('deleting and unpublishing tracks', withServer(async (server) => {
  const a = person(server); const b = person(server);
  await a.tracks.init(); await b.tracks.init();
  const t = await a.tracks.save('Temp');
  await a.tracks.setPublished(t.id, true);
  await a.tracks.setPublished(t.id, false);
  assert.equal(a.state().mine[0].visibility, 'private');
  assert.match(a.state().flash.text, /private again/);
  assert.equal(await b.tracks.openShared(t.id), null, 'no longer reachable');
  assert.match(b.state().flash.text, /not found/);
  await a.tracks.remove(t.id);
  assert.deepEqual([a.state().mine.length, a.state().active], [0, null]);
  assert.match(a.state().flash.text, /Deleted "Temp"/);
}));

test('a shared link opens the track for a brand new visitor, without giving them a cookie', withServer(async (server) => {
  const a = person(server);
  await a.tracks.init();
  a.setSong({ progressionText: 'Fmaj7 | Bb7 | Em7 A7', tempo: 99 });
  const t = await a.tracks.save('Link me');
  await a.tracks.setPublished(t.id, true);
  const visitor = person(server, { search: `?track=${t.id}` });
  await visitor.tracks.init();
  assert.equal(visitor.store.get().song.progressionText, 'Fmaj7 | Bb7 | Em7 A7');
  assert.equal(visitor.store.get().song.tempo, 99);
  assert.equal(visitor.state().active.id, t.id);
  assert.equal(visitor.jar.size, 0, 'just listening: still no cookie');
  const gone = person(server, { search: '?track=doesNotExist' });
  await gone.tracks.init();
  assert.match(gone.state().flash.text, /not found/);
  assert.equal(a.tracks.shareUrl('abc 1', 'https://jam-gym.eardle.com'), 'https://jam-gym.eardle.com/?track=abc%201');
}));

test('moving the old local list into the library: good ones move, others stay', withServer(async (server) => {
  const a = person(server);
  await a.tracks.init();
  const local = [
    { id: '1', name: 'Fine one', text: 'Cmaj7 | Am7', key: 'C', timeSignature: '4/4', style: 'jazz', tempo: 120, swing: 60 },
    { id: '2', name: 'Fine two', text: 'Am | G | F | E', key: 'A', timeSignature: '10/8', style: 'rock', tempo: 100, swing: null },
    { id: '3', name: 'Broken', text: 'C Dm G', key: 'C', timeSignature: '6/8', style: 'jazz', tempo: 100, swing: null },
  ];
  a.store.set({ saved: local });
  await a.tracks.importLocal();
  assert.deepEqual(a.state().mine.map((t) => t.title).sort(), ['Fine one', 'Fine two']);
  assert.deepEqual(a.store.get().saved.map((s) => s.name), ['Broken'], 'only what could not move stays');
  assert.match(a.state().flash.text, /Moved 2 to your library. 1 could not be moved/);
  const one = a.state().mine.find((t) => t.title === 'Fine one');
  assert.equal((await a.api.getTrack(one.id)).data.config.swing, 60);
  a.store.set({ saved: [] });
  await a.tracks.importLocal();
  assert.equal(a.state().mine.length, 2, 'nothing to move: nothing happens');
}));

test('the tracks state starts out empty and the same every time', () => {
  const s = initialTracksState();
  assert.deepEqual([s.status, s.me, s.mine, s.active, s.tab], ['loading', null, [], null, 'mine']);
  assert.notEqual(initialTracksState().browse, s.browse, 'no shared mutable state between controllers');
});
