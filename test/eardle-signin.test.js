// Sign in with eardle: the token format, the start and callback routes, and what happens to the libraries involved.

import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, makeTrack, publishTrack, trackData } from './harness.js';
import { signToken, verifyToken } from '../server/sso.js';
import { loadConfig } from '../server/config.js';
import { SCHEMA_VERSION } from '../server/db.js';

const SECRET = 'a-shared-secret-for-tests-only-0123456789';
const ENV = { EARDLE_SSO_SECRET: SECRET, EARDLE_URL: 'https://eardle.example' };
const withServer = (fn, env = ENV) => async () => {
  const s = await startTestServer(env);
  try { await fn(s); } finally { await s.close(); }
};

/** Go through the start route, then come back the way eardle would: returns the callback response. */
async function signInAs(b, sub, { name = 'Nir', state, ttl, secret = SECRET, token } = {}) {
  const start = await b.get('/api/auth/eardle/start');
  const st = state ?? new URL(start.headers.get('location')).searchParams.get('state');
  const t = token ?? signToken(secret, { sub, name, state: st, ttl });
  return b.get(`/api/auth/eardle/callback?token=${encodeURIComponent(t)}`);
}

// ---- the token ---------------------------------------------------------------------------------

test('a token names the eardle user, and only for the state, secret and time it was made for', () => {
  const now = Math.floor(Date.now() / 1000);
  const good = signToken(SECRET, { sub: 42, name: 'Nir', state: 'abc123', iat: now });
  assert.deepEqual(verifyToken(SECRET, good, 'abc123', now), { sub: '42', name: 'Nir' });
  assert.deepEqual(verifyToken(SECRET, signToken(SECRET, { sub: 7, state: 's', iat: now }), 's', now), { sub: '7', name: '' }, 'the name is optional');

  const refused = (token, state = 'abc123', at = now) => assert.throws(() => verifyToken(SECRET, token, state, at));
  refused(good, 'other-state');
  refused(good, '');
  refused(good, null);
  refused(signToken('some-other-secret', { sub: 42, state: 'abc123', iat: now }));
  refused(signToken(SECRET, { sub: 42, state: 'abc123', iat: now, aud: 'somewhere-else' }));
  refused(good, 'abc123', now + 121 + 60);                      // expired
  refused(signToken(SECRET, { sub: 42, state: 'abc123', iat: now + 500 }), 'abc123', now); // from the future
  refused(signToken(SECRET, { sub: 42, state: 'abc123', iat: now, ttl: 3600 }));            // claims to live too long
  refused(signToken(SECRET, { sub: 'x; DROP', state: 'abc123', iat: now }));                // not an id
  refused(`${good.slice(0, -2)}xx`);
  refused(good.replace('v1.', 'v2.'));
  refused('');
  refused(undefined);
  refused('a.b.c');
  assert.throws(() => verifyToken('', good, 'abc123', now), /not configured/, 'no secret means nothing is trusted');
});

test('the token format is pinned: this exact token must keep verifying, so eardle and Jam Gym cannot drift apart', () => {
  // made by eardle's lib/jamGymSso.ts and by this code from the same inputs; both sides test against this string
  const token = signToken('pinned-secret', { sub: 42, name: 'Nir', state: 'pinnedstate1234567', iat: 1_700_000_000 });
  assert.equal(token, 'v1.eyJhdWQiOiJqYW0tZ3ltIiwic3ViIjoiNDIiLCJuYW1lIjoiTmlyIiwic3RhdGUiOiJwaW5uZWRzdGF0ZTEyMzQ1NjciLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMDEyMH0.XGApcCp_QidCUS2dKyT5qOTUpnJk7AHudZZ_lhFADZ0');
  assert.deepEqual(verifyToken('pinned-secret', token, 'pinnedstate1234567', 1_700_000_050), { sub: '42', name: 'Nir' });
});

// ---- switched on and off ------------------------------------------------------------------------

test('without the shared secret the feature is off: no button, no start route', withServer(async ({ browser }) => {
  const b = browser();
  assert.deepEqual((await b.get('/api/me')).json.features, { eardle: false });
  assert.equal((await b.get('/api/auth/eardle/start')).status, 404);
  const back = await b.get(`/api/auth/eardle/callback?token=${signToken(SECRET, { sub: 1, state: 'x' })}`);
  assert.equal(back.headers.get('location'), '/?eardle=failed', 'and a token is trusted by nothing');
}, {}));

