// Synthesised instruments. No samples: everything is built from oscillators and noise, so the
// app loads instantly and works offline. Each function schedules one note at audio time `t`
// into the node `out`; nodes clean themselves up when their `stop()` time passes.
//
// Pure Web Audio: works on AudioContext and OfflineAudioContext alike.

import { midiToFreq } from '../theory/notes.js';

// ---- helpers -----------------------------------------------------------------------------

const noiseBuffers = new WeakMap();

function noiseBuffer(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 3), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

function noiseSource(ctx, t, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.start(t, Math.random() * 1.2);
  src.stop(t + dur);
  return src;
}

/** Gain node with an attack/exponential-decay envelope. */
function envelope(ctx, t, { peak, attack = 0.002, tc }) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(0, t + attack, tc);
  return g;
}

function osc(ctx, type, freq, t, stop) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start(t);
  o.stop(stop);
  return o;
}

const waves = new WeakMap();

/** One oscillator with a custom harmonic mix costs far less than several stacked oscillators. */
function harmonicOsc(ctx, key, harmonics, freq, t, stop) {
  let cache = waves.get(ctx);
  if (!cache) { cache = new Map(); waves.set(ctx, cache); }
  let wave = cache.get(key);
  if (!wave) {
    const imag = new Float32Array(harmonics.length + 1);
    harmonics.forEach((h, i) => { imag[i + 1] = h; });
    wave = ctx.createPeriodicWave(new Float32Array(imag.length), imag);
    cache.set(key, wave);
  }
  const o = ctx.createOscillator();
  o.setPeriodicWave(wave);
  o.frequency.value = freq;
  o.start(t);
  o.stop(stop);
  return o;
}

