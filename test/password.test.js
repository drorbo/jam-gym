import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, makeTrack, publishTrack } from './harness.js';
import { checkPassword, checkUsername, hashPassword, verifyPassword } from '../server/password.js';

const withServer = (fn) => async () => {
  const s = await startTestServer();
  try { await fn(s); } finally { await s.close(); }
};
const signup = (b, username = 'miles_d', password = 'so what 1959') => b.post('/api/auth/signup', { username, password });
const login = (b, username = 'miles_d', password = 'so what 1959') => b.post('/api/auth/login', { username, password });

test('passwords are stored as salted scrypt hashes, checked the same way for a real and a missing username', async () => {
  const h1 = await hashPassword('correct horse');
  const h2 = await hashPassword('correct horse');
  assert.match(h1, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(h1, h2, 'a fresh salt each time');
  assert.equal(h1.includes('correct horse'), false);
  assert.equal(await verifyPassword('correct horse', h1), true);
  assert.equal(await verifyPassword('correct horsf', h1), false);
  assert.equal(await verifyPassword('anything', null), false, 'no such user: same work, then no');
  assert.equal(await verifyPassword('', h1), false);
});

test('username and password rules', () => {
  assert.equal(checkUsername('  Miles.D-1_  '), 'Miles.D-1_');
  for (const bad of ['ab', 'x'.repeat(21), 'has space', 'emoji🎸', '<script>', '']) assert.throws(() => checkUsername(bad), (e) => e.status === 400, bad);
  assert.equal(checkPassword('12345678'), '12345678');
  assert.throws(() => checkPassword('short'), (e) => e.code === 'bad_password');
  assert.throws(() => checkPassword('x'.repeat(129)), (e) => e.code === 'bad_password');
  assert.throws(() => checkPassword('Miles_D', 'miles_d'), (e) => e.code === 'bad_password', 'not the same as the username');
  assert.throws(() => checkPassword(12345678), (e) => e.code === 'bad_password');
});

test('sign up from nothing makes an account; the username is private and unique ignoring case', withServer(async ({ browser, db }) => {
  const a = browser();
  const r = await signup(a);
  assert.equal(r.status, 201);
  assert.equal(r.json.me.username, 'miles_d');
  assert.match(r.json.me.displayName, /^Player-/, 'the public name is not the username');
  assert.equal((await a.get('/api/me')).json.me.username, 'miles_d', 'and the browser is logged in');
  assert.equal(db.prepare('SELECT password_hash FROM users').get().password_hash.includes('so what'), false);

  const b = browser();
  assert.equal((await signup(b, 'MILES_d', 'another password')).status, 409, 'same name, different case');
  assert.equal(b.jar.size, 0, 'a refused signup leaves no account or cookie behind');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1);

  assert.equal((await signup(b, 'x', 'long enough pw')).status, 400);
  assert.equal((await signup(b, 'fine_name', 'short')).status, 400);

  // nobody else can read a username
  await publishTrack(a, {});
  const profile = (await browser().get(`/api/profiles/${r.json.me.id}`)).json;
  assert.equal(JSON.stringify(profile).includes('miles_d'), false);
  const listing = (await browser().get('/api/browse')).json;
  assert.equal(JSON.stringify(listing).includes('miles_d'), false);
}));

test('an anonymous library gets a login without losing anything, and cannot get a second one', withServer(async ({ browser }) => {
  const a = browser();
  const t = await makeTrack(a, { title: 'Already saved' });
  const before = (await a.get('/api/me')).json.me.id;
  const r = await signup(a);
  assert.equal(r.status, 201);
  assert.equal(r.json.me.id, before, 'the same account, now with a login');
  assert.deepEqual((await a.get('/api/tracks/mine')).json.tracks.map((x) => x.id), [t.id]);
  assert.equal((await signup(a, 'second_try', 'another password')).status, 409);
}));

