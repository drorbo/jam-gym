// Player: connects the store (what the user asked for), the Conductor (what to play), the
// AudioEngine (how it sounds) and the ticker (when to look), and turns the Conductor's
// audio-timed events into UI state at the moment you actually hear them.

import { AudioEngine } from '../audio/engine.js';
import { createTicker } from '../audio/ticker.js';
import { Conductor } from '../engine/conductor.js';
import { clampBpm } from '../engine/planner.js';
import { keyPrefersFlats, parseKey, formatKey } from '../theory/keys.js';
import { mod12 } from '../theory/notes.js';
import { parseProgression, transposeProgressionText } from '../theory/progression.js';
import { BASS_SOUNDS, DRUM_SOUNDS, KEY_SOUNDS, defaultBass, getStyle, resolveTimbres } from '../styles/index.js';
import { removeSaved, restoreSaved, saveSnapshot, signatureOf } from './saved.js';
import { buildTrackData, dataFromLocalSave } from './tracks-model.js';

/** Transport-facing state shown by the UI while playing. */
const IDLE_VIEW = {
  chorus: 0, bar: 0, bars: 0, beat: 0, beats: 4, segIndex: 0,
  chord: null, next: null, key: null, keyPc: null, bpm: null,
  upcoming: null, countIn: 0, currentBars: null, meter: null,
};

export class Player {
  constructor(store) {
    this.store = store;
    this.engine = null;
    try { this.engine = new AudioEngine(); } catch { /* no Web Audio: the UI still works */ }
    this.bus = null;
    this.queue = [];
    this.raf = null;
    this.rampApplied = false;
    this.keyAutoChanged = false;
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.applied = null;
    this.syncSong();
    store.set({ transport: 'stopped', view: { ...IDLE_VIEW }, soundStatus: { loading: false, failed: [] } });

    this.conductor = null;
    // fetch the chosen kit and keyboard as soon as they are chosen, so pressing Play never waits
    this.bankSig = '';
    const preload = () => {
      const sig = JSON.stringify(this.neededBanks());
      if (sig !== this.bankSig) { this.bankSig = sig; this.loadSounds(); }
    };
    store.subscribe((_, patch) => { if (patch.config) preload(); });
    preload();

    this.ticker = createTicker(() => {
      this.conductor?.tick();
      // requestAnimationFrame is paused in hidden tabs; keep the UI state flowing anyway
      if (typeof document !== 'undefined' && document.hidden) this.flushEvents();
    });
  }

  // ---- recorded sounds -------------------------------------------------------------------

  /** The recorded banks the current style and choices need: [['drums', 'jazz'], ['basses', 'double'], ['keys', 'piano']]. */
  neededBanks() {
    const { config } = this.store.get();
    const t = resolveTimbres(getStyle(config.style), config.sounds);
    const banks = [];
    if (DRUM_SOUNDS.find((d) => d.id === t.drums)?.sampled) banks.push(['drums', t.drums]);
    if (BASS_SOUNDS.find((b) => b.id === t.bass)?.sampled) banks.push(['basses', t.bass]);
    if (KEY_SOUNDS.find((k) => k.id === t.chords)?.sampled) banks.push(['keys', t.chords]);
    return banks;
  }

  /** Fetch and decode whatever isn't loaded yet. Failures fall back to the synths; they never block playing. */
  async loadSounds() {
    const lib = this.engine?.library;
    if (!lib) return;
    const missing = this.neededBanks().filter(([kind, id]) => !lib.isReady(kind, id));
    if (!missing.length) { this.store.set({ soundStatus: { loading: false, failed: [] } }); return; }
    const label = ([kind, id]) => ({ drums: DRUM_SOUNDS, basses: BASS_SOUNDS, keys: KEY_SOUNDS }[kind]).find((x) => x.id === id)?.name ?? id;
    this.store.set({ soundStatus: { loading: true, failed: [], names: missing.map(label) } });
    await Promise.all(missing.map(([kind, id]) => lib.load(kind, id)));
    const failed = missing.filter(([kind, id]) => !lib.isReady(kind, id)).map(label);
    this.store.set({ soundStatus: { loading: false, failed } });
  }

  // ---- song / config sync ----------------------------------------------------------------

  /** The progression the Conductor should use: the latest text that parses. */
  syncSong(song = this.store.get().song) {
    const parsed = parseProgression(song.progressionText, { timeSignature: song.timeSignature });
    this.parsed = parsed;
    if (parsed.ok) {
      this.applied = { key: song.key, tempo: song.tempo, timeSignature: song.timeSignature, progression: song.progressionText };
    }
    return parsed;
  }