test('with the secret set the page is told, and start sends the person to eardle with a state that is also in a cookie', withServer(async ({ browser }) => {
  const b = browser();
  assert.deepEqual((await b.get('/api/me')).json.features, { eardle: true });
  const start = await b.get('/api/auth/eardle/start');
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  assert.equal(`${to.origin}${to.pathname}`, 'https://eardle.example/jam-gym/authorize');
  const state = to.searchParams.get('state');
  assert.match(state, /^[A-Za-z0-9]{32}$/);
  assert.equal(b.jar.get('jg_sso'), state);
  assert.match(start.setCookies[0], /HttpOnly/);
  assert.match(start.setCookies[0], /SameSite=Lax/);
  assert.match(start.setCookies[0], /Path=\/api\/auth\/eardle/);
  assert.equal(start.headers.get('cache-control'), 'no-store');
  assert.notEqual(new URL((await b.get('/api/auth/eardle/start')).headers.get('location')).searchParams.get('state'), state, 'a new state each time');
}));

test('the production defaults point at eardle.com, and the secret is read from the environment', () => {
  assert.equal(loadConfig({}).eardle.url, 'https://eardle.com');
  assert.equal(loadConfig({}).eardle.secret, '');
  assert.equal(loadConfig({ EARDLE_URL: 'http://localhost:3000/', EARDLE_SSO_SECRET: 's' }).eardle.url, 'http://localhost:3000');
});

// ---- signing in --------------------------------------------------------------------------------

test('a new person signs in with eardle: they get an account named after their eardle nickname', withServer(async ({ browser, db }) => {
  const b = browser();
  const back = await signInAs(b, 42, { name: 'Miles' });
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), '/?eardle=ok');
  const me = (await b.get('/api/me')).json.me;
  assert.equal(me.displayName, 'Miles');
  assert.equal(me.eardle, true);
  const row = db.prepare('SELECT auth_provider, auth_subject FROM users').get();
  assert.deepEqual({ ...row }, { auth_provider: 'eardle', auth_subject: '42' });
  assert.ok(!b.jar.has('jg_sso'), 'the state cookie is used up');
  assert.equal((await b.post('/api/tracks', { title: 'x', data: trackData() })).status, 201);
}));

