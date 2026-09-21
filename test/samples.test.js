import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { findVoice, layerGain, pickLayer, pickNote, pitchRate } from '../src/audio/samplemap.js';
import { BASS_SOUNDS, DRUM_SOUNDS, KEY_SOUNDS, getStyle, listStyles, resolveTimbres } from '../src/styles/index.js';

const SAMPLES = fileURLToPath(new URL('../samples/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(SAMPLES, 'manifest.json'), 'utf8'));

/** Minimal 16-bit PCM WAV reader: enough to check the files we ship. */
function readWav(path) {
  const b = readFileSync(path);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(pos + 8), channels: b.readUInt16LE(pos + 10), rate: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    if (id === 'data') data = b.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  const n = data.length / 2;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data.readInt16LE(i * 2)) / 32768);
  return { ...fmt, seconds: n / fmt.channels / fmt.rate, peak };
}

test('pickLayer chooses the nearest velocity layer', () => {
  const layers = [{ ref: 0.25 }, { ref: 0.5 }, { ref: 0.75 }, { ref: 1 }];
  assert.equal(pickLayer(layers, 0.1).ref, 0.25);
  assert.equal(pickLayer(layers, 0.4).ref, 0.5);
  assert.equal(pickLayer(layers, 0.9).ref, 1);
  assert.equal(pickLayer(layers, 0.375).ref, 0.5); // a tie goes to the harder layer
  assert.equal(pickLayer([{ ref: 1 }], 0.2).ref, 1);
});

test('pickNote finds the closest recorded key and pitch-shifts by the difference', () => {
  const notes = [{ midi: 48 }, { midi: 51 }, { midi: 54 }];
  assert.equal(pickNote(notes, 50).midi, 51);
  assert.equal(pickNote(notes, 49.4).midi, 48);
  assert.equal(pickNote(notes, 51.5).midi, 51);
  assert.equal(pickNote([{ midi: 48 }, { midi: 52 }], 50).midi, 48); // tie -> lower root
  assert.equal(pitchRate(60, 60), 1);
  assert.ok(Math.abs(pitchRate(72, 60) - 2) < 1e-12);
  assert.ok(Math.abs(pitchRate(59, 60) - 2 ** (-1 / 12)) < 1e-12);
});

test('layerGain trims within a layer and is clamped', () => {
  assert.equal(layerGain(0.5, 0.5), 1);
  assert.ok(layerGain(0.2, 1) === 0.6);
  assert.ok(layerGain(1, 0.25) === 1.3);
});

test('a kit missing a voice borrows a relative instead of going silent', () => {
  const voices = { hat: [1], tomHigh: [2] };
  assert.equal(findVoice(voices, 'hatPedal'), voices.hat);
  assert.equal(findVoice(voices, 'tomLow'), voices.tomHigh); // tomLow -> tomMid (absent) -> tomHigh
  assert.equal(findVoice(voices, 'hat'), voices.hat);
  assert.equal(findVoice(voices, 'kick'), null);
});

test('sound choices: the style decides unless the user overrides', () => {
  const jazz = getStyle('jazz');
  assert.deepEqual([resolveTimbres(jazz).drums, resolveTimbres(jazz).chords], ['jazz', 'piano']);
  assert.deepEqual([resolveTimbres(getStyle('rock')).drums, resolveTimbres(getStyle('rock')).chords], ['rock', 'guitar']);
  assert.equal(resolveTimbres(jazz, { drums: 'rock', keys: 'organ' }).drums, 'rock');
  assert.equal(resolveTimbres(jazz, { drums: 'rock', keys: 'organ' }).chords, 'organ');
  assert.equal(resolveTimbres(jazz, { drums: 'auto', keys: 'auto' }).chords, 'piano');
  assert.equal(resolveTimbres(jazz, { drums: 'nonsense', keys: 'nope' }).drums, 'jazz'); // unknown ids are ignored
  assert.equal(resolveTimbres(jazz, {}).bass, 'double');
  assert.equal(resolveTimbres(getStyle('blues'), {}).bass, 'guitar');
  assert.equal(resolveTimbres(getStyle('rock'), {}).bass, 'bright');
  assert.equal(resolveTimbres(jazz, { bass: 'pick' }).bass, 'pick');
  assert.equal(resolveTimbres(jazz, { bass: 'auto' }).bass, 'double');
  assert.equal(resolveTimbres(jazz, { bass: 'tuba' }).bass, 'double', 'unknown ids are ignored');
  for (const s of listStyles()) {
    assert.ok(DRUM_SOUNDS.some((d) => d.id === s.timbres.drums), `${s.id} default drums exist`);
    assert.ok(KEY_SOUNDS.some((k) => k.id === s.timbres.chords), `${s.id} default keys exist`);
    assert.ok(BASS_SOUNDS.some((b) => b.id === s.timbres.bass), `${s.id} default bass exists`);
  }
});

test('every sampled sound in the UI has a bank in the manifest, and vice versa', () => {
  for (const d of DRUM_SOUNDS.filter((x) => x.sampled)) assert.ok(manifest.drums[d.id], `drums:${d.id}`);
  for (const k of KEY_SOUNDS.filter((x) => x.sampled)) assert.ok(manifest.keys[k.id], `keys:${k.id}`);
  assert.deepEqual(Object.keys(manifest.drums).sort(), DRUM_SOUNDS.filter((x) => x.sampled).map((x) => x.id).sort());
  assert.deepEqual(Object.keys(manifest.keys).sort(), KEY_SOUNDS.filter((x) => x.sampled).map((x) => x.id).sort());
  for (const b of BASS_SOUNDS.filter((x) => x.sampled)) assert.ok(manifest.basses[b.id], `basses:${b.id}`);
  assert.deepEqual(Object.keys(manifest.basses).sort(), BASS_SOUNDS.filter((x) => x.sampled).map((x) => x.id).sort());
});