  /** Update the song in the store. The parse happens first so subscribers see a consistent state. */
  updateSong(patch) {
    const song = { ...this.store.get().song, ...patch };
    const parsed = this.syncSong(song);
    this.store.set({ song });
    return parsed;
  }

  get isRunning() { return this.store.get().transport !== 'stopped'; }

  // ---- transport -------------------------------------------------------------------------

  async play() {
    const { transport } = this.store.get();
    if (transport === 'paused') { await this.resume(); return; }
    if (transport !== 'stopped') return;
    if (!this.syncSong().ok) return;

    if (!this.engine) this.engine = new AudioEngine();
    await this.engine.resume();
    // usually instant (already preloaded); otherwise wait a moment, then play with the synths
    await Promise.race([this.loadSounds(), new Promise((r) => setTimeout(r, 6000))]);

    this.bus = this.engine.createBus(this.store.get().mixer);
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.conductor = new Conductor({
      clock: { now: () => this.engine.now },
      sink: { play: (n) => this.bus.play(n) },
      getSong: () => this.applied,
      getConfig: () => this.store.get().config,
      onEvent: (e) => this.queue.push(e),
      seed: this.seed,
    });
    this.queue = [];
    this.rampApplied = false;
    this.keyAutoChanged = false;
    this.applied = { ...this.applied, tempo: this.store.get().song.tempo };

    this.store.set({ transport: this.store.get().config.countIn ? 'countin' : 'playing', view: { ...IDLE_VIEW } });
    this.conductor.start();
    this.ticker.start();
    this.startFrames();
  }

  async resume() {
    await this.engine.resume();
    this.store.set({ transport: this.store.get().view.countIn ? 'countin' : 'playing' });
  }

  async pause() {
    if (!['playing', 'countin'].includes(this.store.get().transport)) return;
    await this.engine.suspend();
    this.store.set({ transport: 'paused' });
  }

  togglePlay() {
    const { transport } = this.store.get();
    if (transport === 'playing' || transport === 'countin') return this.pause();
    return this.play();
  }

  async stop() {
    if (this.store.get().transport === 'stopped') return;
    this.conductor?.stop();
    this.ticker.stop();
    this.stopFrames();
    if (this.bus) {
      // a suspended context has a frozen clock, so a timed fade would never run: cut immediately
      this.bus.dispose(this.engine.ctx.state === 'running' ? 0.06 : 0);
      this.bus = null;
    }
    await this.engine?.resume();
    this.queue = [];
    this.store.set({ transport: 'stopped', view: { ...IDLE_VIEW } });
  }

  async restart() {
    await this.stop();
    await this.play();
  }

  // ---- live controls ---------------------------------------------------------------------

  /** Tempo: while playing it takes effect on the next beat. */
  setTempo(bpm) {
    const v = clampBpm(bpm);
    if (this.isRunning && this.conductor?.running) {
      this.conductor.setBpm(v);
      this.store.set({ view: { ...this.store.get().view, bpm: v } });
      // until the ramp has started changing the tempo, manual edits also move the starting tempo
      if (!this.rampApplied) this.updateSong({ tempo: v });
    } else {
      this.updateSong({ tempo: v });
    }
  }

  /**
   * Starting key. Stopped: the progression text is rewritten in the new key.
   * Playing: the next chorus jumps to the new key.
   */
  setKey(key) {
    const to = parseKey(key);
    const { song } = this.store.get();
    const from = parseKey(song.key);
    if (!to || !from) return;
    const rewrite = () => {
      const text = transposeProgressionText(song.progressionText, mod12(to.pc - from.pc), keyPrefersFlats(to.pc, to.minor));
      this.updateSong({ key: formatKey(to.pc, to.minor), progressionText: text });
    };
    if (this.isRunning && this.conductor?.running) {
      this.conductor.requestKey(to.pc);
      if (!this.keyAutoChanged) rewrite();
    } else {
      rewrite();
    }
  }

  /** Time signature. While playing, the new meter starts with the next chorus. */
  setTimeSignature(ts) {
    return this.updateSong({ timeSignature: ts });
  }

  setProgressionText(text) {
    return this.updateSong({ progressionText: text });
  }

  // ---- saved progressions ----------------------------------------------------------------

  /** Save the current progression, key, meter, style and tempo under a name (an existing name is updated). */
  saveCurrent(name) {
    const { song, config, saved } = this.store.get();
    const r = saveSnapshot(saved, {
      name, text: song.progressionText, key: song.key, timeSignature: song.timeSignature, style: config.style, tempo: song.tempo,
      swing: config.swing,
    });
    if (r.ok) this.store.set({ saved: r.list, activeSaved: { id: r.item.id, signature: signatureOf(r.item) } });
    return r;
  }

