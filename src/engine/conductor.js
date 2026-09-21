// The Conductor turns a song + playback config into timed note events.
//
// It knows nothing about the DOM or Web Audio. It is driven by two injected things:
//   clock: { now(): seconds }             -> the audio clock (AudioContext.currentTime in the browser)
//   sink:  { play(note) }                 -> receives fully-timed notes to sound
// and an external timer that calls tick() often (a Worker in the browser, a loop in tests).
//
// Timing rules that keep it drift-free:
//   * every time is derived from `nextBeatTime`, advanced by exactly one beat's duration per beat;
//     tick() only decides *when to look*, never *what time it is*.
//   * events are scheduled a short lookahead ahead of the clock, one beat at a time, so a tempo
//     change lands on the very next beat without gaps or overlaps.

import { keyPrefersFlats, formatKey, parseKey } from '../theory/keys.js';
import { mod12 } from '../theory/notes.js';
import { getMeter } from '../theory/meter.js';
import { parseProgression, transposeBars } from '../theory/progression.js';
import { getStyle, renderBar, resolveTimbres } from '../styles/index.js';
import { clampBpm, initialChorusState, nextChorusState } from './planner.js';
import { createRng, hashSeed } from './rng.js';

/**
 * @typedef {Object} Song  the musical representation (independent of playback)
 * @property {string} key             starting key, e.g. "C" or "Am"; the progression is written in this key
 * @property {number} tempo           starting BPM
 * @property {string} timeSignature   "4/4", "6/8", "7/8" or "10/8" (see theory/meter.js); tempo is always quarter-note BPM
 * @property {string|string[]} progression  bar text or an array of bar strings
 *
 * @typedef {Object} PlaybackConfig
 * @property {string} style
 * @property {boolean} loop
 * @property {boolean} countIn
 * @property {{type:'off'|'interval'|'random', interval?:number, everyLoops?:number, randomMode?:string}} modulation
 * @property {{enabled:boolean, increment:number, everyLoops:number, maxBpm?:number}} tempoRamp
 * @property {{drums?:string, keys?:string}} [sounds]  'auto' or a sound id; see DRUM_SOUNDS / KEY_SOUNDS
 */

export class Conductor {
  /**
   * @param {Object} o
   * @param {{now:()=>number}} o.clock
   * @param {{play:(note:object)=>void}} o.sink
   * @param {()=>Song} o.getSong
   * @param {()=>PlaybackConfig} o.getConfig
   * @param {(event:object)=>void} [o.onEvent]  visual/transport events, stamped with audio time
   */
  constructor({ clock, sink, getSong, getConfig, onEvent = () => {}, seed = 1, lookahead = 0.25, startDelay = 0.06 }) {
    Object.assign(this, { clock, sink, getSong, getConfig, onEvent, seed, lookahead, startDelay });
    this.running = false;
    this._parseCache = { key: null, value: null };
  }

  // ---- control ---------------------------------------------------------------------------

  start() {
    const song = this.getSong();
    const cfg = this.getConfig();
    const key = parseKey(song.key) ?? { pc: 0, minor: false };

    this.meter = getMeter(song.timeSignature);
    this.state = initialChorusState(key.pc, song.tempo);
    this.pendingKey = null;
    this.styleState = {};
    this.styleId = null;
    this.barIdx = 0;
    this.beatInBar = 0;
    this.barEvents = [];
    this.evPtr = 0;
    this.finished = false;
    this.running = true;
    this.nextBeatTime = this.clock.now() + this.startDelay;

    if (cfg.countIn) {
      this.phase = 'countin';
      this.countBeat = 0;
    } else {
      this.phase = 'chorus';
      if (!this._beginChorus()) return;
    }
    this.tick();
  }

  stop() {
    this.running = false;
    this.phase = 'stopped';
  }

  /** Change tempo now; it takes effect from the next beat. */
  setBpm(bpm) {
    if (this.state) this.state = { ...this.state, bpm: clampBpm(bpm) };
  }

