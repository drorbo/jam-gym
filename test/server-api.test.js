import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, makeTrack, publishTrack, trackData } from './harness.js';
import { sha256 } from '../server/util.js';
import { createModeration } from '../server/moderation.js';
import { createTracks } from '../server/tracks.js';
import { createUsers } from '../server/users.js';
import { run as runAdmin } from '../server/admin.js';
import { LIMITS } from '../server/config.js';

/** Run a test body against a fresh server, always closing it. */
const withServer = (fn, env) => async () => {
  const s = await startTestServer(env);
  try { await fn(s); } finally { await s.close(); }
};

const cookieOf = (b) => b.jar.get('jg_session');
const searchIds = async (b, qs) => (await b.get(`/api/browse?${qs}`)).json.items.map((t) => t.title);

test('the bass line is stored with the track; junk is repaired, and older tracks without one get the style default', withServer(async ({ browser }) => {
  const b = browser();
  const bass = { rhythm: 'eighths', line: 90, tension: 10, approach: 'enclosure', pattern: 'walk' };
  const r = await b.post('/api/tracks', { title: 'Busy bass', data: trackData({ config: { bass } }) });
  assert.equal(r.status, 201);
  assert.deepEqual((await b.get(`/api/tracks/${r.json.track.id}`)).json.track.data.config.bass, bass);

  const junk = await b.post('/api/tracks', { title: 'Junk bass', data: trackData({ config: { bass: { rhythm: 'polka', line: 'loud', approach: 7 } } }) });
  const fixed = (await b.get(`/api/tracks/${junk.json.track.id}`)).json.track.data.config.bass;
  assert.equal(fixed.rhythm, 'mixed');
  assert.ok(fixed.line >= 0 && fixed.line <= 100 && fixed.approach === 'mixed');

  const old = trackData({ config: { style: 'blues' } });
  delete old.config.bass;
  const o = await b.post('/api/tracks', { title: 'Old blues', data: old });
  assert.equal((await b.get(`/api/tracks/${o.json.track.id}`)).json.track.data.config.bass.pattern, 'mixed', 'the blues default');
}));

// ---- identity ------------------------------------------------------------------------------

test('browsing and reading set no cookie and need no identity', withServer(async ({ browser }) => {
  const b = browser();
  for (const path of ['/api/health', '/api/me', '/api/browse', '/api/tracks/mine']) {
    const r = await b.get(path);
    assert.equal(r.status, 200, path);
    assert.deepEqual(r.setCookies, [], `${path} must not set a cookie`);
  }
  assert.deepEqual((await b.get('/api/me')).json, { me: null });
  assert.deepEqual((await b.get('/api/tracks/mine')).json, { tracks: [] });
  assert.equal(b.jar.size, 0);
}));

test('a session is created on request, with a safe cookie, and the secret is never stored or returned', withServer(async ({ browser, db }) => {
  const b = browser();
  const r = await b.post('/api/session');
  assert.equal(r.status, 200);
  const cookie = r.setCookies[0];
  assert.match(cookie, /^jg_session=[0-9A-Z]{32};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=63072000/);
  assert.doesNotMatch(cookie, /Secure/, 'plain http locally');
  assert.match(r.json.me.id, /^[0-9A-Z]{8}$/);
  assert.match(r.json.me.displayName, /^Player-[0-9A-Z]{4}$/);
  const secret = cookieOf(b);
  assert.ok(!JSON.stringify(r.json).includes(secret), 'the body never contains the secret');
  const row = db.prepare('SELECT * FROM users').get();
  assert.equal(row.secret_hash, sha256(secret), 'only the hash is stored');
  assert.ok(!Object.values(row).includes(secret));
  // asking again with the cookie changes nothing
  const again = await b.post('/api/session');
  assert.equal(again.json.me.id, r.json.me.id);
  assert.deepEqual(again.setCookies, []);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
}));

test('behind the proxy the cookie is Secure, and the real client address is used for limits', withServer(async ({ browser }) => {
  const b = browser({ 'X-Forwarded-Proto': 'https' });
  const r = await b.post('/api/session');
  assert.match(r.setCookies[0], /; Secure/);
  // a different client IP (as Cloudflare reports it) gets its own allowance
  const a = browser({ 'CF-Connecting-IP': '203.0.113.1' });
  const c = browser({ 'CF-Connecting-IP': '203.0.113.2' });
  for (let i = 0; i < 10; i++) assert.equal((await browser({ 'CF-Connecting-IP': '203.0.113.1' }).post('/api/session')).status, 200);
  assert.equal((await a.post('/api/session')).status, 429, 'IP 1 has used its 10 new identities');
  assert.equal((await c.post('/api/session')).status, 200, 'IP 2 is unaffected');
}, { TRUST_PROXY: '1' }));