  /**
   * Bring back a whole setup (a track, or a locally saved progression): progression, key, meter, tempo, style, swing,
   * sounds, key-change and tempo-ramp settings, loop and count-in, and the mixer.
   * While playing, tempo, style, sounds and the mixer apply straight away; the progression, key and meter take effect
   * at the next chorus (a loaded key is jumped to then, and modulation carries on from it).
   * @param {ReturnType<typeof import('./tracks-model.js').buildTrackData>} data
   */
  applySetup(data) {
    const live = this.isRunning && this.conductor?.running;
    const { song, config, mixer } = data;
    this.updateSong({
      timeSignature: song.timeSignature, key: song.key, progressionText: song.progressionText,
      ...(live ? {} : { tempo: song.tempo }),
    });
    // tracks saved before the bass panel existed have no bass settings: they get the style's own
    this.store.set({ config: { ...this.store.get().config, ...config, bass: config.bass ?? defaultBass(getStyle(config.style)) }, mixer });
    for (const [inst, level] of Object.entries(mixer)) this.bus?.setLevel(inst, level);
    if (live) {
      this.conductor.requestKey(parseKey(song.key).pc);
      this.setTempo(song.tempo);
    }
  }

  /** The current setup, ready to store as a track. */
  currentSetup() {
    return buildTrackData(this.store.get());
  }

  /**
   * Bring back a progression saved on this device (the older, browser-only list).
   */
  loadSaved(id) {
    const item = this.store.get().saved.find((x) => x.id === id);
    if (!item) return null;
    this.applySetup(dataFromLocalSave(item));
    this.store.set({ activeSaved: { id: item.id, signature: signatureOf(item) } });
    return item;
  }

  deleteSaved(id) {
    const { saved, activeSaved } = this.store.get();
    const item = saved.find((x) => x.id === id) ?? null;
    if (item) this.store.set({ saved: removeSaved(saved, id), activeSaved: activeSaved?.id === id ? null : activeSaved });
    return item;
  }

  restoreDeleted(item) {
    this.store.set({ saved: restoreSaved(this.store.get().saved, item) });
  }

  setMixer(inst, level) {
    const { mixer } = this.store.get();
    const next = { ...mixer, [inst]: { ...mixer[inst], ...level } };
    this.store.set({ mixer: next });
    this.bus?.setLevel(inst, next[inst]);
  }

  // ---- audio-clock -> UI -----------------------------------------------------------------

  startFrames() {
    const frame = () => {
      this.raf = requestAnimationFrame(frame);
      this.flushEvents();
    };
    this.stopFrames();
    this.raf = requestAnimationFrame(frame);
  }

  stopFrames() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  /** Apply every queued event whose audio time has been reached (i.e. that you can now hear). */
  flushEvents() {
    if (!this.engine || !this.queue.length) return;
    const heardUntil = this.engine.now - this.engine.outputLatency;
    let view = this.store.get().view;
    let transport = this.store.get().transport;
    let ended = false;
    let changed = false;

    while (this.queue.length && this.queue[0].time <= heardUntil) {
      const e = this.queue.shift();
      changed = true;
      if (e.type === 'countin') {
        view = { ...view, countIn: e.beat, beats: e.beats, bpm: e.bpm, meter: e.meter };
        transport = 'countin';
      } else if (e.type === 'chorus') {
        const { config } = this.store.get();
        if (e.chorus > 1 && config.tempoRamp.enabled && (e.chorus - 1) % config.tempoRamp.everyLoops === 0) this.rampApplied = true;
        if (e.chorus > 1 && config.modulation.type !== 'off' && (e.chorus - 1) % config.modulation.everyLoops === 0) this.keyAutoChanged = true;
        view = { ...view, currentBars: e.bars, chorus: e.chorus, key: e.key, keyPc: e.keyPc, bpm: e.bpm, bars: e.bars.length, meter: e.meter };
      } else if (e.type === 'beat') {
        view = {
          ...view, countIn: 0, chorus: e.chorus, bar: e.bar, bars: e.bars, beat: e.beat, beats: e.beats,
          segIndex: e.segIndex, chord: e.chord, next: e.next, key: e.key, keyPc: e.keyPc, bpm: e.bpm, upcoming: e.upcoming, meter: e.meter,
        };
        transport = 'playing';
      } else if (e.type === 'end') {
        ended = true;
      } else if (e.type === 'error') {
        ended = true;
      }
    }
    if (changed) this.store.set({ view, transport });
    if (ended) this.stop();
  }
}