  /** Jump to a key at the next chorus (modulation carries on from there). */
  requestKey(pc) {
    this.pendingKey = pc === null ? null : mod12(pc);
  }

  get currentState() { return this.state; }

  // ---- scheduling loop -------------------------------------------------------------------

  tick() {
    if (!this.running) return;
    const now = this.clock.now();
    // If the scheduler was starved for a long time, don't dump a pile of late notes.
    if (this.nextBeatTime < now - 0.1) this.nextBeatTime = now + 0.02;
    const horizon = now + this.lookahead;
    while (this.running && !this.finished && this.nextBeatTime < horizon) this._scheduleBeat();
  }

  _scheduleBeat() {
    const time = this.nextBeatTime;
    const spq = 60 / this.state.bpm; // seconds per quarter note
    const meter = this.meter;
    const slot = meter.slots[this.phase === 'countin' ? this.countBeat : this.beatInBar];
    const slotSeconds = slot.len * spq;

    if (this.phase === 'countin') {
      // one click per slot; the bar's downbeat is loudest, other group starts are firm, the rest are light
      const vel = slot.index === 0 ? 1 : slot.posInGroup === 0 ? 0.75 : 0.5;
      this.sink.play({ inst: 'click', voice: 'click', vel, when: time, dur: 0.05 });
      this.onEvent({ type: 'countin', time, beat: slot.index + 1, beats: meter.slots.length, bpm: this.state.bpm, meter: meter.id });
      this.nextBeatTime += slotSeconds;
      this.countBeat++;
      if (this.countBeat >= meter.slots.length) {
        this.phase = 'chorus';
        this._beginChorus();
      }
      return;
    }

    if (this.beatInBar === 0) this._beginBar();

    // hand this slot's notes to the sink, timed against the slot's start
    const limit = slot.start + slot.len - 1e-9;
    while (this.evPtr < this.barEvents.length && this.barEvents[this.evPtr].beat < limit) {
      const e = this.barEvents[this.evPtr++];
      this.sink.play({
        inst: e.inst, voice: e.voice, midi: e.midi, vel: e.vel, timbre: e.timbre, art: e.art,
        when: time + (e.beat - slot.start) * spq + (e.dt || 0),
        dur: e.dur * spq,
      });
    }

    this._emitBeat(time, slot);

    this.nextBeatTime += slotSeconds;
    this.beatInBar++;
    if (this.beatInBar >= meter.slots.length) {
      this.beatInBar = 0;
      this.barIdx++;
      if (this.barIdx >= this.bars.length) this._endChorus();
    }
  }

  // ---- chorus / bar structure ------------------------------------------------------------

  _parse(song) {
    const key = `${song.timeSignature}|${Array.isArray(song.progression) ? song.progression.join('|') : song.progression}`;
    if (this._parseCache.key !== key) {
      this._parseCache = { key, value: parseProgression(song.progression, { timeSignature: song.timeSignature }) };
    }
    return this._parseCache.value;
  }

  /** Bars of the chorus in the given state, transposed into that state's key. */
  _barsFor(state) {
    const song = this.getSong();
    const parsed = this._parse(song);
    if (!parsed.ok) return null;
    const written = parseKey(song.key) ?? { pc: 0, minor: false };
    const flats = keyPrefersFlats(state.keyPc, written.minor);
    return { bars: transposeBars(parsed.bars, mod12(state.keyPc - written.pc), flats), minor: written.minor, meter: getMeter(song.timeSignature) };
  }

  _beginChorus() {
    const made = this._barsFor(this.state);
    if (!made) {
      this.running = false;
      this.onEvent({ type: 'error', time: this.nextBeatTime, message: 'The progression has errors, so playback stopped.' });
      return false;
    }
    this.bars = made.bars;
    this.minor = made.minor;
    this.meter = made.meter; // a time-signature change takes effect at the start of a chorus
    this.barIdx = 0;
    this.beatInBar = 0;
    this.onEvent({
      type: 'chorus', time: this.nextBeatTime, chorus: this.state.chorus,
      keyPc: this.state.keyPc, key: formatKey(this.state.keyPc, this.minor), bpm: this.state.bpm, bars: this.bars, meter: this.meter.id,
    });
    return true;
  }