function filter(ctx, type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// ---- drums -------------------------------------------------------------------------------

function kick(ctx, out, t, vel) {
  const soft = vel < 0.35; // "feathered" jazz kick
  const o = osc(ctx, 'sine', 100, t, t + 0.6);
  o.frequency.setValueAtTime(soft ? 95 : 150, t);
  o.frequency.exponentialRampToValueAtTime(soft ? 55 : 46, t + 0.08);
  const g = envelope(ctx, t, { peak: Math.min(1, vel * (soft ? 1.7 : 1.05)), tc: soft ? 0.07 : 0.11 });
  o.connect(g).connect(out);
  if (!soft) {
    const n = noiseSource(ctx, t, 0.03);
    const hp = filter(ctx, 'highpass', 1800);
    const cg = envelope(ctx, t, { peak: vel * 0.3, attack: 0.001, tc: 0.006 });
    n.connect(hp).connect(cg).connect(out);
  }
}

function snare(ctx, out, t, vel) {
  const ghost = vel < 0.4;
  const n = noiseSource(ctx, t, 0.5);
  const hp = filter(ctx, 'highpass', 1400);
  const bp = filter(ctx, 'peaking', 3200, 0.8);
  bp.gain.value = 5;
  const ng = envelope(ctx, t, { peak: vel * 1.4, attack: 0.001, tc: ghost ? 0.03 : 0.06 });
  n.connect(hp).connect(bp).connect(ng).connect(out);

  const body = osc(ctx, 'triangle', 190, t, t + 0.3);
  body.frequency.setValueAtTime(230, t);
  body.frequency.exponentialRampToValueAtTime(170, t + 0.05);
  const bg = envelope(ctx, t, { peak: vel * 0.8, attack: 0.001, tc: 0.035 });
  body.connect(bg).connect(out);
}

// cross-stick ("rim click"): the stick laid across the snare and struck on the rim, a short dry "tock"
function rim(ctx, out, t, vel) {
  osc(ctx, 'triangle', 1700, t, t + 0.06).connect(envelope(ctx, t, { peak: vel * 0.5, attack: 0.0008, tc: 0.008 })).connect(out);
  osc(ctx, 'sine', 420, t, t + 0.09).connect(envelope(ctx, t, { peak: vel * 0.3, attack: 0.001, tc: 0.02 })).connect(out);
  const n = noiseSource(ctx, t, 0.08);
  n.connect(filter(ctx, 'bandpass', 2600, 1.2)).connect(envelope(ctx, t, { peak: vel * 0.7, attack: 0.0008, tc: 0.012 })).connect(out);
}

function hat(ctx, out, t, vel, { open = false, pedal = false } = {}) {
  const n = noiseSource(ctx, t, open ? 1 : 0.2);
  const hp = filter(ctx, 'highpass', pedal ? 4200 : 7200);
  const bp = filter(ctx, 'peaking', 10000, 1);
  bp.gain.value = 6;
  const g = envelope(ctx, t, {
    peak: vel * (pedal ? 0.4 : 0.42), attack: 0.001, tc: open ? 0.11 : pedal ? 0.02 : 0.016,
  });
  n.connect(hp).connect(bp).connect(g).connect(out);
}

// The classic 808-style metallic cluster: six detuned squares through band/high-pass.
const METAL = [263, 400, 421, 474, 587, 845];

function metal(ctx, out, t, { vel, tc, peak, hp, bp, scale = 1, dur, partials = METAL }) {
  const sum = ctx.createGain();
  sum.gain.value = 0.16 * (METAL.length / partials.length);
  for (const f of partials) osc(ctx, 'square', f * scale, t, t + dur).connect(sum);
  const band = filter(ctx, 'bandpass', bp, 0.5);
  const high = filter(ctx, 'highpass', hp, 0.7);
  const g = envelope(ctx, t, { peak: vel * peak, attack: 0.001, tc });
  sum.connect(band).connect(high).connect(g).connect(out);
}

// ride: three metallic partials for the "ping" plus a short noise wash
function ride(ctx, out, t, vel) {
  metal(ctx, out, t, { vel, tc: 0.13, peak: 2.4, hp: 4200, bp: 7500, scale: 1.6, dur: 0.6, partials: [400, 474, 845] });
  const n = noiseSource(ctx, t, 0.6);
  const hp = filter(ctx, 'highpass', 6500);
  n.connect(hp).connect(envelope(ctx, t, { peak: vel * 0.16, attack: 0.002, tc: 0.16 })).connect(out);
}

// brushes on a snare head: a tap is a short, soft-edged burst of filtered noise; a sweep is a long, slowly rising swish
function brush(ctx, out, t, vel, { sweep = false } = {}) {
  const n = noiseSource(ctx, t, sweep ? 0.9 : 0.4);
  const hp = filter(ctx, 'highpass', sweep ? 1800 : 1500);
  const bp = filter(ctx, 'bandpass', sweep ? 4200 : 3600, sweep ? 0.5 : 0.7);
  const g = envelope(ctx, t, { peak: vel * (sweep ? 1.5 : 1.7), attack: sweep ? 0.07 : 0.006, tc: sweep ? 0.2 : 0.07 });
  n.connect(hp).connect(bp).connect(g).connect(out);
  if (!sweep && vel > 0.5) { // an accented tap has a little of the drum's body in it
    const body = osc(ctx, 'triangle', 200, t, t + 0.15);
    body.connect(envelope(ctx, t, { peak: vel * 0.25, attack: 0.002, tc: 0.03 })).connect(out);
  }
}

// a brushed crash: the brush is dragged across the cymbal, so the sound swells in over about a tenth of a second and
// hushes away, with the wash of the brush itself on top. Much softer and shorter-edged than a stick crash.
function brushCrash(ctx, out, t, vel) {
  const sum = ctx.createGain();
  sum.gain.value = 0.11;
  for (const f of [263, 421, 587, 845]) osc(ctx, 'square', f * 1.25, t, t + 2).connect(sum);
  const band = filter(ctx, 'bandpass', 8000, 0.5);
  const high = filter(ctx, 'highpass', 3500, 0.7);
  sum.connect(band).connect(high).connect(envelope(ctx, t, { peak: vel * 0.9, attack: 0.09, tc: 0.4 })).connect(out);
  const n = noiseSource(ctx, t, 1.4);
  const hp = filter(ctx, 'highpass', 5000);
  n.connect(hp).connect(envelope(ctx, t, { peak: vel * 0.32, attack: 0.1, tc: 0.32 })).connect(out);
}

const crash = (ctx, out, t, vel) =>
  metal(ctx, out, t, { vel, tc: 0.5, peak: 1.3, hp: 3500, bp: 8000, scale: 1.25, dur: 2.2, partials: [263, 421, 587, 845] });

function tom(ctx, out, t, vel, freq) {
  const o = osc(ctx, 'sine', freq, t, t + 0.6);
  o.frequency.setValueAtTime(freq * 1.5, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
  o.connect(envelope(ctx, t, { peak: vel * 0.9, tc: 0.1 })).connect(out);
}

function click(ctx, out, t, vel) {
  const o = osc(ctx, 'sine', vel > 0.9 ? 2000 : 1500, t, t + 0.1);
  o.connect(envelope(ctx, t, { peak: 0.5 * vel, attack: 0.001, tc: 0.012 })).connect(out);
}

const DRUM_VOICES = {
  kick,
  snare,
  hat: (c, o, t, v) => hat(c, o, t, v),
  hatOpen: (c, o, t, v) => hat(c, o, t, v, { open: true }),
  hatPedal: (c, o, t, v) => hat(c, o, t, v, { pedal: true }),
  ride,
  rim,
  brush,
  brushCrash,
  swish: (c, o, t, v) => brush(c, o, t, v, { sweep: true }),
  crash,
  tomHigh: (c, o, t, v) => tom(c, o, t, v, 220),
  tomMid: (c, o, t, v) => tom(c, o, t, v, 160),
  tomLow: (c, o, t, v) => tom(c, o, t, v, 110),
  click,
};

export function playDrum(ctx, out, voice, t, vel) {
  const fn = DRUM_VOICES[voice];
  if (fn) fn(ctx, out, t, vel);
}

// ---- bass --------------------------------------------------------------------------------

// Filter cutoffs are static on purpose: automating a biquad's frequency makes the browser
// recompute its coefficients for every sample, which is far too expensive per note. The pluck's
// brightness comes from a second, fast-decaying "bite" layer instead.
const BASS = {
  // upright: round and woody, plucked decay
  upright: { wave: [1, 0.55, 0.22, 0.1], body: 520, bright: 1400, bite: 0.05, biteLevel: 0.3, gain: 0.95, atk: 0.008, sustain: 0.3, tc: 0.35, rel: 0.05 },
  // electric finger bass: warmer saw, longer sustain
  electric: { wave: [1, 0.6, 0.4, 0.3, 0.22, 0.17, 0.13, 0.1], body: 800, bright: 2200, bite: 0.07, biteLevel: 0.28, gain: 0.75, atk: 0.005, sustain: 0.6, tc: 0.5, rel: 0.05 },
  // pick: brighter, tighter
  pick: { wave: [1, 0.55, 0.38, 0.28, 0.22, 0.18, 0.15, 0.12], body: 1100, bright: 3200, bite: 0.05, biteLevel: 0.4, gain: 0.7, atk: 0.003, sustain: 0.55, tc: 0.25, rel: 0.035 },
};

export function playBass(ctx, out, t, dur, midi, vel, timbre) {
  const c = BASS[timbre] ?? BASS.upright;
  const f = midiToFreq(midi);
  const end = t + dur + c.rel * 8 + 0.05;

  const lp = filter(ctx, 'lowpass', Math.max(c.body, f * 4), 0.9);
  const g = ctx.createGain();
  const peak = vel * c.gain;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + c.atk);
  g.gain.setTargetAtTime(peak * c.sustain, t + c.atk, c.tc);
  g.gain.setTargetAtTime(0, t + dur, c.rel);

  harmonicOsc(ctx, `bass-${timbre}`, c.wave, f, t, end).connect(lp);
  lp.connect(g).connect(out);

  // the pluck's initial brightness
  const bite = osc(ctx, 'sawtooth', f, t, t + 0.45);
  const biteLp = filter(ctx, 'lowpass', c.bright * (0.6 + 0.6 * vel), 0.7);
  bite.connect(biteLp).connect(envelope(ctx, t, { peak: vel * c.biteLevel, attack: c.atk, tc: c.bite })).connect(out);
}

// ---- chord instruments -------------------------------------------------------------------

/** Electric-piano flavour: two-operator FM with a decaying "tine" partial. */
function epiano(ctx, out, t, dur, midi, vel) {
  const f = midiToFreq(midi);
  const end = t + dur + 0.5;
  const car = osc(ctx, 'sine', f, t, end);
  const mod = osc(ctx, 'sine', f, t, end);
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(f * (0.9 + 1.8 * vel), t);
  modGain.gain.setTargetAtTime(f * 0.35, t, 0.22);
  mod.connect(modGain).connect(car.frequency);

  const tine = osc(ctx, 'sine', f * 7, t, t + 0.15);
  const tineG = envelope(ctx, t, { peak: vel * 0.05, attack: 0.001, tc: 0.03 });
  tine.connect(tineG).connect(out);

  const tc = Math.min(2.2, Math.max(0.4, 1.5 * (262 / f) ** 0.5));
  const g = ctx.createGain();
  const peak = vel * 0.24;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.003);
  g.gain.setTargetAtTime(0, t + 0.003, tc);
  car.connect(g);
  // let it ring for the length of the note, then release
  const rel = ctx.createGain();
  rel.gain.setValueAtTime(1, t);
  rel.gain.setTargetAtTime(0, t + dur, 0.09);
  g.connect(rel).connect(out);
}

