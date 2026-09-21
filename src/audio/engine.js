// AudioEngine: owns the AudioContext, builds a mixer "bus" per playback run, and exposes the
// `sink` the Conductor plays into. The musical engine never touches Web Audio directly.
//
//   drums ┐                                       ┌── reverb send ──> convolver ┐
//   bass  ├─ instrument faders ─> master ─> comp ─┴─────────────────────────────┴─> speakers
//   chords┘   (volume / mute)
//   click ──────────────────────────────────────^ (count-in ignores the mixer)

import { SampleLibrary, chokeHat, playSampledDrum, playSampledNote } from './samples.js';
import { distortionCurve, playBass, playChordNote, playDrum } from './voices.js';

const INSTRUMENTS = ['drums', 'bass', 'chords'];
// Output trims so equal fader positions sound roughly balanced.
const TRIM = { drums: 1.15, bass: 0.45, chords: 1.35 };
// Recorded kits and keyboards are normalised to about -2 dBFS, hotter than the synths above.
const SAMPLE_LEVEL = { drums: 1.0, keys: 0.75, bass: 1.0 };
// While a recorded bass is still loading (or could not load), its synth cousin plays instead.
const BASS_FALLBACK = { double: 'upright', guitar: 'electric', bright: 'pick' };
// How much of each instrument goes to the room reverb.
const SEND = { drums: 0.1, bass: 0, chords: 0.22 };

/** Slider position (0..1) to gain. Squared: fader feel is closer to how loudness is perceived. */
export const volumeToGain = (v) => v * v;

function makeImpulse(ctx, seconds = 1.1, decay = 3) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      lp += ((Math.random() * 2 - 1) - lp) * 0.4; // darken the tail
      d[i] = lp * (1 - i / length) ** decay;
    }
  }
  return buf;
}

export class Bus {
  constructor(ctx, impulse, mixer, library = null) {
    this.ctx = ctx;
    this.library = library;
    this.openHat = null;
    this.muted = {};
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    reverb.connect(wet).connect(this.master);

    this.faders = {};
    for (const inst of INSTRUMENTS) {
      const fader = ctx.createGain();
      fader.connect(this.master);
      if (SEND[inst]) {
        const send = ctx.createGain();
        send.gain.value = SEND[inst];
        fader.connect(send).connect(reverb);
      }
      this.faders[inst] = fader;
    }
    this.clickOut = ctx.createGain();
    this.clickOut.gain.value = 0.7;
    this.clickOut.connect(this.master);

    // Timbre inputs feeding the chords fader; each style picks one.
    const epiano = ctx.createBiquadFilter();
    epiano.type = 'lowpass';
    epiano.frequency.value = 6000;
    epiano.connect(this.faders.chords);

    const organ = ctx.createGain();
    organ.gain.value = 1;
    organ.connect(this.faders.chords);

    const amp = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(3.5);
    shaper.oversample = '2x';
    const cab = ctx.createBiquadFilter();
    cab.type = 'lowpass';
    cab.frequency.value = 3800;
    const ampOut = ctx.createGain();
    ampOut.gain.value = 0.45;
    amp.connect(shaper).connect(cab).connect(ampOut).connect(this.faders.chords);
    // recorded keyboards go straight to the fader: they already sound like themselves
    this.chordInputs = { epiano, organ, guitar: amp, sampled: this.faders.chords };

    this.setMixer(mixer, true);
  }

  /** @param {Record<string,{volume:number, muted:boolean}>} mixer */
  setMixer(mixer, immediate = false) {
    for (const inst of INSTRUMENTS) this.setLevel(inst, mixer[inst], immediate);
  }

  setLevel(inst, { volume, muted }, immediate = false) {
    this.muted[inst] = muted || volume <= 0;
    const target = muted ? 0 : volumeToGain(volume) * TRIM[inst];
    const p = this.faders[inst].gain;
    if (immediate) p.value = target;
    else p.setTargetAtTime(target, this.ctx.currentTime, 0.015);
  }

  /** Sound one fully-timed note from the Conductor. Muted instruments aren't synthesised at all. */
  play(n) {
    if (n.inst !== 'click' && this.muted[n.inst]) return;
    const t = Math.max(n.when, this.ctx.currentTime);
    switch (n.inst) {
      case 'drums': this.#drum(n, t); break;
      case 'click': playDrum(this.ctx, this.clickOut, 'click', t, n.vel); break;
      case 'bass': {
        const bank = this.library?.get('basses', n.timbre);
        if (bank) playSampledNote(this.ctx, this.faders.bass, bank, t, n.dur, n.midi, n.vel * SAMPLE_LEVEL.bass);
        else playBass(this.ctx, this.faders.bass, t, n.dur, n.midi, n.vel, BASS_FALLBACK[n.timbre] ?? n.timbre);
        break;
      }
      case 'chords': {
        const bank = this.library?.get('keys', n.timbre);
        if (bank) {
          playSampledNote(this.ctx, this.chordInputs.sampled, bank, t, n.dur, n.midi, n.vel * SAMPLE_LEVEL.keys);
        } else {
          // synth timbres, and the stand-in while a recorded keyboard is still loading
          const timbre = ['organ', 'guitar'].includes(n.timbre) ? n.timbre : 'epiano';
          playChordNote(this.ctx, this.chordInputs[timbre], t, n.dur, n.midi, n.vel, timbre, n.art);
        }
        break;
      }
      default: break;
    }
  }

  /** A recorded kit if one is loaded for this hit, otherwise the synth drums. */
  #drum(n, t) {
    const bank = this.library?.get('drums', n.timbre);
    const isHat = n.voice === 'hat' || n.voice === 'hatPedal';
    if (bank) {
      if (isHat) chokeHat(this.openHat, t); // closing the hat cuts an open one
      const handle = playSampledDrum(this.ctx, this.faders.drums, bank, n.voice, t, n.vel, SAMPLE_LEVEL.drums);
      if (handle) {
        if (n.voice === 'hatOpen') this.openHat = handle;
        return;
      }
    }
    playDrum(this.ctx, this.faders.drums, n.voice, t, n.vel);
  }

  /** Fade out and disconnect. Notes already scheduled land on a dead bus and are inaudible. */
  dispose(fade = 0.05) {
    if (fade <= 0) {
      try { this.master.disconnect(); } catch { /* already gone */ }
      return;
    }
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, fade / 3);
    setTimeout(() => { try { this.master.disconnect(); } catch { /* already gone */ } }, (fade + 0.3) * 1000);
  }
}

export class AudioEngine {
  /** @param {BaseAudioContext} [ctx] pass an OfflineAudioContext to render to a buffer */
  constructor(ctx) {
    this.ctx = ctx ?? new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.impulse = makeImpulse(this.ctx);
    this.library = new SampleLibrary(this.ctx);
  }

  get now() { return this.ctx.currentTime; }

  /** Extra delay between scheduling and hearing, so the UI can line up with what you hear. */
  get outputLatency() {
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  createBus(mixer) {
    return new Bus(this.ctx, this.impulse, mixer, this.library);
  }

  resume() { return this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve(); }
  suspend() { return this.ctx.state === 'running' ? this.ctx.suspend() : Promise.resolve(); }
}
