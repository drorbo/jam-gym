import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishTrack } from './harness.js';
import { LIMITS } from '../server/config.js';
import { run as runAdmin } from '../server/admin.js';

const withServer = (fn) => async () => {
  const s = await startTestServer();
  try { await fn(s); } finally { await s.close(); }
};

/** A JPEG-shaped file of the given size: the markers the server checks (SOI, a frame header, EOI), not a picture. */
function fakeJpeg(width = 64, height = 64, extra = 0) {
  const w = Buffer.alloc(2); w.writeUInt16BE(width);
  const h = Buffer.alloc(2); h.writeUInt16BE(height);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08]), h, w, Buffer.from([0x01, 0x01, 0x11, 0x00]),
    Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.alloc(extra, 0x11), Buffer.from([0xff, 0xd9]),
  ]);
}
const b64 = (buf) => buf.toString('base64');

test('a bio and a photo: saved, shown to everyone on the profile, and served as a locked-down image', withServer(async ({ browser }) => {
  const ann = browser();
  const t = await publishTrack(ann, { title: 'Ann\'s blues' });
  assert.equal((await ann.patch('/api/me', { displayName: 'Ann Lee' })).status, 200);

  const bio = await ann.patch('/api/me', { bio: '  Bass player.\n\n\n\nLikes slow blues.  ' });
  assert.equal(bio.status, 200);
  assert.equal(bio.json.me.bio, 'Bass player.\n\nLikes slow blues.', 'whitespace tidied, line breaks kept');
  assert.equal(bio.json.me.displayName, 'Ann Lee', 'a bio-only change leaves the name alone');
  assert.equal(bio.json.me.avatar, null);

  const up = await ann.put('/api/me/avatar', { image: b64(fakeJpeg()) });
  assert.equal(up.status, 200);
  assert.ok(up.json.me.avatar > 0, 'the version is the time it was set');

  const guest = browser();
  const img = await guest.get(`/api/avatar/${up.json.me.id}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.match(img.headers.get('content-security-policy'), /sandbox/);

  const profile = await guest.get(`/api/profiles/${up.json.me.id}`);
  assert.equal(profile.status, 200);
  assert.deepEqual(
    { name: profile.json.profile.name, bio: profile.json.profile.bio, avatar: profile.json.profile.avatar, published: profile.json.profile.published },
    { name: 'Ann Lee', bio: 'Bass player.\n\nLikes slow blues.', avatar: up.json.me.avatar, published: 1 });
  assert.deepEqual(profile.json.tracks.map((x) => x.id), [t.id]);
  assert.equal(JSON.stringify(profile.json).includes('secret'), false);

  const listed = (await guest.get('/api/browse')).json.items[0];
  assert.equal(listed.authorId, up.json.me.id);
  assert.equal(listed.authorAvatar, up.json.me.avatar, 'Browse can draw the photo without a second request');

  const gone = await ann.del('/api/me/avatar');
  assert.equal(gone.json.me.avatar, null);
  assert.equal((await guest.get(`/api/avatar/${up.json.me.id}`)).status, 404);
}));

test('a photo must be a small, real JPEG; a bio has a length limit', withServer(async ({ browser }) => {
  const b = browser();
  await publishTrack(b, {});
  const put = (image) => b.put('/api/me/avatar', { image });
  assert.equal((await put(b64(fakeJpeg()))).status, 200);
  assert.equal((await put('')).status, 400, 'empty');
  assert.equal((await put('not base64 !!')).status, 400, 'not base64');
  assert.equal((await put(b64(Buffer.from('<svg onload=alert(1)></svg>')))).status, 400, 'not a JPEG');
  assert.equal((await put(b64(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])))).status, 400, 'a PNG');
  assert.equal((await put(b64(fakeJpeg(2000, 2000)))).status, 400, 'too many pixels');
  assert.equal((await put(b64(fakeJpeg(8, 8)))).status, 400, 'too small to be a photo');
  assert.equal((await put(b64(fakeJpeg(64, 64, LIMITS.avatarBytes)))).status, 400, 'too many bytes');
  assert.equal((await b.get(`/api/profiles/${(await b.get('/api/me')).json.me.id}`)).json.profile.avatar > 0, true, 'a refused upload keeps the old photo');

  const long = await b.patch('/api/me', { bio: 'x'.repeat(LIMITS.bio + 50) });
  assert.equal([...long.json.me.bio].length, LIMITS.bio);
  assert.equal((await b.patch('/api/me', { bio: '' })).json.me.bio, '', 'a bio can be cleared');
  assert.equal((await b.patch('/api/me', { displayName: 'x' })).status, 400, 'a too-short name is still refused');
  assert.equal((await b.patch('/api/me', {})).status, 400, 'nothing to change');
  assert.equal((await browser().put('/api/me/avatar', { image: b64(fakeJpeg()) })).status, 401, 'needs an account');
}));

test('a banned person disappears: no profile, no photo; a moderator can clear a photo and bio', withServer(async ({ browser, db }) => {
  const b = browser();
  await publishTrack(b, {});
  const me = (await b.put('/api/me/avatar', { image: b64(fakeJpeg()) })).json.me;
  await b.patch('/api/me', { bio: 'hello' });
  const guest = browser();

  const logs = [];
  await runAdmin(['clear-profile', me.id], { db, log: (m) => logs.push(m) });
  assert.match(logs[0], /Cleared/);
  const after = (await guest.get(`/api/profiles/${me.id}`)).json.profile;
  assert.equal(after.bio, '');
  assert.equal(after.avatar, null);
  assert.equal((await guest.get(`/api/avatar/${me.id}`)).status, 404);

  await b.put('/api/me/avatar', { image: b64(fakeJpeg()) });
  await runAdmin(['ban', me.id], { db, log: () => {} });
  assert.equal((await guest.get(`/api/profiles/${me.id}`)).status, 404);
  assert.equal((await guest.get(`/api/avatar/${me.id}`)).status, 404);
  assert.equal((await b.put('/api/me/avatar', { image: b64(fakeJpeg()) })).status, 403, 'a banned person cannot change it');
}));

test('deleting my data removes the photo too', withServer(async ({ browser, db }) => {
  const b = browser();
  await publishTrack(b, {});
  const me = (await b.put('/api/me/avatar', { image: b64(fakeJpeg()) })).json.me;
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM avatars').get().c, 1);
  assert.equal((await b.del('/api/me')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM avatars').get().c, 0, 'no orphaned photo');
  assert.equal((await browser().get(`/api/profiles/${me.id}`)).status, 404);
}));
