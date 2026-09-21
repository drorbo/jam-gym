import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cleanText, formatSecret, isSecret, newSecret, normalizeSecret, randomId, sha256 } from '../server/util.js';
import { asChordWord, chordToken, prepareText, prepareTrackData } from '../server/trackdata.js';
import { buildMatch, parseBrowseParams } from '../server/search.js';
import { createLimiter } from '../server/limits.js';
import { SCHEMA_VERSION, openDatabase, transaction } from '../server/db.js';
import { buildCsp, fingerprints, versionedHtml } from '../server/static.js';
import { listBackups, snapshot } from '../server/backup.js';
import { loadConfig } from '../server/config.js';
import { parseChord } from '../src/theory/chord.js';
import { trackData } from './harness.js';

// ---- util ----------------------------------------------------------------------------------

test('ids and secrets: right shape, alphabet and uniqueness', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => randomId(10)));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^[0-9A-Za-z]{10}$/);
  const s = newSecret();
  assert.equal(s.length, 32);
  assert.ok(isSecret(s));
  assert.match(s, /^[0-9A-HJKMNP-TV-Z]{32}$/, 'Crockford base32 has no I, L, O or U');
  assert.ok(!isSecret('short'));
  assert.ok(!isSecret(s.slice(0, 31) + 'U'));
  assert.ok(!isSecret(undefined));
});

test('id generation has no modulo bias worth worrying about (all characters appear, roughly evenly)', () => {
  const counts = new Map();
  for (let i = 0; i < 3000; i++) for (const c of randomId(20)) counts.set(c, (counts.get(c) ?? 0) + 1);
  assert.equal(counts.size, 62);
  const values = [...counts.values()];
  assert.ok(Math.max(...values) / Math.min(...values) < 1.5, 'even spread');
});