test('a person who has been using Jam Gym without an account keeps their library when they sign in: it becomes the eardle account', withServer(async ({ browser, db }) => {
  const b = browser();
  const mine = await makeTrack(b, { title: 'Before signing in' });
  const before = db.prepare('SELECT id, public_id, secret_hash FROM users').get();
  await signInAs(b, 42, { name: 'Miles' });
  const me = (await b.get('/api/me')).json.me;
  assert.equal(me.eardle, true);
  assert.equal(me.displayName, 'Miles', 'a default name takes the eardle nickname');
  assert.equal(me.id, before.public_id, 'the same identity, now linked');
  assert.deepEqual((await b.get('/api/tracks/mine')).json.tracks.map((t) => t.id), [mine.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(db.prepare('SELECT secret_hash FROM users').get().secret_hash, before.secret_hash, 'its own cookie is untouched');
}));

test('a name the person chose is not replaced by the eardle nickname', withServer(async ({ browser }) => {
  const b = browser();
  await makeTrack(b);
  await b.patch('/api/me', { displayName: 'Chosen Name' });
  await signInAs(b, 42, { name: 'Miles' });
  assert.equal((await b.get('/api/me')).json.me.displayName, 'Chosen Name');
}));

test('signing in on a second device opens the same library, and the two devices stay signed in independently', withServer(async ({ browser, db }) => {
  const laptop = browser();
  const track = await publishTrack(laptop, { title: 'Blues in G' });
  await signInAs(laptop, 42, { name: 'Miles' });

  const phone = browser();
  await signInAs(phone, 42, { name: 'Miles' });
  assert.equal((await phone.get('/api/me')).json.me.eardle, true);
  assert.deepEqual((await phone.get('/api/tracks/mine')).json.tracks.map((t) => t.id), [track.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1, 'the phone holds a session of its own');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);

  // the phone has no recovery code to show; the laptop, which holds the original secret, does
  assert.equal((await phone.get('/api/me/recovery')).json.error.code, 'no_recovery_code');
  assert.equal((await laptop.get('/api/me/recovery')).status, 200);
  // a session token is not a recovery code
  const sessionToken = phone.jar.get('jg_session');
  const stranger = browser();
  assert.equal((await stranger.post('/api/me/recover', { code: sessionToken })).status, 404);

  // signing out of the phone ends only the phone
  assert.equal((await phone.post('/api/me/signout')).status, 200);
  assert.equal((await phone.get('/api/me')).json.me, null);
  assert.equal((await laptop.get('/api/me')).json.me.eardle, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
}));

test('what a browser built up without an account joins the eardle account it then signs in to; nothing is lost or counted twice', withServer(async ({ browser, db }) => {
  const laptop = browser();
  const a = await publishTrack(laptop, { title: 'On the laptop' });
  await signInAs(laptop, 42, { name: 'Miles' });
  const liker = browser();
  const other = await publishTrack(liker, { title: 'Somebody elses' });

  // the phone had its own anonymous library, and both liked the same track
  const phone = browser();
  const b = await makeTrack(phone, { title: 'On the phone' });
  await laptop.put(`/api/tracks/${other.id}/like`);
  await phone.put(`/api/tracks/${other.id}/like`);
  assert.equal(db.prepare('SELECT like_count FROM tracks WHERE id = ?').get(other.id).like_count, 2);
  const anonymousBefore = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  await signInAs(phone, 42, { name: 'Miles' });
  assert.deepEqual((await phone.get('/api/tracks/mine')).json.tracks.map((t) => t.id).sort(), [a.id, b.id].sort());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, anonymousBefore - 1, 'the phone-only identity is gone');
  assert.equal(db.prepare('SELECT like_count FROM tracks WHERE id = ?').get(other.id).like_count, 1, 'one person, one like');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM likes WHERE track_id = ?').get(other.id).n, 1);
  assert.equal((await laptop.get('/api/tracks/mine')).json.tracks.length, 2, 'the laptop sees the phone track too');
}));

test('a published track that moves to the eardle account carries the new author name in search', withServer(async ({ browser }) => {
  const laptop = browser();
  await makeTrack(laptop, { title: 'Laptop' });
  await laptop.patch('/api/me', { displayName: 'Miles' });
  await signInAs(laptop, 42, { name: 'Miles' });
  const phone = browser();
  await publishTrack(phone, { title: 'Phone Sunrise' });
  await signInAs(phone, 42, { name: 'Miles' });
  const found = (await phone.get('/api/browse?q=Sunrise')).json.items;
  assert.equal(found.length, 1);
  assert.equal(found[0].author, 'Miles');
}));

test('signing in as a different eardle account than the one this browser is linked to opens that account, and changes nothing else', withServer(async ({ browser, db }) => {
  const b = browser();
  const first = await makeTrack(b, { title: 'Account one' });
  await signInAs(b, 1, { name: 'One' });
  await signInAs(b, 2, { name: 'Two' });
  assert.equal((await b.get('/api/me')).json.me.displayName, 'Two');
  assert.deepEqual((await b.get('/api/tracks/mine')).json.tracks, [], 'account two has nothing yet, and account one keeps its track');
  assert.equal(db.prepare('SELECT owner_id FROM tracks WHERE id = ?').get(first.id).owner_id, db.prepare(`SELECT id FROM users WHERE auth_subject = '1'`).get().id);
  await signInAs(b, 1, { name: 'One' });
  assert.deepEqual((await b.get('/api/tracks/mine')).json.tracks.map((t) => t.id), [first.id]);
}));

test('signing in twice as the same account changes nothing', withServer(async ({ browser, db }) => {
  const b = browser();
  await makeTrack(b);
  await signInAs(b, 42, { name: 'Miles' });
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const back = await signInAs(b, 42, { name: 'Miles' });
  assert.equal(back.headers.get('location'), '/?eardle=ok');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, users);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
}));

// ---- refusing what cannot be trusted --------------------------------------------------------------

test('a token that is forged, expired, for another browser, or replayed changes nothing', withServer(async ({ browser, db }) => {
  const victim = browser();
  await makeTrack(victim, { title: 'Mine' });
  const usersBefore = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const start = await victim.get('/api/auth/eardle/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const failed = (r) => { assert.equal(r.headers.get('location'), '/?eardle=failed'); };

  failed(await victim.get(`/api/auth/eardle/callback?token=${signToken('not-the-secret', { sub: 9, state })}`));
  const victim2 = browser();
  await victim2.get('/api/auth/eardle/start'); // its own state
  failed(await victim2.get(`/api/auth/eardle/callback?token=${signToken(SECRET, { sub: 9, state })}`)); // a token made for someone else's state
  failed(await victim.get(`/api/auth/eardle/callback?token=${signToken(SECRET, { sub: 9, state, iat: 1_000_000 })}`)); // long expired
  failed(await browser().get(`/api/auth/eardle/callback?token=${signToken(SECRET, { sub: 9, state })}`)); // no state cookie at all
  failed(await victim.get('/api/auth/eardle/callback'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, usersBefore + 0, 'no identity was linked or made');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE auth_provider IS NOT NULL').get().n, 0);
}));

test('a state is good for one attempt: replaying the same callback fails', withServer(async ({ browser }) => {
  const b = browser();
  const start = await b.get('/api/auth/eardle/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const token = signToken(SECRET, { sub: 42, name: 'Miles', state });
  const first = await b.get(`/api/auth/eardle/callback?token=${encodeURIComponent(token)}`);
  assert.equal(first.headers.get('location'), '/?eardle=ok');
  await b.post('/api/me/signout');
  // the cookie holding the state was cleared, so even the correct token cannot be used again from this browser
  const replay = await b.get(`/api/auth/eardle/callback?token=${encodeURIComponent(token)}`);
  assert.equal(replay.headers.get('location'), '/?eardle=failed');
  assert.equal((await b.get('/api/me')).json.me, null);
}));

test('signing out is only for eardle accounts; an anonymous library is never signed out by accident', withServer(async ({ browser }) => {
  const b = browser();
  await makeTrack(b);
  const r = await b.post('/api/me/signout');
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'not_linked');
  assert.ok((await b.get('/api/me')).json.me, 'still signed in');
  assert.equal((await browser().post('/api/me/signout')).status, 401);
}));

test('a banned browser that signs in keeps its ban and cannot bring its library into an account that is not banned', withServer(async ({ browser, db }) => {
  const clean = browser();
  await makeTrack(clean, { title: 'Clean' });
  await signInAs(clean, 42, { name: 'Miles' });
  const banned = browser();
  await makeTrack(banned, { title: 'Bad' });
  db.prepare('UPDATE users SET banned = 1 WHERE auth_provider IS NULL').run();
  await signInAs(banned, 42, { name: 'Miles' });
  assert.equal((await banned.get('/api/me')).json.me.banned, false, 'the eardle account is not banned by what this browser did before');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE banned = 1`).get().n, 1, 'the banned identity is left as it was');
  assert.deepEqual((await banned.get('/api/tracks/mine')).json.tracks.map((t) => t.title), ['Clean'], 'it now sees the eardle account, and its own library did not move into it');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM tracks WHERE title = 'Bad' AND owner_id IN (SELECT id FROM users WHERE banned = 1)`).get().n, 1);
}));

test('deleting an eardle-linked account removes its sessions and library and nothing of anyone else', withServer(async ({ browser, db }) => {
  const laptop = browser();
  await makeTrack(laptop, { title: 'Gone' });
  await signInAs(laptop, 42, { name: 'Miles' });
  const phone = browser();
  await signInAs(phone, 42, { name: 'Miles' });
  const other = browser();
  await makeTrack(other, { title: 'Stays' });
  assert.equal((await phone.del('/api/me')).status, 200);
  assert.equal((await laptop.get('/api/me')).json.me, null, 'the laptop lost the account too');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n, 1);
}));

test('the database has the sessions table', withServer(async ({ db }) => {
  assert.ok(SCHEMA_VERSION >= 3);
  assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'sessions'`).get());
}));