const NEEDED_VOICES = ['kick', 'snare', 'hat', 'hatOpen', 'ride', 'crash', 'tomHigh', 'tomMid', 'tomLow'];

for (const [id, kit] of Object.entries(manifest.drums)) {
  test(`drum kit "${id}": complete, every file is a sound WAV, layers get louder, credit present`, () => {
    assert.ok(kit.credit && kit.name);
    for (const v of NEEDED_VOICES) assert.ok(kit.voices[v]?.length, `${id} has ${v}`);
    for (const [voice, layers] of Object.entries(kit.voices)) {
      let lastPeak = 0;
      for (const layer of layers) {
        assert.ok(layer.ref > 0 && layer.ref <= 1);
        assert.ok(layer.files.length >= 1);
        const peaks = layer.files.map((f) => {
          assert.ok(existsSync(join(SAMPLES, f)), `missing ${f}`);
          const w = readWav(join(SAMPLES, f));
          assert.equal(w.format, 1);
          assert.equal(w.channels, 1, 'mono');
          assert.equal(w.bits, 16);
          assert.ok([44100, 48000].includes(w.rate), `rate ${w.rate}`);
          assert.ok(w.seconds > 0.05 && w.seconds < 3, `${f} is ${w.seconds}s`);
          assert.ok(w.peak > 0.15 && w.peak <= 1, `${f} peak ${w.peak}`);
          return w.peak;
        });
        const avg = peaks.reduce((a, b) => a + b, 0) / peaks.length;
        assert.ok(avg >= lastPeak - 0.05, `${id}/${voice}: layer ${layer.ref} quieter than the one below`);
        lastPeak = avg;
      }
    }
  });
}

for (const [id, bank] of Object.entries(manifest.keys)) {
  test(`keyboard "${id}": notes span the range comping uses, files are sound WAVs`, () => {
    assert.ok(bank.credit && bank.name && bank.release > 0 && bank.gain > 0);
    const midis = bank.notes.map((n) => n.midi);
    assert.ok(Math.min(...midis) <= 42 && Math.max(...midis) >= 79, `range ${Math.min(...midis)}-${Math.max(...midis)}`);
    const layers = new Set(bank.notes.map((n) => n.ref ?? 1));
    for (const ref of layers) {
      const ms = bank.notes.filter((n) => (n.ref ?? 1) === ref).map((n) => n.midi).sort((a, b) => a - b);
      for (let i = 1; i < ms.length; i++) assert.ok(ms[i] - ms[i - 1] <= 8, `gap ${ms[i - 1]}-${ms[i]} in layer ${ref}`);
    }
    for (const n of bank.notes) {
      assert.ok(existsSync(join(SAMPLES, n.file)), n.file);
      const w = readWav(join(SAMPLES, n.file));
      assert.equal(w.channels, 1);
      assert.ok(w.seconds > 0.3 && w.seconds < 5, `${n.file} ${w.seconds}s`);
      assert.ok(w.peak > 0.3, `${n.file} peak ${w.peak}`);
    }
  });
}

for (const [id, bank] of Object.entries(manifest.basses)) {
  test(`bass "${id}": covers a bass's range in small steps, layers get louder, files are sound WAVs, credit present`, () => {
    assert.ok(bank.credit && bank.name && bank.release > 0 && bank.gain > 0);
    const layers = new Map();
    for (const n of bank.notes) layers.set(n.ref, [...(layers.get(n.ref) ?? []), n]);
    assert.ok(layers.size >= 2, 'at least two dynamics');
    let lastPeak = 0;
    for (const ref of [...layers.keys()].sort((a, b) => a - b)) {
      const notes = layers.get(ref).sort((a, b) => a.midi - b.midi);
      assert.ok(notes[0].midi <= 28 && notes[notes.length - 1].midi >= 52, `layer ${ref} spans ${notes[0].midi}-${notes[notes.length - 1].midi} (E1 to E3 is 28-52)`);
      for (let i = 1; i < notes.length; i++) assert.ok(notes[i].midi - notes[i - 1].midi <= 4, `gap ${notes[i - 1].midi}-${notes[i].midi}: a recorded bass is pitch-shifted by at most two semitones`);
      const peaks = notes.map((n) => {
        assert.ok(existsSync(join(SAMPLES, n.file)), n.file);
        const w = readWav(join(SAMPLES, n.file));
        assert.equal(w.channels, 1);
        assert.equal(w.bits, 16);
        assert.ok(w.seconds > 1.2 && w.seconds < 3.2, `${n.file} is ${w.seconds}s: long enough for a half note, short enough to load fast`);
        assert.ok(w.peak > 0.12 && w.peak <= 1, `${n.file} peak ${w.peak}`);
        return w.peak;
      });
      const avg = peaks.reduce((a, b) => a + b, 0) / peaks.length;
      assert.ok(avg >= lastPeak - 0.03, `${id}: layer ${ref} is quieter than the one below`);
      lastPeak = avg;
    }
  });
}

test('the bundle stays a reasonable size', () => {
  let total = 0;
  const files = new Set();
  for (const kit of Object.values(manifest.drums)) for (const l of Object.values(kit.voices).flat()) l.files.forEach((f) => files.add(f));
  for (const bank of Object.values(manifest.keys)) bank.notes.forEach((n) => files.add(n.file));
  for (const bank of Object.values(manifest.basses)) bank.notes.forEach((n) => files.add(n.file));
  for (const f of files) total += statSync(join(SAMPLES, f)).size;
  assert.ok(total < 26e6, `${(total / 1e6).toFixed(1)} MB`);
});
