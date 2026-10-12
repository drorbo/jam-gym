import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { startTestServer, makeTrack, publishTrack } from './harness.js';
import { checkIdToken } from '../server/google.js';

const CLIENT_ID = 'jam-gym-test.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-test-secret';

/** A stand-in for Google: its token endpoint checks the code, secret, redirect address and PKCE verifier, as Google does. */
async function fakeGoogle() {
  const codes = new Map();
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      seen.push(Object.fromEntries(form));
      const entry = codes.get(form.get('code'));
      const ok = req.url === '/token' && entry && !entry.used && form.get('client_id') === CLIENT_ID && form.get('client_secret') === CLIENT_SECRET
        && form.get('grant_type') === 'authorization_code' && form.get('redirect_uri') === entry.redirectUri
        && createHash('sha256').update(String(form.get('code_verifier'))).digest('base64url') === entry.challenge;
      if (!ok) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"invalid_grant"}'); }
      entry.used = true;
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const claims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: entry.sub, nonce: entry.nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...entry.claims };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ access_token: 'unused', id_token: `${b64({ alg: 'RS256' })}.${b64(claims)}.sig` }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, seen, codes, close: () => new Promise((r) => server.close(r)) };
}

async function withGoogle(fn) {
  const google = await fakeGoogle();
  const s = await startTestServer({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_AUTH_URL: `${google.base}/auth`, GOOGLE_TOKEN_URL: `${google.base}/token` });
  try { await fn({ ...s, google }); } finally { await s.close(); await google.close(); }
}

/** Start in this browser, "sign in at Google", and come back: returns the callback response. */
async function googleSignIn(b, google, { sub = '111111111111111111111', claims, state, cancel = false, code } = {}) {
  const start = await b.get('/api/auth/google/start');
  const to = new URL(start.headers.get('location'));
  const gcode = code ?? randomBytes(8).toString('hex');
  google.codes.set(gcode, { sub, nonce: to.searchParams.get('nonce'), challenge: to.searchParams.get('code_challenge'), redirectUri: to.searchParams.get('redirect_uri'), claims });
  const qs = cancel ? `error=access_denied&state=${to.searchParams.get('state')}` : `code=${gcode}&state=${state ?? to.searchParams.get('state')}`;
  return b.get(`/api/auth/google/callback?${qs}`);
}

test('an ID token is accepted only for this client, this nonce, Google as issuer and before it expires', () => {
  const now = Math.floor(Date.now() / 1000);
  const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  const good = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '123', nonce: 'n1', exp: now + 600 };
  assert.deepEqual(checkIdToken(jwt(good), { clientId: CLIENT_ID, nonce: 'n1', nowSeconds: now }), { sub: '123' });
  assert.equal(checkIdToken(jwt({ ...good, iss: 'accounts.google.com' }), { clientId: CLIENT_ID, nonce: 'n1', nowSeconds: now }).sub, '123');
  const refused = (claims, opts = {}) => assert.throws(() => checkIdToken(jwt(claims), { clientId: CLIENT_ID, nonce: 'n1', nowSeconds: now, ...opts }));
  refused({ ...good, iss: 'https://evil.example' });
  refused({ ...good, aud: 'someone-else' });
  refused({ ...good, nonce: 'n2' });
  refused({ ...good, nonce: undefined });
  refused({ ...good, exp: now - 3600 });
  refused({ ...good, sub: 'abc' });
  refused({ ...good, sub: '' });
  assert.throws(() => checkIdToken('not a token', { clientId: CLIENT_ID, nonce: 'n1' }));
});

test('without a client id and secret the feature is off', async () => {
  const s = await startTestServer();
  try {
    const b = s.browser();
    assert.equal((await b.get('/api/me')).json.features.google, false);
    assert.equal((await b.get('/api/auth/google/start')).status, 404);
    assert.equal((await b.get('/api/auth/google/callback?code=x&state=y')).headers.get('location'), '/?google=failed');
  } finally { await s.close(); }
});

