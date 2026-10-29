import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, trackData } from './harness.js';
import { createUsers } from '../server/users.js';
import { run as runAdmin } from '../server/admin.js';

const withServer = (fn) => async () => {
  const s = await startTestServer();
  try { await fn(s); } finally { await s.close(); }
};

/** An ordinary account with a username and password, then the key the admin command would issue for it. */
async function makeSystemUser({ browser, db }, username = 'jam-gym') {
  const b = browser();
  assert.equal((await b.post('/api/auth/signup', { username, password: 'a long password 1' })).status, 201);
  const { key } = createUsers(db).issueSystemKey(username);
  return key;
}
const asKey = (browser, key) => browser({ Authorization: `Bearer ${key}` });

test('a system user is not held back by any rate limit', withServer(async (s) => {
  const key = await makeSystemUser(s);
  const bot = asKey(s.browser, key);
  const ids = [];
  // the ordinary limits are 30 creates and 10 publishes an hour
  for (let i = 0; i < 40; i++) {
    const r = await bot.post('/api/tracks', { title: `Song ${i}`, data: trackData() });
    assert.equal(r.status, 201, `create ${i}: ${r.status}`);
    ids.push(r.json.track.id);
  }
  for (const id of ids.slice(0, 15)) {
    const r = await bot.post(`/api/tracks/${id}/publish`);
    assert.equal(r.status, 200, `publish: ${r.status}`);
  }
  assert.equal((await bot.get('/api/me')).json.me.username, 'jam-gym');
}));

test('an ordinary account is still limited on the same actions', withServer(async (s) => {
  const b = s.browser();
  await b.post('/api/auth/signup', { username: 'someone', password: 'a long password 1' });
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push((await b.post('/api/tracks', { title: `Song ${i}`, data: trackData() })).json.track.id);
  let last;
  for (const id of ids) last = (await b.post(`/api/tracks/${id}/publish`)).status;
  assert.equal(last, 429, 'the 11th publish in an hour is refused');
}));

test('a system user gets no cookie, and a key alone does not need one', withServer(async (s) => {
  const key = await makeSystemUser(s);
  const bot = asKey(s.browser, key);
  const r = await bot.get('/api/me');
  assert.equal(r.status, 200);
  assert.deepEqual(r.setCookies, [], 'no session cookie is handed out');
  assert.equal(bot.jar.size, 0);
}));

test('writes with a key still need the CSRF header (the key does not bypass that)', withServer(async (s) => {
  const key = await makeSystemUser(s);
  const bot = s.browser();
  const r = await bot.raw('POST', '/api/tracks', {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x', data: trackData() }),
  });
  assert.equal(r.status, 403);
}));

test('wrong keys are refused, and an address that keeps guessing is shut out, even for the right key', withServer(async (s) => {
  const key = await makeSystemUser(s);
  const guess = asKey(s.browser, 'jgs_' + 'A'.repeat(43));
  for (let i = 0; i < 10; i++) assert.equal((await guess.get('/api/me')).status, 401);
  assert.equal((await guess.get('/api/me')).status, 429, 'the eleventh wrong key is throttled');
  assert.equal((await asKey(s.browser, key).get('/api/me')).status, 429, 'the same address is refused before the key is checked');
}));

test('a malformed Authorization header is a bad key, not a way in', withServer(async (s) => {
  await makeSystemUser(s);
  for (const h of ['Bearer', 'Bearer ', 'Basic abc', 'jgs_x', 'Bearer not-a-key']) {
    const r = await s.browser({ Authorization: h }).get('/api/me');
    assert.equal(r.status, 401, h);
  }
}));

test('a system user cannot log in with its password, or change it', withServer(async (s) => {
  const key = await makeSystemUser(s);
  const login = await s.browser().post('/api/auth/login', { username: 'jam-gym', password: 'a long password 1' });
  assert.equal(login.status, 401, 'password login is switched off');
  const pw = await asKey(s.browser, key).post('/api/me/password', { current: 'a long password 1', next: 'another long password 2' });
  assert.equal(pw.status, 403);
}));

test('a key is stored only as a hash, is unique per issue, and issuing again replaces it', withServer(async (s) => {
  const first = await makeSystemUser(s);
  const row = s.db.prepare('SELECT system_key_hash FROM users WHERE username = ?').get('jam-gym');
  assert.match(row.system_key_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(s.db.prepare('SELECT * FROM users').all()).includes(first), 'the key itself is nowhere in the database');
  const second = createUsers(s.db).issueSystemKey('jam-gym').key;
  assert.notEqual(first, second);
  assert.equal((await asKey(s.browser, first).get('/api/me')).status, 401, 'the old key stops working');
  assert.equal((await asKey(s.browser, second).get('/api/me')).status, 200);
}));

test('revoking the key turns it back into an ordinary account', withServer(async (s) => {
  const key = await makeSystemUser(s);
  createUsers(s.db).revokeSystemKey('jam-gym');
  assert.equal((await asKey(s.browser, key).get('/api/me')).status, 401);
  assert.equal((await s.browser().post('/api/auth/login', { username: 'jam-gym', password: 'a long password 1' })).status, 200);
}));

test('the admin command issues and revokes a key, and rejects an unknown username', withServer(async (s) => {
  const b = s.browser();
  await b.post('/api/auth/signup', { username: 'jam-gym', password: 'a long password 1' });
  const lines = [];
  await runAdmin(['system-key', 'jam-gym'], { db: s.db, log: (l) => lines.push(l) });
  const key = lines.join('\n').split('\n').pop();
  assert.match(key, /^jgs_[A-Za-z0-9_-]{43}$/);
  assert.equal((await asKey(s.browser, key).get('/api/me')).status, 200);
  await runAdmin(['system-revoke', 'jam-gym'], { db: s.db, log: () => {} });
  assert.equal((await asKey(s.browser, key).get('/api/me')).status, 401);
  await assert.rejects(runAdmin(['system-key', 'nobody'], { db: s.db, log: () => {} }), /No account has that username/);
}));