test('logging in on another device opens the library; wrong names and passwords get one answer', withServer(async ({ browser, db }) => {
  const laptop = browser();
  const t = await publishTrack(laptop, { title: 'Blues' });
  await signup(laptop);

  const phone = browser();
  const bad1 = await login(phone, 'miles_d', 'wrong password');
  const bad2 = await login(phone, 'nobody_here', 'so what 1959');
  assert.deepEqual([bad1.status, bad2.status], [401, 401]);
  assert.deepEqual(bad1.json.error, bad2.json.error, 'cannot tell which usernames exist');
  assert.equal(phone.jar.size, 0, 'a failed login sets no cookie');

  assert.equal((await login(phone, 'MILES_D')).status, 200, 'the username ignores case');
  assert.equal((await phone.get('/api/me')).json.me.username, 'miles_d');
  assert.deepEqual((await phone.get('/api/tracks/mine')).json.tracks.map((x) => x.id), [t.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1, 'the phone has a session of its own');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1);

  // logging out ends only that device
  assert.equal((await phone.post('/api/me/signout')).status, 200);
  assert.equal((await phone.get('/api/me')).json.me, null);
  assert.equal((await laptop.get('/api/me')).json.me.username, 'miles_d');
}));

test('logging in from a browser with its own unsaved library brings that library along', withServer(async ({ browser, db }) => {
  const home = browser();
  await signup(home);
  const guest = browser();
  const mine = await makeTrack(guest, { title: 'Made as a guest' });
  assert.equal((await login(guest)).status, 200);
  assert.deepEqual((await guest.get('/api/tracks/mine')).json.tracks.map((x) => x.id), [mine.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1, 'the guest identity was merged in');
}));

test('too many wrong passwords for one name from one place are slowed down', withServer(async ({ browser }) => {
  const a = browser();
  await signup(a);
  const attacker = browser();
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await login(attacker, 'miles_d', `guess number ${i}`)).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
  assert.equal(codes[10], 429);
  assert.equal((await attacker.get('/api/me')).json.me, null);
}));

test('changing the password needs the current one, logs other devices out, and keeps this one in', withServer(async ({ browser }) => {
  const laptop = browser();
  await signup(laptop);
  const phone = browser();
  await login(phone);

  assert.equal((await phone.post('/api/me/password', { current: 'not it', next: 'a brand new one' })).status, 401);
  assert.equal((await phone.post('/api/me/password', { current: 'so what 1959', next: 'short' })).status, 400);
  assert.equal((await phone.post('/api/me/password', { current: 'so what 1959', next: 'a brand new one' })).status, 200);

  assert.equal((await phone.get('/api/me')).json.me.username, 'miles_d', 'the device that changed it stays logged in');
  assert.equal((await browser().post('/api/auth/login', { username: 'miles_d', password: 'so what 1959' })).status, 401, 'the old password is gone');
  const fresh = browser();
  assert.equal((await login(fresh, 'miles_d', 'a brand new one')).status, 200);
  assert.equal((await laptop.get('/api/me')).json.me.username, 'miles_d', 'the first browser holds its own secret, which is not a login session');

  assert.equal((await browser().post('/api/me/password', { current: 'x', next: 'whatever long' })).status, 401, 'needs an account');
}));

test('an account with no login cannot log out (it would lose its library); deleting frees the username', withServer(async ({ browser }) => {
  const a = browser();
  await makeTrack(a, {});
  assert.equal((await a.post('/api/me/signout')).status, 400);
  const b = browser();
  await signup(b);
  assert.equal((await b.del('/api/me')).status, 200);
  assert.equal((await signup(browser())).status, 201, 'the name can be used again');
  assert.equal((await b.post('/api/me/password', { current: 'x', next: 'whatever long' })).status, 401);
}));

test('the recovery-code endpoints are gone', withServer(async ({ browser }) => {
  const a = browser();
  await makeTrack(a, {});
  assert.equal((await a.get('/api/me/recovery')).status, 404);
  assert.equal((await a.post('/api/me/recover', { code: 'AAAA' })).status, 404);
}));