  _endChorus() {
    if (!this.getConfig().loop) {
      this.finished = true;
      this.onEvent({ type: 'end', time: this.nextBeatTime });
      return;
    }
    this.state = this._computeNext();
    this.pendingKey = null;
    if (!this._beginChorus()) this.finished = true;
  }

  /** The state the next chorus will have, given current settings (pure; safe to call any time). */
  _computeNext() {
    const cfg = this.getConfig();
    const next = nextChorusState(this.state, cfg, this.seed);
    return this.pendingKey === null ? next : { ...next, keyPc: this.pendingKey };
  }

  _beginBar() {
    const cfg = this.getConfig();
    const bar = this.bars[this.barIdx];
    const isLast = this.barIdx === this.bars.length - 1;

    let nextChord = null;
    if (!isLast) nextChord = this._firstChord(this.bars[this.barIdx + 1]);
    else if (cfg.loop) nextChord = this._firstChordOfChorus(this._computeNext());

    const style = getStyle(cfg.style);
    if (style.id !== this.styleId) { this.styleId = style.id; this.styleState = {}; }

    this.barEvents = renderBar(style, {
      segments: bar.chords, nextChord,
      barIndex: this.barIdx, barCount: this.bars.length,
      isFirstBar: this.barIdx === 0, isLastBar: isLast,
      chorus: this.state.chorus, bpm: this.state.bpm, meter: this.meter, beatsPerBar: this.meter.quarters,
      state: this.styleState,
      timbres: resolveTimbres(style, cfg.sounds),
      rng: createRng(hashSeed(this.seed, this.state.chorus, this.barIdx)),
    });
    this.evPtr = 0;
  }

  _firstChord(bar) {
    return bar.chords.find((s) => s.chord)?.chord ?? null;
  }

  _firstChordOfChorus(state) {
    const made = this._barsFor(state);
    return made ? this._firstChord(made.bars[0]) : null;
  }

  // ---- visual events ---------------------------------------------------------------------

  /** The chord that follows the current one (skipping repeats), for the "next" readout. */
  _upcomingChord(segIndex) {
    const current = this.bars[this.barIdx].chords[segIndex].chord;
    const sym = (c) => (c ? c.symbol : 'NC');
    let s = segIndex + 1;
    for (let b = this.barIdx; b < this.bars.length; b++, s = 0) {
      const segs = this.bars[b].chords;
      for (; s < segs.length; s++) {
        if (sym(segs[s].chord) !== sym(current)) return { chord: segs[s].chord, sameChorus: true };
      }
    }
    if (this.getConfig().loop) {
      const next = this._barsFor(this._computeNext());
      const first = next && next.bars[0].chords[0].chord;
      return { chord: first ?? null, sameChorus: false };
    }
    return { chord: null, sameChorus: false };
  }

  _emitBeat(time, slot) {
    const bar = this.bars[this.barIdx];
    let segIndex = 0;
    bar.chords.forEach((s, i) => { if (s.startBeat <= slot.start + 1e-9) segIndex = i; });

    const upcoming = this.getConfig().loop ? this._computeNext() : null;
    this.onEvent({
      type: 'beat', time,
      chorus: this.state.chorus, bar: this.barIdx + 1, bars: this.bars.length,
      beat: slot.index + 1, beats: this.meter.slots.length, meter: this.meter.id,
      segIndex, chord: bar.chords[segIndex].chord,
      next: this._upcomingChord(segIndex),
      keyPc: this.state.keyPc, key: formatKey(this.state.keyPc, this.minor), bpm: this.state.bpm,
      upcoming: upcoming && {
        chorus: upcoming.chorus, keyPc: upcoming.keyPc, key: formatKey(upcoming.keyPc, this.minor), bpm: upcoming.bpm,
        keyChanges: upcoming.keyPc !== this.state.keyPc, bpmChanges: upcoming.bpm !== this.state.bpm,
      },
    });
  }
}