test('start sends the person to Google asking only for their account id, with PKCE, and keeps its secrets in a cookie', () => withGoogle(async ({ browser, google }) => {
  const b = browser();
  assert.equal((await b.get('/api/me')).json.features.google, true);
  const start = await b.get('/api/auth/google/start');
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  assert.equal(to.origin + to.pathname, `${google.base}/auth`);
  const q = to.searchParams;
  assert.deepEqual([q.get('client_id'), q.get('response_type'), q.get('scope'), q.get('code_challenge_method'), q.get('prompt')], [CLIENT_ID, 'code', 'openid', 'S256', 'select_account']);
  assert.match(q.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/api\/auth\/google\/callback$/);
  assert.equal(q.get('state').length, 32);
  assert.equal(q.get('nonce').length, 32);
  assert.ok(q.get('code_challenge').length >= 43);
  assert.equal(q.has('client_secret'), false, 'the secret never goes through the browser');
  const cookie = start.setCookies.find((c) => c.startsWith('jg_google='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\/api\/auth\/google/);
  assert.match(cookie, /Max-Age=600/);
  assert.equal(cookie.includes(q.get('state')), true);
}));

test('signing in with Google makes an account; the same Google account opens the same library on another device', () => withGoogle(async ({ browser, google, db }) => {
  const laptop = browser();
  const back = await googleSignIn(laptop, google);
  assert.equal(back.headers.get('location'), '/?google=ok');
  const me = (await laptop.get('/api/me')).json.me;
  assert.equal(me.google, true);
  assert.match(me.displayName, /^Player-/, 'Google\'s name is never adopted');
  assert.equal(me.username, null);
  assert.equal(laptop.jar.has('jg_google'), false, 'the one-time cookie is cleared');
  assert.equal(db.prepare('SELECT google_sub FROM users').get().google_sub, '111111111111111111111');
  assert.equal(google.seen.every((s) => s.code_verifier && s.client_secret === CLIENT_SECRET), true);

  const t = await publishTrack(laptop, { title: 'Blues in G' });
  const phone = browser();
  assert.equal((await googleSignIn(phone, google)).headers.get('location'), '/?google=ok');
  assert.deepEqual((await phone.get('/api/tracks/mine')).json.tracks.map((x) => x.id), [t.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1);

  // another Google account is another account
  const other = browser();
  await googleSignIn(other, google, { sub: '222222222222222222222' });
  assert.deepEqual((await other.get('/api/tracks/mine')).json.tracks, []);

  // a phone can log out (it has a way back in); only that phone
  assert.equal((await phone.post('/api/me/signout')).status, 200);
  assert.equal((await phone.get('/api/me')).json.me, null);
  assert.equal((await laptop.get('/api/me')).json.me.google, true);
}));

test('a library saved without an account keeps everything when Google is connected to it', () => withGoogle(async ({ browser, google, db }) => {
  const b = browser();
  const t = await makeTrack(b, { title: 'Already saved' });
  const before = (await b.get('/api/me')).json.me.id;
  await googleSignIn(b, google);
  const me = (await b.get('/api/me')).json.me;
  assert.equal(me.id, before, 'the same account, now with Google');
  assert.equal(me.google, true);
  assert.deepEqual((await b.get('/api/tracks/mine')).json.tracks.map((x) => x.id), [t.id]);

  // a browser with its own unsaved library signing in to an existing Google account brings that library along
  const guest = browser();
  const mine = await makeTrack(guest, { title: 'Made as a guest' });
  await googleSignIn(guest, google);
  assert.deepEqual((await guest.get('/api/tracks/mine')).json.tracks.map((x) => x.id).sort(), [t.id, mine.id].sort());
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1);
}));

test('Google can be connected to an account that logs in with a username and password, and either way opens it', () => withGoogle(async ({ browser, google }) => {
  const a = browser();
  await a.post('/api/auth/signup', { username: 'miles_d', password: 'so what 1959' });
  await googleSignIn(a, google);
  const me = (await a.get('/api/me')).json.me;
  assert.deepEqual([me.username, me.google], ['miles_d', true]);

  const phone = browser();
  await googleSignIn(phone, google);
  assert.equal((await phone.get('/api/me')).json.me.username, 'miles_d', 'Google opens the account that has the username');
  const laptop = browser();
  assert.equal((await laptop.post('/api/auth/login', { username: 'miles_d', password: 'so what 1959' })).status, 200);
  assert.equal((await laptop.get('/api/me')).json.me.google, true, 'and the password opens the one that has Google');
}));

test('anything wrong at the callback changes nothing and says so', () => withGoogle(async ({ browser, google, db }) => {
  const users = () => db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const failed = async (opts) => {
    const b = browser();
    const r = await googleSignIn(b, google, opts);
    assert.equal(r.headers.get('location'), '/?google=failed', JSON.stringify(opts));
    assert.equal((await b.get('/api/me')).json.me, null);
  };
  await failed({ state: 'not-the-state' });
  await failed({ claims: { aud: 'another-client' } });
  await failed({ claims: { iss: 'https://evil.example' } });
  await failed({ claims: { nonce: 'replayed-from-another-sign-in' } });
  await failed({ claims: { exp: Math.floor(Date.now() / 1000) - 3600 } });
  {
    const b = browser();
    const to = new URL((await b.get('/api/auth/google/start')).headers.get('location'));
    const r = await b.get(`/api/auth/google/callback?code=a-code-google-never-issued&state=${to.searchParams.get('state')}`);
    assert.equal(r.headers.get('location'), '/?google=failed', 'Google refuses a code it never issued');
  }
  assert.equal(users(), 0, 'no account was made by any of those');

  // no cookie at all (a link followed from somewhere else)
  assert.equal((await browser().get('/api/auth/google/callback?code=x&state=y')).headers.get('location'), '/?google=failed');

  // the person said no at Google
  const b = browser();
  assert.equal((await googleSignIn(b, google, { cancel: true })).headers.get('location'), '/?google=cancelled');

  // a code works once
  const c = browser();
  const start = await c.get('/api/auth/google/start');
  const to = new URL(start.headers.get('location'));
  google.codes.set('once', { sub: '9', nonce: to.searchParams.get('nonce'), challenge: to.searchParams.get('code_challenge'), redirectUri: to.searchParams.get('redirect_uri') });
  const url = `/api/auth/google/callback?code=once&state=${to.searchParams.get('state')}`;
  assert.equal((await c.get(url)).headers.get('location'), '/?google=ok');
  assert.equal((await c.get(url)).headers.get('location'), '/?google=failed', 'the state cookie was used up');
}));
