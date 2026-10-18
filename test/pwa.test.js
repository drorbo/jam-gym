import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { startTestServer } from './harness.js';
import { fingerprints } from '../server/static.js';
import { buildServiceWorker, precacheLists } from '../server/pwa.js';

const root = join(import.meta.dirname, '..');
const withServer = (fn) => async () => {
  const s = await startTestServer();
  try { await fn(s); } finally { await s.close(); }
};

test('the app manifest names the app and points at icons that exist', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Jam Gym');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  const sizes = m.icons.map((i) => `${i.sizes}/${i.purpose}`);
  assert.ok(sizes.includes('192x192/any') && sizes.includes('512x512/any') && sizes.includes('512x512/maskable'));
  for (const icon of m.icons) assert.ok(existsSync(join(root, icon.src)), icon.src);
});

test('the page links the manifest and icons, and the files are served with the right types', withServer(async ({ browser }) => {
  const b = browser();
  const page = await b.get('/');
  assert.match(page.text, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(page.text, /<meta name="theme-color"/);
  assert.match(page.text, /id="install-info"[^>]*hidden>[^<]*works offline[^<]*30 MB/);
  assert.match(page.text, /rel="apple-touch-icon"/);
  const m = await b.get('/manifest.webmanifest');
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type'), /application\/manifest\+json/);
  assert.equal(m.headers.get('cache-control'), 'no-cache');
  for (const icon of ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) {
    const r = await b.get(`/icons/${icon}`);
    assert.equal(r.status, 200, icon);
    assert.equal(r.headers.get('content-type'), 'image/png');
  }
  const links = await b.get('/.well-known/assetlinks.json');
  assert.equal(links.status, 200);
  assert.ok(Array.isArray(JSON.parse(links.text)));
  // the other dot-folders stay private
  assert.equal((await b.raw('GET', '/.well-known/other.json')).status, 404);
  assert.equal((await b.raw('GET', '/.git/config')).status, 404);
  // the bass samples are kept like the other sounds
  const wav = (await b.get('/samples/manifest.json')).json;
  assert.ok(wav);
}));

test('the service worker is served from the root, never cached, and lists the versioned files the page loads', withServer(async ({ browser }) => {
  const b = browser();
  const sw = await b.get('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
  const page = await b.get('/');
  const entry = /src="(src\/app\/main\.js\?v=[0-9a-f]{10})"/.exec(page.text)[1];
  assert.ok(sw.text.includes(`"/${entry}"`), 'the versioned entry script is kept');
  assert.ok(sw.text.includes('"/manifest.webmanifest"'));
  assert.ok(sw.text.includes('"/fonts/bricolage-800.woff2"'));
  assert.ok(sw.text.includes('"/icons/icon-192.png"'));
  assert.ok(sw.text.includes('"/samples/manifest.json"'));
  assert.ok(sw.text.includes('"/samples/basses/'), 'bass sounds are kept too');
  // it parses, and registers its handlers
  const events = [];
  vm.runInNewContext(sw.text, { self: { addEventListener: (name) => events.push(name), location: { origin: 'http://x' } }, URL, Set });
  assert.deepEqual(events.sort(), ['activate', 'fetch', 'install', 'message']);
}));

test('the worker keeps the account API out of its caches', () => {
  const lists = precacheLists(root, fingerprints(root));
  assert.ok(!lists.shell.some((u) => u.startsWith('/api')) && !lists.samples.some((u) => u.startsWith('/api')));
  const text = buildServiceWorker(lists, 'abc');
  assert.match(text, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(text, /jg-shell-abc/);
  assert.ok(lists.samples.length > 100 && lists.samples.every((u) => /\.(wav|json)$/.test(u)));
  assert.match(lists.samplesTag, /^[0-9a-f]{10}$/);
});

test('a new build gets a new worker, so browsers update', withServer(async ({ browser }) => {
  const b = browser();
  const one = (await b.get('/sw.js')).text;
  assert.equal((await b.get('/sw.js')).text, one, 'same files, same worker');
  assert.notEqual(buildServiceWorker(precacheLists(root, fingerprints(root)), 'other'), one);
}));
