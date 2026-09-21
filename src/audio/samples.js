// Recorded instruments: loading (fetch + decode) and playing.
//
// Samples live in ./samples (built by tools/build_samples.py) and are described by
// samples/manifest.json. Banks are loaded on demand, so the app starts instantly and only
// downloads the kit / keyboard you actually use.

import { drumTrim, findVoice, layerGain, pickLayer, pickNote, pitchRate } from './samplemap.js';

const DEFAULT_BASE = new URL('../../samples/', import.meta.url);

export class SampleLibrary {
  /** @param {BaseAudioContext} ctx used to decode, so buffers arrive at the playback sample rate */
  constructor(ctx, base = DEFAULT_BASE) {
    this.ctx = ctx;
    this.base = base;
    this.banks = new Map();
    this.pending = new Map();
    this.manifestPromise = null;
    this.errors = new Set();
  }

  manifest() {
    this.manifestPromise ??= fetch(new URL('manifest.json', this.base)).then((r) => {
      if (!r.ok) throw new Error(`manifest.json: ${r.status}`);
      return r.json();
    });
    return this.manifestPromise;
  }

  /** Ready banks only; null while loading, failed or unknown. */
  get(kind, id) {
    return this.banks.get(`${kind}:${id}`) ?? null;
  }

  isReady(kind, id) {
    return this.banks.has(`${kind}:${id}`);
  }

  /** Load a bank. Resolves to the bank, or null if it could not be loaded (callers fall back to synths). */
  load(kind, id) {
    const key = `${kind}:${id}`;
    if (this.banks.has(key)) return Promise.resolve(this.banks.get(key));
    if (this.pending.has(key)) return this.pending.get(key);
    const p = this.#load(kind, id)
      .then((bank) => { this.banks.set(key, bank); this.errors.delete(key); return bank; })
      .catch((err) => { console.warn(`Could not load ${key}:`, err); this.errors.add(key); return null; })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  async #load(kind, id) {
    const manifest = await this.manifest();
    const def = manifest[kind]?.[id];
    if (!def) throw new Error('unknown bank');
    const files = new Map(); // file -> Promise<AudioBuffer>, so shared files load once
    const buf = (file) => {
      if (!files.has(file)) {
        files.set(file, fetch(new URL(file, this.base))
          .then((r) => { if (!r.ok) throw new Error(`${file}: ${r.status}`); return r.arrayBuffer(); })
          .then((data) => this.ctx.decodeAudioData(data)));
      }
      return files.get(file);
    };

    if (kind === 'drums') {
      const voices = {};
      for (const [voice, layers] of Object.entries(def.voices)) {
        voices[voice] = await Promise.all(layers.map(async (l) => ({
          ref: l.ref, rate: l.rate ?? 1, next: 0, buffers: await Promise.all(l.files.map(buf)),
        })));
      }
      return { id, name: def.name, credit: def.credit, voices };
    }

    const byRef = new Map();
    for (const n of def.notes) {
      const ref = n.ref ?? 1;
      if (!byRef.has(ref)) byRef.set(ref, []);
      byRef.get(ref).push({ midi: n.midi, buffer: buf(n.file) });
    }
    const layers = [];
    for (const [ref, notes] of [...byRef].sort((a, b) => a[0] - b[0])) {
      layers.push({ ref, notes: (await Promise.all(notes.map(async (n) => ({ midi: n.midi, buffer: await n.buffer })))).sort((a, b) => a.midi - b.midi) });
    }
    return { id, name: def.name, credit: def.credit, release: def.release, gain: def.gain, brightness: def.brightness, layers };
  }
}

// ---- playback --------------------------------------------------------------------------

/**
 * Play one recorded drum hit. Returns the handle so an open hi-hat can be choked, or null if the
 * kit has no such voice (the caller then falls back to the synth).
 */
export function playSampledDrum(ctx, out, bank, voice, t, vel, level = 1) {
  const layers = findVoice(bank.voices, voice);
  if (!layers) return null;
  const layer = pickLayer(layers, vel);
  const buffer = layer.buffers[layer.next++ % layer.buffers.length]; // round-robin, so repeats aren't machine-gun identical
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = layer.rate;
  const gain = ctx.createGain();
  gain.gain.value = layerGain(vel, layer.ref) * level * drumTrim(voice);
  src.connect(gain).connect(out);
  src.start(t);
  return { src, gain };
}

/** Cut a ringing hi-hat when the foot closes it. */
export function chokeHat(handle, t) {
  if (!handle) return;
  handle.gain.gain.setTargetAtTime(0, t, 0.012);
  try { handle.src.stop(t + 0.15); } catch { /* already stopped */ }
}

/** Play one note of a recorded keyboard, pitch-shifted from the nearest recorded key. */
export function playSampledNote(ctx, out, bank, t, dur, midi, vel) {
  const layer = pickLayer(bank.layers, vel);
  const note = pickNote(layer.notes, midi);
  const src = ctx.createBufferSource();
  src.buffer = note.buffer;
  src.playbackRate.value = pitchRate(midi, note.midi);

  const gain = ctx.createGain();
  const peak = bank.gain * (0.3 + 0.95 * vel);
  const tc = Math.max(0.03, bank.release / 3);
  gain.gain.setValueAtTime(peak, t);
  gain.gain.setTargetAtTime(0, t + dur, tc); // key up: the damper falls

  let node = src;
  if (bank.brightness) {
    // softer playing is darker; a static filter is cheap (automated ones are not)
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200 + 9000 * vel;
    lp.Q.value = 0.5;
    src.connect(lp);
    node = lp;
  }
  node.connect(gain).connect(out);
  src.start(t);
  src.stop(t + dur + bank.release * 2 + 0.1);
}
