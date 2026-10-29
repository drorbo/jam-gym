// Publishes built tracks (from build.mjs) to the LIVE Jam Hub as the "jam-gym" system user, then checks the public listing.
//
//   node tools/seed-songs/publish.mjs tracks.json
//
// - Authenticates with the jam-gym SYSTEM KEY (Authorization: Bearer ...). The key is read from the JAMGYM_KEY environment
//   variable, or from the file .jam-gym/system-key in the current user's home folder (on Windows
//   C:\Users\<you>\.jam-gym\system-key, readable only by that user). It is never in the repo. A system user has no rate limits, so there is nothing to wait for.
// - Safe to re-run: a song with the same title that is already published is skipped, and an unpublished draft with that
//   title is reused (never duplicated).
// - Finally it re-reads each song from the public API and compares chords, key, tempo and band settings.
//
// See docs/adding-songs.md.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://jam-gym.eardle.com';
const [tracksFile] = process.argv.slice(2);
if (!tracksFile) { console.error('usage: node tools/seed-songs/publish.mjs tracks.json'); process.exit(2); }
const tracks = JSON.parse(fs.readFileSync(tracksFile, 'utf8'));
const keyFile = path.join(os.homedir(), '.jam-gym', 'system-key');
const key = (process.env.JAMGYM_KEY ?? (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!key) { console.error(`No system key: set JAMGYM_KEY or put it in ${keyFile}. Ask the owner (see docs/adding-songs.md).`); process.exit(2); }

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    // X-JG and a same-origin Origin are required for every write (the server's CSRF check), key or no key.
    headers: { 'Content-Type': 'application/json', 'X-JG': '1', Origin: BASE, Authorization: `Bearer ${key}`, 'User-Agent': 'Mozilla/5.0 jam-gym-seed' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`); e.status = res.status; throw e; }
  return json;
}

const me = (await call('GET', '/api/me')).me;
if (me?.displayName !== 'jam-gym') throw new Error(`The key belongs to "${me?.displayName}", not jam-gym. Refusing to publish.`);
console.log('authenticated as jam-gym (system user)');

for (const t of tracks) {
  const mine = (await call('GET', '/api/tracks/mine')).tracks;
  let tr = mine.find((x) => x.title === t.title);
  if (tr?.visibility === 'published') { console.log('already published, skipped:', t.title); continue; }
  if (!tr) { tr = (await call('POST', '/api/tracks', { title: t.title, description: t.description, data: t.data })).track; console.log('created draft', tr.id, t.title); }
  await call('POST', `/api/tracks/${tr.id}/publish`);
  console.log('published', tr.id, '|', t.title);
}

// ---- verify as an anonymous visitor ----
const list = await (await fetch(`${BASE}/api/browse?q=&limit=100`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
const mineNow = list.items.filter((i) => (i.author?.name ?? i.author?.displayName ?? i.author) === 'jam-gym');
console.log(`\nBrowse lists ${mineNow.length} tracks by jam-gym`);
let bad = 0;
for (const w of tracks) {
  const m = mineNow.find((i) => i.title === w.title);
  if (!m) { console.log('MISSING from Browse:', w.title); bad++; continue; }
  const d = (await (await fetch(`${BASE}/api/tracks/${m.id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json()).track.data;
  const same = d.song.progressionText === w.data.song.progressionText && d.song.key === w.data.song.key && d.song.tempo === w.data.song.tempo
    && d.config.style === w.data.config.style && d.config.swing === w.data.config.swing
    && JSON.stringify(d.config.kit) === JSON.stringify(w.data.config.kit) && JSON.stringify(d.config.bass) === JSON.stringify(w.data.config.bass)
    && JSON.stringify(d.config.comp) === JSON.stringify(w.data.config.comp);
  console.log(same ? 'OK  ' : 'DIFF', w.title.padEnd(28), m.id);
  if (!same) bad++;
}
console.log(bad ? `${bad} problem(s)` : 'all match what was intended');
process.exit(bad ? 1 : 0);