test('without the proxy setting, forwarded headers are ignored (they can be forged)', withServer(async ({ browser }) => {
  const b = browser({ 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': '1.2.3.4' });
  assert.doesNotMatch((await b.post('/api/session')).setCookies[0], /Secure/);
}));

test('saving something creates the identity automatically; reading a private track does not', withServer(async ({ browser }) => {
  const b = browser();
  const r = await b.post('/api/tracks', { title: 'First', data: trackData() });
  assert.equal(r.status, 201);
  assert.match(r.setCookies[0], /jg_session=/);
  assert.equal((await b.get('/api/me')).json.me.trackCount, 1);
}));

test('/api/me refreshes the cookie so regular visitors stay signed in', withServer(async ({ browser }) => {
  const b = browser();
  await b.post('/api/session');
  const r = await b.get('/api/me');
  assert.match(r.setCookies[0], /Max-Age=63072000/);
}));

test('a made-up or malformed cookie is simply "no identity"', withServer(async ({ browser }) => {
  for (const value of ['nonsense', 'A'.repeat(32), '', 'x'.repeat(500)]) {
    const b = browser({ Cookie: `jg_session=${value}` });
    assert.deepEqual((await b.get('/api/me')).json, { me: null }, value);
    assert.equal((await b.get('/api/tracks/mine')).status, 200);
  }
  const b = browser({ Cookie: 'jg_session=nonsense' });
  assert.equal((await b.patch('/api/me', { displayName: 'x' })).status, 401);
}));

test('display names: cleaned, length-limited, and reflected on published tracks and in search', withServer(async ({ browser }) => {
  const a = browser();
  const t = await publishTrack(a, { title: 'Rename me' });
  const before = (await a.get('/api/me')).json.me.displayName;
  assert.equal(t.author, before);
  assert.equal((await a.patch('/api/me', { displayName: 'x' })).status, 400);
  assert.equal((await a.patch('/api/me', { displayName: '   ' })).status, 400);
  assert.equal((await a.patch('/api/me', {})).status, 400);
  const r = await a.patch('/api/me', { displayName: '  Miles   Davis  the third and a bit ' });
  assert.equal(r.status, 200);
  assert.equal([...r.json.me.displayName].length, 24);
  assert.equal(r.json.me.displayName, 'Miles Davis the third an');
  await a.patch('/api/me', { displayName: 'Coltrane' });
  const found = (await browser().get('/api/browse?q=coltrane')).json.items;
  assert.equal(found.length, 1);
  assert.equal(found[0].author, 'Coltrane');
  assert.equal((await browser().get(`/api/browse?q=${encodeURIComponent(before)}`)).json.total, 0, 'the old name no longer finds it');
}));

test('recovery code: another browser can take over the identity; wrong codes are refused', withServer(async ({ browser }) => {
  const a = browser();
  const t = await makeTrack(a, { title: 'Mine' });
  assert.equal((await browser().get('/api/me/recovery')).status, 401, 'no cookie, no code');
  const { code } = (await a.get('/api/me/recovery')).json;
  assert.match(code, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  const b = browser();
  assert.equal((await b.post('/api/me/recover', { code: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA' })).status, 404);
  assert.equal((await b.post('/api/me/recover', { code: '' })).status, 404);
  assert.equal((await b.post('/api/me/recover', {})).status, 404);
  assert.equal(b.jar.size, 0, 'a failed attempt sets no cookie');
  const ok = await b.post('/api/me/recover', { code: code.toLowerCase().replace(/-/g, ' ') }); // typed sloppily
  assert.equal(ok.status, 200);
  assert.equal(cookieOf(b), cookieOf(a));
  assert.deepEqual((await b.get('/api/tracks/mine')).json.tracks.map((x) => x.id), [t.id]);
}));

test('deleting my data removes everything and keeps other people\'s like counts right', withServer(async ({ browser, db }) => {
  const a = browser(); const b = browser();
  const ta = await publishTrack(a, { title: 'A song' });
  await b.put(`/api/tracks/${ta.id}/like`);
  const tb = await publishTrack(b, { title: 'B song' });
  await a.put(`/api/tracks/${tb.id}/like`);
  assert.equal((await b.get(`/api/tracks/${tb.id}`)).json.track.likes, 1);
  const r = await a.del('/api/me');
  assert.equal(r.status, 200);
  assert.equal(a.jar.size, 0, 'cookie cleared');
  assert.match(r.setCookies[0], /Max-Age=0/);
  assert.equal((await b.get(`/api/tracks/${ta.id}`)).status, 404);
  assert.equal((await b.get(`/api/tracks/${tb.id}`)).json.track.likes, 0, 'A\'s like on B is gone and uncounted');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM likes').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM track_search WHERE rowid IN (SELECT rowid FROM tracks)').get().c, 1, 'only B\'s track is indexed');
  assert.equal((await browser().get('/api/browse?q=song')).json.total, 1);
}));

// ---- CSRF and request hygiene ---------------------------------------------------------------

test('state-changing requests must carry the X-JG header and come from our own origin', withServer(async ({ browser, base }) => {
  const b = browser();
  await b.post('/api/session');
  const cookie = `jg_session=${cookieOf(b)}`;
  const body = JSON.stringify({ title: 't', data: trackData() });
  const post = (headers) => b.raw('POST', '/api/tracks', { headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body });
  assert.equal((await post({})).status, 403, 'no X-JG header (a plain cross-site form post)');
  assert.equal((await post({ 'X-JG': '1', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ 'X-JG': '1', Origin: 'null' })).status, 403, 'sandboxed frames send Origin: null');
  assert.equal((await post({ 'X-JG': '1', Origin: 'not a url' })).status, 403);
  assert.equal((await post({ 'X-JG': '1', Origin: base })).status, 201, 'our own origin is fine');
  assert.equal((await post({ 'X-JG': '1' })).status, 201, 'no Origin header (same-site fetch, curl) is fine');
  assert.equal((await b.raw('GET', '/api/me', { headers: { Cookie: cookie } })).status, 200, 'reads need no header');
  assert.equal((await b.raw('DELETE', '/api/me', { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await b.raw('PUT', '/api/tracks/x/like', { headers: { Cookie: cookie } })).status, 403);
}));

test('bad bodies get clear errors, not crashes', withServer(async ({ browser }) => {
  const b = browser();
  const send = (body, type = 'application/json') => b.raw('POST', '/api/tracks', { headers: { 'X-JG': '1', 'Content-Type': type }, body });
  assert.equal((await send('{not json')).status, 400);
  assert.equal((await send('[]')).status, 400);
  assert.equal((await send('null')).status, 400);
  assert.equal((await send('"text"')).status, 400);
  assert.equal((await send('{"a":1}', 'text/plain')).status, 400, 'a body that is not declared JSON is refused');
  assert.equal((await send(JSON.stringify({ title: 'x', data: trackData(), pad: 'z'.repeat(40000) }))).status, 413);
  const big = await send(JSON.stringify({ pad: 'z'.repeat(40000) }));
  assert.equal(big.json.error.code, 'too_large');
  // and the server is still fine afterwards
  assert.equal((await b.get('/api/health')).status, 200);
}));

test('unknown and wrong-method API requests answer with JSON errors', withServer(async ({ browser }) => {
  const b = browser();
  const r = await b.get('/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, 'not_found');
  assert.equal((await b.del('/api/browse')).status, 405);
  assert.equal((await b.put('/api/me', {})).status, 405);
  assert.match(r.headers.get('cache-control'), /no-store/, 'API responses are never cached');
}));

// ---- tracks: create, read, update, delete ---------------------------------------------------

test('creating a track stores the whole setup privately', withServer(async ({ browser }) => {
  const a = browser();
  const data = trackData({
    song: { progressionText: 'Dm7 G7 | Cmaj7 | A7', key: 'C', tempo: 144, timeSignature: '4/4' },
    config: { style: 'blues', swing: 61, sounds: { drums: 'rock', keys: 'organ' }, modulation: { type: 'interval', interval: 5, everyLoops: 2, randomMode: 'shuffle' }, tempoRamp: { enabled: true, increment: 4, everyLoops: 3, maxBpm: 180 }, loop: false, countIn: false },
    mixer: { drums: { volume: 0.4, muted: true }, bass: { volume: 0.9, muted: false }, chords: { volume: 0.5, muted: false } },
  });
  const r = await a.post('/api/tracks', { title: '  My   groove  ', description: 'Slow it down first.', data });
  assert.equal(r.status, 201);
  const t = r.json.track;
  assert.match(t.id, /^[0-9A-Za-z]{10}$/);
  assert.equal(t.title, 'My groove');
  assert.equal(t.visibility, 'private');
  assert.equal(t.isMine, true);
  assert.deepEqual([t.style, t.key, t.timeSignature, t.tempo, t.bars, t.likes], ['blues', 'C', '4/4', 144, 3, 0]);
  assert.deepEqual(t.chords, ['Dm7', 'G7', 'Cmaj7', 'A7']);
  // "everything" comes back exactly as it was saved
  assert.equal(t.data.song.progressionText, 'Dm7 G7 | Cmaj7 | A7');
  assert.deepEqual(t.data.config.sounds, { drums: 'rock', keys: 'organ' });
  assert.equal(t.data.config.swing, 61);
  assert.equal(t.data.config.loop, false);
  assert.equal(t.data.config.countIn, false);
  assert.deepEqual(t.data.config.modulation, { type: 'interval', interval: 5, everyLoops: 2, randomMode: 'shuffle' });
  assert.deepEqual(t.data.config.tempoRamp, { enabled: true, increment: 4, everyLoops: 3, maxBpm: 180 });
  assert.deepEqual(t.data.mixer.drums, { volume: 0.4, muted: true });
  const got = (await a.get(`/api/tracks/${t.id}`)).json.track;
  assert.deepEqual(got.data, t.data);
}));

test('invalid tracks are refused with a message that says what is wrong', withServer(async ({ browser }) => {
  const a = browser();
  const post = (body) => a.post('/api/tracks', body);
  const r1 = await post({ title: 'x', data: trackData({ song: { progressionText: 'C | Xyz' } }) });
  assert.equal(r1.status, 400);
  assert.match(r1.json.error.message, /Bar 2/);
  assert.equal((await post({ title: '   ', data: trackData() })).status, 400);
  assert.equal((await post({ data: trackData() })).status, 400);
  assert.equal((await post({ title: 'x' })).status, 400);
  assert.equal((await post({ title: 'x', data: { v: 1 } })).status, 400);
  assert.equal((await post({ title: 'x', data: 'C | F' })).status, 400);
  assert.equal((await a.get('/api/tracks/mine')).json.tracks.length, 0, 'nothing was stored');
}));

test('titles and descriptions are truncated, and markup is stored as plain text', withServer(async ({ browser }) => {
  const a = browser();
  const t = await makeTrack(a, { title: `<img src=x onerror=alert(1)>${'y'.repeat(200)}`, description: '<b>hi</b>\n\n\n\nbye' });
  assert.equal([...t.title].length, LIMITS.title);
  assert.ok(t.title.startsWith('<img src=x onerror=alert(1)>'), 'kept as text: the UI shows it with textContent');
  assert.equal(t.description, '<b>hi</b>\n\nbye');
}));

test('my tracks: only mine, newest first', withServer(async ({ browser }) => {
  const a = browser(); const b = browser();
  const one = await makeTrack(a, { title: 'one' });
  await new Promise((r) => setTimeout(r, 5));
  const two = await makeTrack(a, { title: 'two' });
  await makeTrack(b, { title: 'not mine' });
  assert.deepEqual((await a.get('/api/tracks/mine')).json.tracks.map((t) => t.id), [two.id, one.id]);
  assert.ok((await a.get('/api/tracks/mine')).json.tracks.every((t) => t.visibility === 'private' && !('data' in t)), 'lists carry no payload');
}));

test('private tracks are invisible to everyone else, and indistinguishable from missing ones', withServer(async ({ browser }) => {
  const a = browser(); const b = browser();
  const t = await makeTrack(a, { title: 'secret' });
  await b.post('/api/session');
  const other = await b.get(`/api/tracks/${t.id}`);
  const missing = await b.get('/api/tracks/doesNotExist');
  const anon = await browser().get(`/api/tracks/${t.id}`);
  for (const r of [other, missing, anon]) assert.equal(r.status, 404);
  assert.deepEqual(other.json, missing.json, 'same answer, so ids cannot be probed');
  for (const r of [await b.put(`/api/tracks/${t.id}`, { title: 'hax' }), await b.del(`/api/tracks/${t.id}`), await b.post(`/api/tracks/${t.id}/publish`), await b.post(`/api/tracks/${t.id}/copy`)]) {
    assert.equal(r.status, 404);
  }
  assert.equal((await a.get(`/api/tracks/${t.id}`)).json.track.title, 'secret', 'untouched');
}));

test('updating: title, description and the setup; invalid updates change nothing', withServer(async ({ browser }) => {
  const a = browser();
  const t = await makeTrack(a, { title: 'Old', description: 'd' });
  const r = await a.put(`/api/tracks/${t.id}`, { title: 'New', data: trackData({ song: { progressionText: 'Am7 | D7 | Gmaj7', tempo: 90 }, config: { style: 'rock' } }) });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.track.title, r.json.track.description, r.json.track.tempo, r.json.track.style, r.json.track.bars], ['New', 'd', 90, 'rock', 3]);
  assert.deepEqual(r.json.track.chords, ['Am7', 'D7', 'Gmaj7']);
  const bad = await a.put(`/api/tracks/${t.id}`, { data: trackData({ song: { progressionText: 'Nope' } }) });
  assert.equal(bad.status, 400);
  assert.equal((await a.put(`/api/tracks/${t.id}`, { title: '  ' })).status, 400);
  const after = (await a.get(`/api/tracks/${t.id}`)).json.track;
  assert.equal(after.title, 'New');
  assert.equal(after.tempo, 90);
  assert.equal((await a.put('/api/tracks/nope', { title: 'x' })).status, 404);
  const partial = await a.put(`/api/tracks/${t.id}`, { description: 'only this' });
  assert.deepEqual([partial.json.track.title, partial.json.track.description, partial.json.track.tempo], ['New', 'only this', 90]);
}));

test('deleting a track removes it, its likes and its search entry', withServer(async ({ browser, db }) => {
  const a = browser(); const b = browser();
  const t = await publishTrack(a, { title: 'Doomed' });
  await b.put(`/api/tracks/${t.id}/like`);
  assert.equal((await a.del(`/api/tracks/${t.id}`)).status, 200);
  assert.equal((await a.get(`/api/tracks/${t.id}`)).status, 404);
  assert.equal((await a.del(`/api/tracks/${t.id}`)).status, 404, 'already gone');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM likes').get().c, 0);
  assert.equal((await browser().get('/api/browse?q=doomed')).json.total, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM track_search').get().c, 0);
}));

test('limits: a per-user track cap and a published cap, and rate limits with Retry-After', withServer(async ({ browser, db }) => {
  const a = browser();
  await a.post('/api/session');
  const uid = db.prepare('SELECT id FROM users').get().id;
  const data = JSON.stringify(trackData());
  const ins = db.prepare(`INSERT INTO tracks(id, owner_id, title, data, style, key, time_signature, tempo, bars, chords, visibility, created_at, updated_at)
                          VALUES (?, ?, 't', ?, 'jazz', 'C', '4/4', 120, 1, 'C', ?, 1, 1)`);
  for (let i = 0; i < LIMITS.publishedPerUser; i++) ins.run(`pub${i}`, uid, data, 'published');
  for (let i = 0; i < LIMITS.tracksPerUser - LIMITS.publishedPerUser; i++) ins.run(`prv${i}`, uid, data, 'private');
  const full = await a.post('/api/tracks', { title: 'one too many', data: trackData() });
  assert.equal(full.status, 409);
  assert.equal(full.json.error.code, 'limit_reached');
  assert.equal((await a.post('/api/tracks/prv1/publish')).status, 409, 'too many published');
  assert.equal((await a.del('/api/tracks/prv2')).status, 200);
  assert.equal((await a.post('/api/tracks', { title: 'now there is room', data: trackData() })).status, 201);
}));

test('creating tracks is rate limited', withServer(async ({ browser }) => {
  const a = browser();
  let last;
  for (let i = 0; i < 31; i++) last = await a.post('/api/tracks', { title: `t${i}`, data: trackData() });
  assert.equal(last.status, 429);
  assert.equal(last.json.error.code, 'rate_limited');
  assert.ok(Number(last.headers.get('retry-after')) >= 1);
}));

// ---- publishing, copying --------------------------------------------------------------------

test('publishing makes a track visible to everyone; unpublishing hides it again', withServer(async ({ browser }) => {
  const a = browser(); const b = browser(); const anon = browser();
  const t = await makeTrack(a, { title: 'Public soon' });
  assert.equal((await b.get('/api/browse')).json.total, 0);
  const p = await a.post(`/api/tracks/${t.id}/publish`);
  assert.equal(p.status, 200);
  assert.equal(p.json.track.visibility, 'published');
  assert.ok(p.json.track.publishedAt > 0);
  for (const viewer of [b, anon]) {
    const r = await viewer.get(`/api/tracks/${t.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.track.data.song.progressionText, 'Cmaj7 | Am7 | Dm7 | G7', 'anyone can open the full setup');
    assert.equal(r.json.track.isMine, false);
    assert.ok(!('visibility' in r.json.track), 'only the owner sees the visibility');
  }
  assert.equal((await b.get('/api/browse')).json.total, 1);
  assert.equal((await a.post(`/api/tracks/${t.id}/publish`)).status, 200, 'publishing twice is fine');
  const u = await a.post(`/api/tracks/${t.id}/unpublish`);
  assert.equal(u.json.track.visibility, 'private');
  assert.equal((await b.get(`/api/tracks/${t.id}`)).status, 404);
  assert.equal((await b.get('/api/browse')).json.total, 0);
  assert.equal((await a.get(`/api/tracks/${t.id}`)).status, 200, 'still mine');
}));

test('editing a published track updates what the public sees and finds', withServer(async ({ browser }) => {
  const a = browser(); const b = browser();
  const t = await publishTrack(a, { title: 'Before' });
  await a.put(`/api/tracks/${t.id}`, { title: 'Afterwards', data: trackData({ song: { progressionText: 'Gm7 | C7 | Fmaj7', tempo: 101 } }) });
  assert.equal((await b.get('/api/browse?q=before')).json.total, 0);
  assert.equal((await b.get('/api/browse?q=afterwards')).json.total, 1);
  assert.equal((await b.get('/api/browse?q=Gm7')).json.total, 1, 'the new chords are searchable');
  assert.equal((await b.get('/api/browse?q=Am7')).json.total, 0, 'the old chords are not');
  assert.equal((await b.get(`/api/tracks/${t.id}`)).json.track.data.song.tempo, 101);
}));

test('copying saves a private duplicate into my library without touching the original', withServer(async ({ browser }) => {
  const a = browser(); const b = browser();
  const orig = await publishTrack(a, { title: 'Original', song: { progressionText: 'Em7 | A7 | Dmaj7', tempo: 111 } });
  await b.put(`/api/tracks/${orig.id}/like`);
  const r = await b.post(`/api/tracks/${orig.id}/copy`);
  assert.equal(r.status, 201);
  const c = r.json.track;
  assert.notEqual(c.id, orig.id);
  assert.equal(c.title, 'Copy of Original');
  assert.equal(c.visibility, 'private');
  assert.equal(c.likes, 0, 'likes do not travel');
  assert.deepEqual(c.data, (await a.get(`/api/tracks/${orig.id}`)).json.track.data);
  assert.deepEqual((await b.get('/api/tracks/mine')).json.tracks.map((t) => t.id), [c.id]);
  assert.equal((await a.get('/api/tracks/mine')).json.tracks.length, 1, 'the author gained nothing');
  assert.equal((await a.get(`/api/tracks/${orig.id}`)).json.track.likes, 1, 'original unchanged');
  const priv = await makeTrack(a, { title: 'private one' });
  assert.equal((await b.post(`/api/tracks/${priv.id}/copy`)).status, 404, 'cannot copy what you cannot see');
  assert.equal((await a.post(`/api/tracks/${priv.id}/copy`)).status, 201, 'but you can copy your own');
  const long = await publishTrack(a, { title: 'y'.repeat(80) });
  assert.equal([...(await b.post(`/api/tracks/${long.id}/copy`)).json.track.title].length, LIMITS.title);
}));

// ---- browse and search ----------------------------------------------------------------------

async function seedLibrary({ browser }) {
  const people = { a: browser(), b: browser(), c: browser() };
  await people.a.patch('/api/me', { displayName: 'Alice' }).catch(() => {});
  await people.a.post('/api/session'); await people.a.patch('/api/me', { displayName: 'Alice' });
  await people.b.post('/api/session'); await people.b.patch('/api/me', { displayName: 'Bob' });
  await people.c.post('/api/session'); await people.c.patch('/api/me', { displayName: 'Carol' });
  const tracks = {
    autumn: await publishTrack(people.a, { title: 'Autumn Leaves practice', description: 'a classic ii V I in minor', song: { progressionText: 'Cm7 | F7 | Bbmaj7 | Ebmaj7', key: 'Bb', tempo: 120 }, config: { style: 'jazz' } }),
    blues: await publishTrack(people.a, { title: 'Slow blues in A', song: { progressionText: 'A7 | D7 | A7 | A7 | D7 | D7 | A7 | E7', key: 'A', tempo: 70 }, config: { style: 'blues' } }),
    rock: await publishTrack(people.b, { title: 'Stadium rock riff', description: 'power chords', song: { progressionText: 'Am | G | F | E', key: 'A', tempo: 150 }, config: { style: 'rock' } }),
    waltz: await publishTrack(people.b, { title: 'Odd meter groove', song: { progressionText: 'Am7 | Dm7 | E7 | Am7', key: 'A', tempo: 132, timeSignature: '7/8' }, config: { style: 'jazz' } }),
    major7: await publishTrack(people.c, { title: 'Sunny major seventh', song: { progressionText: 'CM7 | Am7 | Dm7 | G7', key: 'C', tempo: 100 }, config: { style: 'jazz' } }),
    minor7: await publishTrack(people.c, { title: 'Moody minor seventh', song: { progressionText: 'Cm7 | Fm7 | Bb7 | Ebmaj7', key: 'C', tempo: 95 }, config: { style: 'jazz' } }),
  };
  await makeTrack(people.c, { title: 'Never published' });
  return { people, tracks };
}

test('browse lists published tracks only, without payloads, most liked first', withServer(async (s) => {
  const { people, tracks } = await seedLibrary(s);
  await people.b.put(`/api/tracks/${tracks.autumn.id}/like`);
  await people.c.put(`/api/tracks/${tracks.autumn.id}/like`);
  await people.a.put(`/api/tracks/${tracks.rock.id}/like`);
  const r = (await s.browser().get('/api/browse')).json;
  assert.equal(r.total, 6);
  assert.equal(r.items.length, 6);
  assert.deepEqual(r.items.slice(0, 2).map((t) => [t.title, t.likes]), [['Autumn Leaves practice', 2], ['Stadium rock riff', 1]]);
  assert.ok(r.items.every((t) => !('data' in t) && !('visibility' in t) && t.title !== 'Never published'));
  const shape = r.items[0];
  for (const k of ['id', 'title', 'description', 'author', 'style', 'key', 'timeSignature', 'tempo', 'bars', 'chords', 'likes', 'likedByMe', 'isMine', 'publishedAt']) assert.ok(k in shape, k);
  assert.ok(!JSON.stringify(r).includes('secret'), 'no secrets in listings');
}));

test('sorting: newest first, and ties among equal likes fall back to newest', withServer(async (s) => {
  await seedLibrary(s);
  const newest = await searchIds(s.browser(), 'sort=new');
  assert.equal(newest[0], 'Moody minor seventh');
  assert.equal(newest.at(-1), 'Autumn Leaves practice');
  const liked = await searchIds(s.browser(), 'sort=likes');
  assert.deepEqual(liked, newest, 'with no likes anywhere, "most liked" is newest first');
}));

test('search by words in the title, description or author name (prefix, all words must match)', withServer(async (s) => {
  await seedLibrary(s);
  const b = s.browser();
  assert.deepEqual(await searchIds(b, 'q=autumn'), ['Autumn Leaves practice']);
  assert.deepEqual(await searchIds(b, 'q=AUTUM'), ['Autumn Leaves practice'], 'case-insensitive prefix');
  assert.deepEqual(await searchIds(b, 'q=classic'), ['Autumn Leaves practice'], 'description');
  assert.deepEqual((await searchIds(b, 'q=alice')).sort(), ['Autumn Leaves practice', 'Slow blues in A'], 'author name');
  assert.deepEqual(await searchIds(b, 'q=alice+blues'), ['Slow blues in A'], 'words are ANDed');
  assert.deepEqual(await searchIds(b, 'q=blues+rock'), []);
  assert.deepEqual(await searchIds(b, 'q=zzzz'), []);
  assert.deepEqual(await searchIds(b, 'q=slow+blues+in+A'), ['Slow blues in A'], 'a bare "A" is a word, not a chord');
  assert.equal((await b.get('/api/browse?q=alice')).json.total, 2);
}));

test('search by chord: matches the chord\'s content however it is written', withServer(async (s) => {
  await seedLibrary(s);
  const b = s.browser();
  assert.deepEqual((await searchIds(b, 'q=Am7')).sort(), ['Moody minor seventh', 'Odd meter groove', 'Sunny major seventh'].filter((t) => t !== 'Moody minor seventh').sort());
  assert.deepEqual(await searchIds(b, 'q=E7'), ['Odd meter groove', 'Slow blues in A'].sort().reverse().sort());
  // Cm7 finds minor sevenths (also as "C-7"), not major sevenths, and CM7 is the other way round
  const minor = (await searchIds(b, 'q=Cm7')).sort();
  assert.deepEqual(minor, ['Autumn Leaves practice', 'Moody minor seventh']);
  assert.deepEqual((await searchIds(b, 'q=C-7')).sort(), minor);
  assert.deepEqual(await searchIds(b, 'q=Cmaj7'), ['Sunny major seventh']);
  assert.deepEqual(await searchIds(b, 'q=CM7'), ['Sunny major seventh']);
  // several chords: all must be present, in any order
  assert.deepEqual(await searchIds(b, 'q=Cm7+F7'), ['Autumn Leaves practice']);
  assert.deepEqual(await searchIds(b, 'q=F7+Cm7'), ['Autumn Leaves practice']);
  assert.deepEqual(await searchIds(b, 'q=Cm7+F7+D7'), []);
  // a chord together with a word
  assert.deepEqual(await searchIds(b, 'q=Cm7+moody'), ['Moody minor seventh']);
  assert.deepEqual(await searchIds(b, 'q=Cm7+sunny'), []);
  assert.deepEqual(await searchIds(b, 'q=Ebmaj7+Bb7'), ['Moody minor seventh']);
}));

test('filters: style, time signature, key and tempo range, alone and combined', withServer(async (s) => {
  await seedLibrary(s);
  const b = s.browser();
  assert.deepEqual((await searchIds(b, 'style=blues')), ['Slow blues in A']);
  assert.deepEqual((await searchIds(b, 'style=rock')), ['Stadium rock riff']);
  assert.equal((await b.get('/api/browse?style=jazz')).json.total, 4);
  assert.deepEqual(await searchIds(b, 'meter=7/8'), ['Odd meter groove']);
  assert.equal((await b.get('/api/browse?meter=4/4')).json.total, 5);
  assert.deepEqual((await searchIds(b, 'key=Bb')), ['Autumn Leaves practice']);
  assert.deepEqual((await searchIds(b, 'bpmMin=130')).sort(), ['Odd meter groove', 'Stadium rock riff']);
  assert.deepEqual((await searchIds(b, 'bpmMax=80')), ['Slow blues in A']);
  assert.deepEqual((await searchIds(b, 'bpmMin=95&bpmMax=100')).sort(), ['Moody minor seventh', 'Sunny major seventh']);
  assert.deepEqual(await searchIds(b, 'style=jazz&bpmMin=110&q=leaves'), ['Autumn Leaves practice']);
  assert.deepEqual(await searchIds(b, 'style=rock&meter=7/8'), []);
  assert.equal((await b.get('/api/browse?style=polka')).json.total, 0);
}));

test('pagination: pages, totals, and clamped limits', withServer(async (s) => {
  await seedLibrary(s);
  const b = s.browser();
  const p1 = (await b.get('/api/browse?limit=4&sort=new')).json;
  const p2 = (await b.get('/api/browse?limit=4&offset=4&sort=new')).json;
  assert.deepEqual([p1.total, p1.items.length, p2.items.length], [6, 4, 2]);
  assert.equal(new Set([...p1.items, ...p2.items].map((t) => t.id)).size, 6, 'no repeats or gaps');
  assert.equal((await b.get('/api/browse?limit=999')).json.limit, 50);
  assert.equal((await b.get('/api/browse?offset=99')).json.items.length, 0);
  assert.equal((await b.get('/api/browse?limit=abc&offset=xyz')).json.items.length, 6);
}));

test('hostile search strings never break the query or leak anything', withServer(async (s) => {
  await seedLibrary(s);
  const b = s.browser();
  const attacks = ['"', '""', '" OR 1=1 --', "'; DROP TABLE tracks; --", 'title:*', 'NEAR(a b)', '* * *', '-evil', '{title}:x', '(((', 'a AND', '\u0000', '%00', 'ünïcödé', '🎸', 'x'.repeat(5000), 'a '.repeat(300)];
  for (const q of attacks) {
    const r = await b.get(`/api/browse?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, `q=${q.slice(0, 20)}`);
    assert.ok(Array.isArray(r.json.items));
  }
  assert.equal((await b.get('/api/browse')).json.total, 6, 'nothing was harmed');
  const r = await b.get('/api/browse?style=%27%20OR%201%3D1%20--&key=%22&meter=%25');
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 0);
  assert.equal((await b.get('/api/browse?bpmMin=1e9&bpmMax=-5')).status, 200);
}));

test('likedByMe and isMine reflect the viewer', withServer(async (s) => {
  const { people, tracks } = await seedLibrary(s);
  await people.b.put(`/api/tracks/${tracks.autumn.id}/like`);
  const as = async (b) => Object.fromEntries((await b.get('/api/browse')).json.items.map((t) => [t.title, [t.likedByMe, t.isMine]]));
  assert.deepEqual((await as(people.b))['Autumn Leaves practice'], [true, false]);
  assert.deepEqual((await as(people.b))['Stadium rock riff'], [false, true]);
  assert.deepEqual((await as(people.a))['Autumn Leaves practice'], [false, true]);
  assert.deepEqual((await as(s.browser()))['Autumn Leaves practice'], [false, false], 'anonymous visitors like nothing');
}));

// ---- likes ---------------------------------------------------------------------------------

test('liking: one per person, idempotent, reversible', withServer(async ({ browser }) => {
  const a = browser(); const b = browser();
  const t = await publishTrack(a, { title: 'Likeable' });
  const like = () => b.put(`/api/tracks/${t.id}/like`);
  assert.deepEqual((await like()).json, { likes: 1, likedByMe: true });
  assert.deepEqual((await like()).json, { likes: 1, likedByMe: true }, 'liking twice does not count twice');
  assert.deepEqual((await like()).json, { likes: 1, likedByMe: true });
  assert.equal((await browser().get(`/api/tracks/${t.id}`)).json.track.likes, 1);
  assert.deepEqual((await b.del(`/api/tracks/${t.id}/like`)).json, { likes: 0, likedByMe: false });
  assert.deepEqual((await b.del(`/api/tracks/${t.id}/like`)).json, { likes: 0, likedByMe: false }, 'unliking twice never goes negative');
}));

test('likes: not your own track, not private ones, not missing ones; anyone can like after an automatic session', withServer(async ({ browser }) => {
  const a = browser(); const b = browser();
  const pub = await publishTrack(a, { title: 'mine' });
  const priv = await makeTrack(a, { title: 'private' });
  const own = await a.put(`/api/tracks/${pub.id}/like`);
  assert.equal(own.status, 403);
  assert.equal(own.json.error.code, 'own_track');
  assert.equal((await b.put(`/api/tracks/${priv.id}/like`)).status, 404);
  assert.equal((await b.put('/api/tracks/nothing/like')).status, 404);
  const fresh = browser();
  assert.equal((await fresh.put(`/api/tracks/${pub.id}/like`)).status, 200);
  assert.ok(fresh.jar.has('jg_session'), 'liking created the identity');
  assert.equal((await browser().del(`/api/tracks/${pub.id}/like`)).status, 401, 'unliking needs an existing identity');
}));

test('likes survive unpublishing and come back with the track', withServer(async ({ browser }) => {
  const a = browser(); const b = browser();
  const t = await publishTrack(a);
  await b.put(`/api/tracks/${t.id}/like`);
  await a.post(`/api/tracks/${t.id}/unpublish`);
  assert.equal((await b.put(`/api/tracks/${t.id}/like`)).status, 404, 'cannot like a track that is not public');
  await a.post(`/api/tracks/${t.id}/publish`);
  const back = (await browser().get(`/api/tracks/${t.id}`)).json.track;
  assert.equal(back.likes, 1);
  assert.equal((await b.get(`/api/tracks/${t.id}`)).json.track.likedByMe, true);
}));

test('the like counter always equals the real number of likes (randomised, including deleted users)', withServer(async ({ db }) => {
  const users = createUsers(db);
  const tracks = createTracks(db);
  const owner = users.create().user;
  const mine = [];
  for (let i = 0; i < 3; i++) {
    const t = tracks.create(owner, { title: `t${i}`, data: trackData() });
    tracks.publish(owner, t.id);
    mine.push(t.id);
  }
  const pool = Array.from({ length: 6 }, () => users.create().user);
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let maxLikes = 0;
  for (let i = 0; i < 1500; i++) {
    const slot = rnd(pool.length);
    const t = mine[rnd(mine.length)];
    const r = rnd(20);
    if (r === 0) { users.deleteUser(pool[slot]); pool[slot] = users.create().user; }
    else if (r < 12) tracks.like(pool[slot], t);
    else tracks.unlike(pool[slot], t);
    if (i % 100 === 0) {
      for (const row of db.prepare('SELECT t.id, t.like_count, (SELECT COUNT(*) FROM likes l WHERE l.track_id = t.id) AS real FROM tracks t').all()) {
        assert.equal(row.like_count, row.real, `step ${i}, track ${row.id}`);
        maxLikes = Math.max(maxLikes, row.real);
      }
    }
  }
  for (const row of db.prepare('SELECT t.id, t.like_count, (SELECT COUNT(*) FROM likes l WHERE l.track_id = t.id) AS real FROM tracks t').all()) {
    assert.equal(row.like_count, row.real, `final, track ${row.id}`);
  }
  assert.ok(maxLikes >= 3, 'the test really exercised liking');
}));

test('liking is rate limited per person', withServer(async ({ browser }) => {
  const a = browser(); const b = browser();
  const t = await publishTrack(a);
  let last;
  for (let i = 0; i < 121; i++) last = await b.put(`/api/tracks/${t.id}/like`);
  assert.equal(last.status, 429);
}));

// ---- reports and moderation ----------------------------------------------------------------

test('reports: distinct reporters count, three hide the track, the owner is told', withServer(async ({ browser, db }) => {
  const a = browser(); const r1 = browser(); const r2 = browser(); const r3 = browser();
  const t = await publishTrack(a, { title: 'Questionable' });
  const rep = (b, reason) => b.post(`/api/tracks/${t.id}/report`, { reason });
  assert.deepEqual((await rep(r1, 'spam')).json, { reported: true, hidden: false });
  assert.deepEqual((await rep(r1, 'spam again')).json, { reported: true, hidden: false }, 'the same person counts once');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reports').get().c, 1);
  assert.equal((await rep(r2, 'rude')).json.hidden, false);
  assert.equal((await browser().get('/api/browse')).json.total, 1, 'two reports are not enough');
  assert.equal((await rep(r3, 'rude')).json.hidden, true);
  assert.equal((await browser().get('/api/browse')).json.total, 0, 'hidden from browse');
  assert.equal((await browser().get(`/api/tracks/${t.id}`)).status, 404, 'and from direct links');
  assert.equal((await browser().get('/api/browse?q=questionable')).json.total, 0, 'and from search');
  const mine = (await a.get('/api/tracks/mine')).json.tracks[0];
  assert.equal(mine.visibility, 'hidden', 'the owner can see that it was removed');
  assert.equal((await a.post(`/api/tracks/${t.id}/publish`)).status, 403);
  assert.equal((await a.post(`/api/tracks/${t.id}/unpublish`)).json.error.code, 'removed');
  assert.equal((await a.put(`/api/tracks/${t.id}`, { title: 'Edited' })).status, 200, 'the owner can still edit');
  assert.equal((await a.get('/api/browse?q=edited')).json.total, 0, 'edits do not sneak it back into search');
  assert.equal((await a.del(`/api/tracks/${t.id}`)).status, 200, 'or delete');
}));

test('reports: not your own, not private ones; reasons are capped', withServer(async ({ browser, db }) => {
  const a = browser(); const b = browser();
  const pub = await publishTrack(a); const priv = await makeTrack(a);
  assert.equal((await a.post(`/api/tracks/${pub.id}/report`, {})).status, 403);
  assert.equal((await b.post(`/api/tracks/${priv.id}/report`, {})).status, 404);
  assert.equal((await b.post('/api/tracks/nope/report', {})).status, 404);
  await b.post(`/api/tracks/${pub.id}/report`, { reason: 'x'.repeat(2000) });
  assert.equal(db.prepare('SELECT length(reason) l FROM reports').get().l, LIMITS.reason);
}));

test('moderation: hide, restore, delete and ban, through the same code the CLI uses', withServer(async ({ browser, db }) => {
  const a = browser(); const b = browser();
  const t1 = await publishTrack(a, { title: 'Keep me' });
  const t2 = await publishTrack(a, { title: 'Hide me' });
  const t3 = await publishTrack(a, { title: 'Delete me' });
  const mod = createModeration(db);
  assert.equal(mod.stats().published, 3);
  mod.hide(t2.id);
  assert.deepEqual(await searchIds(b, ''), ['Delete me', 'Keep me'], 'hidden tracks are gone from browse (newest first)');
  assert.equal((await b.get(`/api/tracks/${t2.id}`)).status, 404);
  assert.equal((await a.get('/api/tracks/mine')).json.tracks.find((t) => t.id === t2.id).visibility, 'hidden');
  await b.post(`/api/tracks/${t1.id}/report`, { reason: 'test' });
  assert.equal(mod.reports().length, 1);
  assert.equal(mod.reports()[0].title, 'Keep me');
  mod.restore(t2.id);
  assert.equal((await b.get(`/api/tracks/${t2.id}`)).status, 200);
  assert.equal((await b.get('/api/browse?q=hide')).json.total, 1, 'searchable again');
  assert.throws(() => mod.restore(t2.id), /not hidden/);
  assert.throws(() => mod.hide('nope'), /No track/);
  mod.remove(t3.id);
  assert.equal((await a.get(`/api/tracks/${t3.id}`)).status, 404);
  // ban the author: their tracks vanish from the public site and they cannot act
  const authorId = (await a.get('/api/me')).json.me.id;
  mod.ban(authorId);
  assert.equal((await b.get('/api/browse')).json.total, 0);
  assert.equal((await b.get(`/api/tracks/${t1.id}`)).status, 404);
  const banned = await a.post('/api/tracks', { title: 'x', data: trackData() });
  assert.equal(banned.status, 403);
  assert.equal(banned.json.error.code, 'banned');
  assert.equal((await a.post(`/api/tracks/${t1.id}/publish`)).status, 403);
  assert.equal((await a.get('/api/me')).json.me.banned, true);
  assert.equal((await a.get('/api/tracks/mine')).status, 200, 'they can still see and export their own');
  mod.ban(authorId, false);
  assert.equal((await b.get('/api/browse')).json.total, 2);
  assert.throws(() => mod.ban('ZZZZZZZZ'), /No such user/);
}));

test('the admin command line works end to end', withServer(async ({ browser, db }) => {
  const a = browser(); const b = browser();
  const t = await publishTrack(a, { title: 'Reported one' });
  await b.post(`/api/tracks/${t.id}/report`, { reason: 'because' });
  const out = [];
  const log = (v) => out.push(v);
  await runAdmin(['stats'], { db, log });
  assert.equal(out.at(-1).published, 1);
  await runAdmin(['reports'], { db, log });
  assert.equal(out.at(-1)[0].title, 'Reported one');
  assert.match(out.at(-1)[0].reasons, /because/);
  await runAdmin(['hide', t.id], { db, log });
  assert.match(out.at(-1), /Hidden: "Reported one"/);
  await runAdmin(['restore', t.id], { db, log });
  assert.match(out.at(-1), /Restored/);
  await runAdmin(['show', t.id], { db, log });
  assert.equal(out.at(-1).title, 'Reported one');
  assert.ok(!('data' in out.at(-1)) || out.at(-1).data === undefined);
  await runAdmin(['delete', t.id], { db, log });
  assert.match(out.at(-1), /Deleted/);
  await assert.rejects(runAdmin(['hide'], { db, log }), /needs an id/);
  await assert.rejects(runAdmin(['hide', 'nope'], { db, log }), /No track/);
  await runAdmin([], { db, log });
  assert.match(out.at(-1), /Jam Gym moderation/);
}));

// ---- importing an old library --------------------------------------------------------------

test('importing the browser\'s old saved progressions: good ones in, bad ones reported', withServer(async ({ browser }) => {
  const a = browser();
  const items = [
    { title: 'Good one', data: trackData() },
    { title: 'Also good', data: trackData({ song: { progressionText: 'Am | G | F | E' }, config: { style: 'rock' } }) },
    { title: 'Broken chords', data: trackData({ song: { progressionText: 'C | Xyz' } }) },
    { title: '', data: trackData() },
    { title: 'No data' },
    null,
  ];
  const r = await a.post('/api/tracks/import', { items });
  assert.equal(r.status, 200);
  assert.equal(r.json.created, 2);
  assert.equal(r.json.skipped.length, 4);
  assert.equal((await a.get('/api/tracks/mine')).json.tracks.length, 2);
  assert.equal((await a.post('/api/tracks/import', { items: 'nope' })).status, 400);
  assert.equal((await a.post('/api/tracks/import', {})).status, 400);
}));

// ---- the static site -----------------------------------------------------------------------

test('the site is served, with a strict CSP on the page and no access to server code or data', withServer(async ({ browser }) => {
  const b = browser();
  const page = await b.get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  const js = await b.get('/src/app/main.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await b.get('/samples/drums/jazz/kick_1_1.wav')).headers.get('content-type'), 'audio/wav');
  assert.equal((await b.get('/samples/drums/jazz/kick_1_1.wav')).headers.get('cache-control'), 'public, max-age=86400');
  assert.equal((await b.get('/fonts/bricolage-800.woff2')).headers.get('content-type'), 'font/woff2');
  assert.equal((await b.get('/samples/manifest.json')).headers.get('cache-control'), 'no-cache');
  // conditional requests
  const etag = js.headers.get('etag');
  assert.ok(etag);
  assert.equal((await b.raw('GET', '/src/app/main.js', { headers: { 'If-None-Match': etag } })).status, 304);
  // nothing outside the allowlist, however it is spelled
  for (const path of ['/server/app.js', '/server/db.js', '/data/jamgym.sqlite', '/test/harness.js', '/package.json', '/docs/deployment.md', '/.git/config',
    '/src/../server/app.js', '/src/%2e%2e/server/app.js', '/src/..%2fserver/app.js', '/src/app/', '/%00', '/src\\..\\server\\app.js', '//server/app.js', '/samples/../package.json']) {
    const r = await b.raw('GET', path);
    assert.ok([404, 400].includes(r.status), `${path} -> ${r.status}`);
    assert.doesNotMatch(r.text, /createApp|DatabaseSync|"name": "jam-gym"/, path);
  }
  assert.equal((await b.raw('POST', '/', { headers: {} })).status, 405);
  assert.equal((await b.raw('HEAD', '/')).status, 200);
}));