test('recovery codes: formatted for people, and forgiving of how they are typed', () => {
  const s = newSecret();
  const code = formatSecret(s);
  assert.match(code, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  assert.equal(normalizeSecret(code), s);
  assert.equal(normalizeSecret(` ${code.toLowerCase()} `), s);
  assert.equal(normalizeSecret(code.replace(/-/g, ' ')), s);
  assert.equal(normalizeSecret('OIl1'), '0111', 'look-alike characters are fixed');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('cleanText: trims, collapses, strips control and direction-override characters, counts characters not bytes', () => {
  assert.equal(cleanText('  hello   world \n', 50), 'hello world');
  assert.equal(cleanText('a\u0000b\u0007c', 50), 'abc');
  assert.equal(cleanText('safe‮text', 50), 'safetext', 'no right-to-left override');
  assert.equal(cleanText('x'.repeat(200), 80).length, 80);
  assert.equal([...cleanText('🎸'.repeat(100), 10)].length, 10, 'emoji count as one character each');
  assert.equal(cleanText(undefined, 10), '');
  assert.equal(cleanText('line1\n\n\n\nline2', 50, { multiline: true }), 'line1\n\nline2');
  assert.equal(cleanText('<script>alert(1)</script>', 50), '<script>alert(1)</script>', 'stored as text; the UI never treats it as HTML');
});

// ---- track data ----------------------------------------------------------------------------

test('a valid setup is accepted, sanitised, and its search columns are copied out', () => {
  const p = prepareTrackData(trackData({ song: { progressionText: 'Dm7 | G7 | Cmaj7 A7', tempo: 150, key: 'C' } }));
  assert.equal(p.style, 'jazz');
  assert.equal(p.tempo, 150);
  assert.equal(p.bars, 3);
  assert.equal(p.chords, 'Dm7 G7 Cmaj7 A7');
  assert.equal(p.data.v, 1);
  assert.equal(p.chordTokens.split(' ').length, 4);
  assert.ok(!('theme' in p.data), 'personal preferences are not part of a track');
});

test('junk is repaired or refused, never stored as is', () => {
  const clamp = prepareTrackData(trackData({ song: { tempo: 9999 }, config: { style: 'polka', swing: 400, sounds: { drums: 'x' } } }));
  assert.equal(clamp.tempo, 220);
  assert.equal(clamp.style, 'jazz');
  assert.equal(clamp.data.config.swing, 75);
  assert.equal(clamp.data.config.sounds.drums, 'auto');
  const bad = (raw, re) => assert.throws(() => prepareTrackData(raw), re);
  bad(null, /missing/);
  bad([], /missing/);
  bad({ v: 2, song: {} }, /Unsupported/);
  bad({ v: 1 }, /chord progression/);
  bad({ v: 1, song: { progressionText: '   ' } }, /chord progression/);
  bad({ v: 1, song: { progressionText: 42 } }, /chord progression/);
  bad(trackData({ song: { progressionText: 'Cmaj7 | Xyz' } }), /Xyz|note name/);
  bad(trackData({ song: { progressionText: 'C Dm G', timeSignature: '6/8' } }), /at most 2/);
  bad(trackData({ song: { progressionText: Array(201).fill('C').join(' | ') } }), /at most 200 bars/);
  bad(trackData({ song: { progressionText: 'C | '.repeat(2000) } }), /too (large|long)/);
});

test('an unusual but playable progression is accepted', () => {
  const p = prepareTrackData(trackData({ song: { progressionText: 'C13sus4 | F#m7b5/C | Bbmaj7#11 | E7#9b13 | NC | % | Adim7/Eb' } }));
  assert.equal(p.bars, 7);
});

test('chord tokens identify a chord by its content, not its spelling', () => {
  const tok = (s) => chordToken(parseChord(s));
  assert.equal(tok('Cm7'), tok('C-7'));
  assert.equal(tok('Cm7'), tok('Cmin7'));
  assert.equal(tok('Cmaj7'), tok('CM7'));
  assert.equal(tok('C#m7'), tok('Dbm7'));
  assert.notEqual(tok('Cm7'), tok('CM7'), 'minor and major sevenths differ');
  assert.notEqual(tok('C7'), tok('Cmaj7'));
  assert.notEqual(tok('C'), tok('C/E'));
  assert.equal(tok('C/C'), tok('C'), 'a slash to the root is no slash');
  assert.match(tok('F#m7b5/C'), /^[a-z0-9]+$/, 'letters and digits only, so the tokenizer keeps it whole');
});

test('which search words count as chords', () => {
  for (const w of ['Am', 'Dm7', 'G7', 'Bb7', 'F#m7b5', 'Cmaj7', 'C/E', 'Ebmaj7']) assert.ok(asChordWord(w), w);
  for (const w of ['A', 'Bb', 'blues', 'jazz', 'bossa', 'add', 'Autumn', 'in', 'the', 'C']) assert.equal(asChordWord(w), null, w);
});

test('titles and descriptions are cleaned and titles are required', () => {
  assert.deepEqual(prepareText({ title: '  My   Tune ', description: ' hi ' }), { title: 'My Tune', description: 'hi' });
  assert.throws(() => prepareText({ title: '   ' }), /title/);
  assert.equal(prepareText({ title: 'x'.repeat(500) }).title.length, 80);
  assert.equal(prepareText({ title: '' }, { requireTitle: false }).title, '');
});

// ---- search --------------------------------------------------------------------------------

test('search input becomes a safe FTS query', () => {
  assert.equal(buildMatch(''), null);
  assert.equal(buildMatch('   '), null);
  assert.equal(buildMatch('***'), null, 'punctuation only');
  assert.equal(buildMatch('blues'), '({title description author} : "blues"*)');
  const two = buildMatch('blues in');
  assert.match(two, /^\(.*"blues".*\) AND \(.*"in".*\)$/);
  const chord = buildMatch('Dm7');
  assert.match(chord, /chords : "r2s0z3z7z10"/, 'a chord word also searches by chord');
  assert.match(chord, /OR/);
  // hostile input stays inside quotes
  const hostile = buildMatch('" OR title:* NEAR( -evil');
  for (const w of hostile.match(/"[^"]*(?:""[^"]*)*"/g)) assert.ok(w.startsWith('"') && w.endsWith('"'));
  assert.doesNotMatch(buildMatch('a"b'), /[^"]"b"/, 'quotes inside a word are doubled');
  assert.equal(buildMatch(Array(50).fill('word').join(' ')).split(' AND ').length, 8, 'at most 8 words');
  assert.equal(buildMatch('x'.repeat(500)).match(/x+/)[0].length, 40, 'words are capped');
});

test('browse parameters are clamped and defaulted', () => {
  const p = (s) => parseBrowseParams(new URLSearchParams(s));
  assert.deepEqual({ limit: p('').limit, offset: p('').offset, sort: p('').sort }, { limit: 20, offset: 0, sort: 'likes' });
  assert.equal(p('q=blues').sort, 'relevance');
  assert.equal(p('q=blues&sort=new').sort, 'new');
  assert.equal(p('sort=bogus').sort, 'likes');
  assert.equal(p('limit=9999').limit, 50);
  assert.equal(p('limit=0').limit, 1);
  assert.equal(p('offset=-5').offset, 0);
  assert.equal(p('bpmMin=abc').bpmMin, null);
  assert.equal(p('bpmMin=90&bpmMax=140').bpmMax, 140);
  assert.equal(p('q=' + 'x'.repeat(1000)).q.length, 200);
});

// ---- limiter, db, config, csp, backups ------------------------------------------------------

test('rate limiter: counts within a window, then resets', () => {
  let t = 1000;
  const l = createLimiter(() => t);
  for (let i = 0; i < 3; i++) assert.ok(l.hit('k', 3, 1000).ok);
  const blocked = l.hit('k', 3, 1000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfter, 1);
  assert.ok(l.hit('other', 3, 1000).ok, 'keys are independent');
  t += 1001;
  assert.ok(l.hit('k', 3, 1000).ok, 'a new window starts');
  l.stop();
});

test('database: migrations run once and are safe to repeat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-db-'));
  try {
    const file = join(dir, 'a.sqlite');
    const a = openDatabase(file);
    assert.equal(a.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    a.prepare("INSERT INTO users(public_id, secret_hash, display_name, created_at, last_seen_at) VALUES ('X','h','n',1,1)").run();
    a.close();
    const b = openDatabase(file); // second start: nothing is re-created, data survives
    assert.equal(b.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
    assert.equal(b.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    assert.equal(b.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(b.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('database: constraints hold (one like each, no negative counts, valid visibility)', () => {
  const db = openDatabase(':memory:');
  const u = db.prepare("INSERT INTO users(public_id, secret_hash, display_name, created_at, last_seen_at) VALUES (?, ?, 'n', 1, 1)");
  u.run('A', 'ha'); u.run('B', 'hb');
  const tr = (vis = 'private') => db.prepare(`INSERT INTO tracks(id, owner_id, title, data, style, key, time_signature, tempo, bars, chords, visibility, created_at, updated_at)
    VALUES ('t1', 1, 't', '{}', 'jazz', 'C', '4/4', 120, 1, 'C', ?, 1, 1)`).run(vis);
  assert.throws(() => tr('secret'), /CHECK/);
  tr();
  db.prepare('INSERT INTO likes(user_id, track_id, created_at) VALUES (2, ?, 1)').run('t1');
  assert.throws(() => db.prepare('INSERT INTO likes(user_id, track_id, created_at) VALUES (2, ?, 1)').run('t1'), /UNIQUE|PRIMARY/);
  assert.throws(() => db.prepare("UPDATE tracks SET like_count = -1 WHERE id = 't1'").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO likes(user_id, track_id, created_at) VALUES (99, 't1', 1)").run(), /FOREIGN/);
  db.close();
});

test('database: a failed transaction changes nothing', () => {
  const db = openDatabase(':memory:');
  assert.throws(() => transaction(db, () => {
    db.prepare("INSERT INTO users(public_id, secret_hash, display_name, created_at, last_seen_at) VALUES ('Z','z','n',1,1)").run();
    throw new Error('boom');
  }), /boom/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 0);
  db.close();
});

test('the full-text index really finds prefixes and columns', () => {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO track_search(rowid, title, description, author, chords) VALUES (1, 'Blue Bossa practice', 'slow', 'Player-AB12', 'r0s0z3z7z10')").run();
  const n = (m) => db.prepare('SELECT COUNT(*) c FROM track_search WHERE track_search MATCH ?').get(m).c;
  assert.equal(n('({title description author} : "boss"*)'), 1);
  assert.equal(n('({title description author} : "player"*)'), 1);
  assert.equal(n('(chords : "r0s0z3z7z10")'), 1);
  assert.equal(n('({title description author} : "r0s0z3z7z10"*)'), 0, 'chord tokens are not visible as words');
  assert.equal(n('({title description author} : "nothing"*)'), 0);
  db.close();
});

test('config: defaults are safe for local use, production settings come from the environment', () => {
  const dev = loadConfig({});
  assert.equal(dev.host, '127.0.0.1');
  assert.equal(dev.trustProxy, false);
  assert.equal(dev.backups, false);
  const prod = loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '8080', TRUST_PROXY: '1', BACKUPS: '1', DATA_DIR: '/data' });
  assert.deepEqual([prod.production, prod.host, prod.port, prod.trustProxy, prod.backups], [true, '0.0.0.0', 8080, true, true]);
});

test('CSP: allows the one inline script by hash and nothing inline otherwise', () => {
  const csp = buildCsp('<html><head><script>var a = 1;</script><script src="x.js"></script></head></html>');
  assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+' https:\/\/static\.cloudflareinsights\.com/);
  assert.equal((csp.match(/sha256-/g) ?? []).length, 1, 'only inline scripts are hashed');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});

test('CSP: the script hash is the same whether the file has Windows or Unix line endings', () => {
  const unix = buildCsp('<script>\n  var a = 1;\n  var b = 2;\n</script>');
  const windows = buildCsp('<script>\r\n  var a = 1;\r\n  var b = 2;\r\n</script>');
  assert.equal(windows, unix);
});

test('backups: a snapshot opens as a real database, and old ones are pruned', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-bak-'));
  try {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO users(public_id, secret_hash, display_name, created_at, last_seen_at) VALUES ('B','b','backed up',1,1)").run();
    for (let i = 0; i < 5; i++) await snapshot(db, dir, 3, new Date(Date.UTC(2026, 8, 10 + i, 12, 0)));
    const files = listBackups(dir);
    assert.equal(files.length, 3, 'keeps the newest 3');
    assert.deepEqual(files, ['jamgym-20260912-1200.sqlite', 'jamgym-20260913-1200.sqlite', 'jamgym-20260914-1200.sqlite']);
    const copy = new DatabaseSync(join(dir, files.at(-1)), { readOnly: true });
    assert.equal(copy.prepare('SELECT display_name n FROM users').get().n, 'backed up');
    copy.close();
    assert.ok(readdirSync(dir).every((f) => f.startsWith('jamgym-')), 'no stray temp files');
    db.close();
    utimesSync(dir, new Date(), new Date());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- versioned addresses -------------------------------------------------------------------


test('fingerprints: every script and stylesheet gets a short hash of its content, and a change changes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jg-fp-'));
  try {
    mkdirSync(join(dir, 'src', 'app'), { recursive: true });
    mkdirSync(join(dir, 'css'));
    writeFileSync(join(dir, 'src', 'app', 'main.js'), 'export const a = 1;');
    writeFileSync(join(dir, 'src', 'util.js'), 'export const b = 2;');
    writeFileSync(join(dir, 'css', 'app.css'), 'body{}');
    writeFileSync(join(dir, 'src', 'notes.txt'), 'not code');
    const v1 = fingerprints(dir);
    assert.deepEqual([...v1.keys()].sort(), ['/css/app.css', '/src/app/main.js', '/src/util.js']);
    for (const v of v1.values()) assert.match(v, /^[0-9a-f]{10}$/);
    writeFileSync(join(dir, 'src', 'util.js'), 'export const b = 3;');
    const v2 = fingerprints(dir);
    assert.notEqual(v2.get('/src/util.js'), v1.get('/src/util.js'));
    assert.equal(v2.get('/src/app/main.js'), v1.get('/src/app/main.js'), 'untouched files keep their address');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('versionedHtml: stylesheet and entry script are versioned and an import map versions every module, before the first module script', () => {
  const versions = new Map([['/css/app.css', 'aaaaaaaaaa'], ['/src/app/main.js', 'bbbbbbbbbb'], ['/src/app/ui.js', 'cccccccccc']]);
  const html = '<head><link rel="stylesheet" href="css/app.css"><link rel="preload" href="fonts/x.woff2"></head><body><script type="module" src="src/app/main.js"></script></body>';
  const out = versionedHtml(html, versions);
  assert.match(out, /href="css\/app\.css\?v=aaaaaaaaaa"/);
  assert.match(out, /src="src\/app\/main\.js\?v=bbbbbbbbbb"/);
  assert.match(out, /href="fonts\/x\.woff2"/, 'fonts are left alone');
  const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(out)[1]);
  assert.deepEqual(map.imports, { '/src/app/main.js': '/src/app/main.js?v=bbbbbbbbbb', '/src/app/ui.js': '/src/app/ui.js?v=cccccccccc' });
  assert.ok(out.indexOf('importmap') < out.indexOf('type="module"'), 'the import map must come first');
  assert.equal(versionedHtml('<p>no scripts</p>', versions), '<p>no scripts</p>');
});

test('CSP: the import map is allowed by its hash too', () => {
  const html = versionedHtml('<script>var t = 1;</script><script type="module" src="src/app/main.js"></script>', new Map([['/src/app/main.js', 'bbbbbbbbbb']]));
  assert.equal((buildCsp(html).match(/sha256-/g) ?? []).length, 2, 'the theme script and the import map');
});