/** Drawbar-organ flavour: one oscillator carrying a drawbar-style harmonic mix, sustained. */
function organ(ctx, out, t, dur, midi, vel) {
  const f = midiToFreq(midi);
  const end = t + dur + 0.4;
  const g = ctx.createGain();
  const peak = vel * 0.2;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.012);
  g.gain.setTargetAtTime(0, t + dur, 0.05);
  const o = harmonicOsc(ctx, 'organ', [1, 0.8, 0.5, 0.3, 0, 0.2], f, t, end);
  o.detune.value = (Math.random() - 0.5) * 6;
  o.connect(g).connect(out);
}

/** Electric-guitar flavour: detuned saws into the bus's shared amp (see AudioEngine). */
function guitar(ctx, out, t, dur, midi, vel, art) {
  const f = midiToFreq(midi);
  const muted = art === 'mute';
  const length = muted ? Math.min(dur, 0.14) : dur;
  const end = t + length + 0.4;

  const lp = filter(ctx, 'lowpass', muted ? 1000 : 2400 * (0.7 + 0.5 * vel), 1);

  const g = ctx.createGain();
  const peak = vel * 0.17;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.002);
  g.gain.setTargetAtTime(peak * 0.35, t + 0.002, muted ? 0.05 : 0.5);
  g.gain.setTargetAtTime(0, t + length, muted ? 0.02 : 0.06);

  osc(ctx, 'sawtooth', f, t, end).connect(lp);
  lp.connect(g).connect(out);
}

export function playChordNote(ctx, out, t, dur, midi, vel, timbre, art) {
  if (timbre === 'organ') organ(ctx, out, t, dur, midi, vel);
  else if (timbre === 'guitar') guitar(ctx, out, t, dur, midi, vel, art);
  else epiano(ctx, out, t, dur, midi, vel);
}

/** Soft-clip curve for the shared guitar amp. */
export function distortionCurve(amount = 3, samples = 1024) {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}
