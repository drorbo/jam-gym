// DOM layer: renders store state, forwards user actions to the Player. No musical logic here.

import { MAX_BPM, MIN_BPM, RANDOM_MODES, describeInterval, INTERVAL_NAMES } from '../engine/planner.js';
import { chordParts } from '../theory/chord.js';
import { MAJOR_KEYS, MINOR_KEYS, keyPrefersFlats, parseKey } from '../theory/keys.js';
import { DRUM_SOUNDS, KEY_SOUNDS, getStyle, listStyles, resolveTimbres } from '../styles/index.js';
import { transposeProgressionText } from '../theory/progression.js';
import { METER_IDS, getMeter } from '../theory/meter.js';
import { describeSaved, findByName, signatureOf } from './saved.js';
import { EXAMPLES } from './state.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** "Bb" -> "B♭", "F#m" -> "F♯m" */
export const prettyKey = (k) => k.replace('b', '♭').replace('#', '♯');

/** Chord symbol as typographic DOM: big letter, small raised quality, small slash bass. */
export function chordEl(chord) {
  const p = chordParts(chord);
  const c = el('span', 'c');
  c.append(p.letter);
  if (p.accidental) c.append(el('span', 'a', p.accidental));
  if (p.suffix) c.append(el('span', 'q', p.suffix));
  if (p.bassLetter) c.append(el('span', 'b', `/${p.bassLetter}${p.bassAccidental}`));
  return c;
}

const INSTRUMENT_NAMES = { drums: 'Drums', bass: 'Bass', chords: 'Chords' };

/** Plain-English description of the automation, shown under the controls. */
export function summarize(config) {
  const { modulation: m, tempoRamp: r } = config;
  const loops = (n) => (n === 1 ? 'every loop' : `every ${n} loops`);
  let key = null;
  if (m.type === 'interval') {
    const n = Math.abs(m.interval);
    const dir = m.interval < 0 ? 'down' : 'up';
    key = `${dir} a ${INTERVAL_NAMES[n % 12] ?? `${n} semitones`} (${m.interval > 0 ? '+' : '−'}${n})`;
  } else if (m.type === 'random') {
    key = {
      'no-repeat': 'to a new random key',
      any: 'to a random key',
      shuffle: 'to the next key in a shuffled tour of all 12',
      fifths: 'up a fifth (circle of fifths)',
      fourths: 'up a fourth (circle of fourths)',
      chromatic: 'up a semitone',
    }[m.randomMode];
  }
  const tempo = r.enabled ? `${r.increment} BPM faster` : null;
  const cap = r.enabled ? ` (up to ${r.maxBpm})` : '';

  if (key && tempo && m.everyLoops === r.everyLoops) {
    return `${loops(m.everyLoops)[0].toUpperCase()}${loops(m.everyLoops).slice(1)}: ${key} and ${tempo}${cap}.`;
  }
  const parts = [];
  if (key) parts.push(`Key: ${loops(m.everyLoops)}, ${key}.`);
  if (tempo) parts.push(`Tempo: ${loops(r.everyLoops)}, ${tempo}${cap}.`);
  return parts.length ? parts.join(' ') : 'The key and tempo stay put. Turn on a key change or a tempo ramp to keep the practice moving.';
}

export function mountUI({ store, player }) {
  const app = document.querySelector('.app');
  const root = document.documentElement;
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  let barsSig = '';
  let lastGoodBars = [];
  let chordSig = '';
  let pipMeter = '';
  let savedSig = '';
  let flashTimer = null;

  // ---- static content ------------------------------------------------------------------

  const keysel = $('keysel');
  const optgroup = (label, keys) => {
    const g = el('optgroup');
    g.label = label;
    for (const k of keys) { const o = el('option', '', prettyKey(k)); o.value = k; g.append(o); }
    return g;
  };
  keysel.append(optgroup('Major', MAJOR_KEYS), optgroup('Minor', MINOR_KEYS));

  const intervalSel = $('mod-interval');
  const up = el('optgroup'); up.label = 'Up';
  const down = el('optgroup'); down.label = 'Down';
  for (let n = 1; n <= 11; n++) {
    const a = el('option', '', describeInterval(n)); a.value = String(n); up.append(a);
    const b = el('option', '', describeInterval(-n)); b.value = String(-n); down.append(b);
  }
  intervalSel.append(up, down);

  const randomSel = $('mod-random');
  for (const m of RANDOM_MODES) { const o = el('option', '', m.label); o.value = m.id; randomSel.append(o); }

  for (const id of METER_IDS) { const o = el('option', '', getMeter(id).label); o.value = id; $('meter').append(o); }

  const stylesEl = $('styles');
  for (const s of listStyles()) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.v = s.id;
    b.append(s.name, el('small', '', `${s.defaultTempo}`));
    stylesEl.append(b);
  }

  // sound pickers: "Style default" plus every option
  const fillSounds = (select, list) => {
    const auto = el('option', '', 'Default'); auto.value = 'auto'; select.append(auto);
    for (const s of list) { const o = el('option', '', s.name); o.value = s.id; select.append(o); }
  };
  fillSounds($('snd-drums'), DRUM_SOUNDS);
  fillSounds($('snd-keys'), KEY_SOUNDS);

  const levelsEl = $('levels');
  for (const inst of Object.keys(INSTRUMENT_NAMES)) {
    const row = el('div', 'lvl');
    row.dataset.inst = inst;
    const name = el('span', 'name', INSTRUMENT_NAMES[inst]);
    const range = el('input');
    range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1';
    range.setAttribute('aria-label', `${INSTRUMENT_NAMES[inst]} volume`);
    const mute = el('button', 'mute', 'Mute');
    mute.type = 'button';
    mute.setAttribute('aria-pressed', 'false');
    mute.setAttribute('aria-label', `Mute ${INSTRUMENT_NAMES[inst].toLowerCase()}`);
    row.append(name, range, mute);
    levelsEl.append(row);
    range.addEventListener('input', () => player.setMixer(inst, { volume: Number(range.value) / 100 }));
    mute.addEventListener('click', () => player.setMixer(inst, { muted: !store.get().mixer[inst].muted }));
  }

  const examplesEl = $('examples');
  for (const ex of EXAMPLES) {
    const b = el('button', 'chip', ex.name);
    b.type = 'button';
    b.addEventListener('click', () => {
      const { song } = store.get();
      const key = parseKey(song.key);
      const text = transposeProgressionText(ex.text, key.pc, keyPrefersFlats(key.pc, key.minor));
      if (ex.timeSignature) player.setTimeSignature(ex.timeSignature); // set first, so the text parses in the new meter
      player.setProgressionText(text);
      if (ex.style) setStyle(ex.style);
    });
    examplesEl.append(b);
  }

  // ---- saved progressions ----------------------------------------------------------------

  const saveName = $('save-name');

  /** A short status line under the save box, with an optional Undo. */
  function say(text, undoItem = null) {
    const box = $('save-msg');
    box.replaceChildren(text);
    if (undoItem) {
      const b = el('button', '', 'Undo');
      b.type = 'button';
      b.addEventListener('click', () => { player.restoreDeleted(undoItem); say(`Restored "${undoItem.name}".`); });
      box.append(b);
    }
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { $('save-msg').replaceChildren(); }, 9000);
  }

  $('save-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const r = player.saveCurrent(saveName.value);
    if (r.ok) say(r.updated ? `Updated "${r.item.name}".` : `Saved "${r.item.name}".`);
    else say(r.error);
  });
  saveName.addEventListener('input', () => renderSaveButton(store.get()));

  $('saved-list').addEventListener('click', (e) => {
    const load = e.target.closest('.saved-load');
    const del = e.target.closest('.saved-del');
    if (load) {
      const item = player.loadSaved(load.dataset.id);
      if (item) { saveName.value = item.name; say(`Loaded "${item.name}".`); }
    } else if (del) {
      const item = player.deleteSaved(del.dataset.id);
      if (item) say(`Deleted "${item.name}".`, item);
    }
  });

  function renderSaveButton(state) {
    const exists = Boolean(findByName(state.saved, saveName.value));
    $('save-btn').textContent = exists ? 'Update' : 'Save';
    $('save-btn').classList.toggle('is-update', exists);
  }

  function renderSaved(state) {
    const { saved, activeSaved, song } = state;
    const current = signatureOf({ text: song.progressionText, key: song.key, timeSignature: song.timeSignature });
    const activeState = activeSaved && activeSaved.signature === current ? 'loaded' : activeSaved ? 'loaded, edited' : '';
    const sig = JSON.stringify([saved.map((x) => [x.id, x.savedAt, x.name]), activeSaved?.id, activeState]);
    if (sig !== savedSig) {
      savedSig = sig;
      const list = $('saved-list');
      list.replaceChildren();
      if (!saved.length) {
        list.append(el('li', 'saved-empty', 'Nothing saved yet. Name the progression above and press Save to keep it, along with its key, time signature, style and tempo.'));
      }
      for (const item of saved) {
        const li = el('li', 'saved-item');
        const active = activeSaved?.id === item.id;
        li.classList.toggle('is-active', active);
        const load = el('button', 'saved-load');
        load.type = 'button';
        load.dataset.id = item.id;
        load.title = 'Load this progression';
        const name = el('span', 'saved-name', item.name);
        if (active) name.dataset.state = activeState;
        load.append(name, el('span', 'saved-meta', describeSaved(item)));
        const del = el('button', 'saved-del', 'Delete');
        del.type = 'button';
        del.dataset.id = item.id;
        del.setAttribute('aria-label', `Delete ${item.name}`);
        li.append(load, del);
        list.append(li);
      }
    }
    renderSaveButton(state);
  }

  // ---- actions -------------------------------------------------------------------------

  const patchConfig = (patch) => store.set({ config: { ...store.get().config, ...patch } });
  const patchMod = (patch) => patchConfig({ modulation: { ...store.get().config.modulation, ...patch } });
  const patchRamp = (patch) => patchConfig({ tempoRamp: { ...store.get().config.tempoRamp, ...patch } });

  function setStyle(id) {
    patchConfig({ style: id });
    if (store.get().transport === 'stopped') player.setTempo(getStyle(id).defaultTempo);
  }

  const readInt = (input, lo, hi, fallback) => {
    const v = parseInt(input.value, 10);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  };

  $('play').addEventListener('click', () => player.togglePlay());
  $('stop').addEventListener('click', () => player.stop());
  $('restart').addEventListener('click', () => player.restart());
  $('countin').addEventListener('click', () => patchConfig({ countIn: !store.get().config.countIn }));
  $('loop').addEventListener('click', () => patchConfig({ loop: !store.get().config.loop }));

  $('prog').addEventListener('input', (e) => player.setProgressionText(e.target.value));
  keysel.addEventListener('change', () => player.setKey(keysel.value));

  const bpmNow = () => {
    const s = store.get();
    return s.transport === 'stopped' ? s.song.tempo : (s.view.bpm ?? s.song.tempo);
  };
  $('bpm-down').addEventListener('click', (e) => player.setTempo(bpmNow() - (e.shiftKey ? 5 : 1)));
  $('bpm-up').addEventListener('click', (e) => player.setTempo(bpmNow() + (e.shiftKey ? 5 : 1)));
  $('bpm').addEventListener('change', (e) => player.setTempo(readInt(e.target, MIN_BPM, MAX_BPM, bpmNow())));
  $('bpm').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('bpm-slider').addEventListener('input', (e) => player.setTempo(Number(e.target.value)));
  $('meter').addEventListener('change', (e) => player.setTimeSignature(e.target.value));

  const taps = [];
  $('tap').addEventListener('click', () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 2) {
      const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      player.setTempo((60000 / avg) * getMeter(store.get().song.timeSignature).tapQuarters);
    }
  });

  stylesEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) setStyle(b.dataset.v);
  });

  $('snd-drums').addEventListener('change', (e) => patchConfig({ sounds: { ...store.get().config.sounds, drums: e.target.value } }));
  $('snd-keys').addEventListener('change', (e) => patchConfig({ sounds: { ...store.get().config.sounds, keys: e.target.value } }));

  $('mod-type').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) patchMod({ type: b.dataset.v });
  });
  intervalSel.addEventListener('change', () => patchMod({ interval: Number(intervalSel.value) }));
  randomSel.addEventListener('change', () => patchMod({ randomMode: randomSel.value }));
  $('mod-every').addEventListener('change', (e) => patchMod({ everyLoops: readInt(e.target, 1, 64, 1) }));

  $('ramp-on').addEventListener('click', () => patchRamp({ enabled: !store.get().config.tempoRamp.enabled }));
  $('ramp-inc').addEventListener('change', (e) => patchRamp({ increment: readInt(e.target, 1, 40, 5) }));
  $('ramp-every').addEventListener('change', (e) => patchRamp({ everyLoops: readInt(e.target, 1, 64, 2) }));
  $('ramp-max').addEventListener('change', (e) => patchRamp({ maxBpm: readInt(e.target, MIN_BPM, MAX_BPM, MAX_BPM) }));

  // theme: auto -> dark -> light
  $('theme').addEventListener('click', () => {
    const order = ['auto', 'dark', 'light'];
    const cur = store.get().theme;
    store.set({ theme: order[(order.indexOf(cur) + 1) % order.length] });
  });

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && t.closest('input, textarea, select, button, [role="radio"]')) return;
    e.preventDefault();
    player.togglePlay();
  });

  // ---- rendering -----------------------------------------------------------------------

  function displayBars(state) {
    const live = state.transport !== 'stopped' && state.view.currentBars;
    if (live) return state.view.currentBars;
    if (player.parsed.ok) lastGoodBars = player.parsed.bars;
    return lastGoodBars;
  }

  function renderBars(state, bars) {
    const list = $('bars');
    const sig = bars.map((b) => b.source).join('|') + (state.transport === 'stopped' ? '' : `#${state.view.chorus}`);
    if (sig !== barsSig) {
      barsSig = sig;
      list.replaceChildren();
      list.classList.toggle('empty', bars.length === 0);
      if (!bars.length) list.append(el('li', '', 'Type a progression below to see its bars here.'));
      bars.forEach((bar, i) => {
        const li = el('li', 'bar');
        li.append(el('span', 'num', `${i + 1}`));
        const segs = el('div', bar.chords.length >= 3 ? 'bss many' : 'bss');
        for (const s of bar.chords) {
          const seg = el('span', s.chord ? 'bs' : 'bs nc');
          if (s.chord) seg.append(chordEl(s.chord)); else seg.textContent = 'N.C.';
          segs.append(seg);
        }
        li.append(segs, el('span', 'progress'));
        list.append(li);
      });
    }
    const playing = state.transport !== 'stopped' && state.view.bar > 0;
    const slotSeconds = (60 / (state.view.bpm || state.song.tempo)) * getMeter(state.view.meter ?? state.song.timeSignature).slotLen;
    [...list.children].forEach((li, i) => {
      if (!li.classList.contains('bar')) return;
      const current = playing && i === state.view.bar - 1;
      li.classList.toggle('current', current);
      li.querySelectorAll('.bs').forEach((s, k) => s.classList.toggle('active', current && k === state.view.segIndex));
      if (current) {
        li.style.setProperty('--p', String(state.view.beat / state.view.beats));
        li.querySelector('.progress').style.transitionDuration = `${slotSeconds}s`;
      }
    });
  }

  /** Shrink the hero chord just enough to fit its column (long symbols on narrow screens). */
  function fitChord() {
    const box = $('chord');
    box.style.setProperty('--fit', '1');
    const avail = box.parentElement.clientWidth;
    const need = box.scrollWidth;
    if (need > avail && avail > 0) box.style.setProperty('--fit', String(Math.max(0.3, avail / need)));
  }

  function renderStage(state, bars) {
    const { transport, view, song } = state;
    const stopped = transport === 'stopped';
    app.dataset.transport = transport;

    const key = stopped ? song.key : (view.key ?? song.key);
    $('key').textContent = prettyKey(key);

    const chordBox = $('chord');
    let sig;
    let chord = null;
    if (transport === 'countin' && view.countIn) {
      sig = `count${view.countIn}`;
    } else if (stopped || !view.chord) {
      chord = bars[0]?.chords.find((s) => s.chord)?.chord ?? null;
      sig = `idle${chord ? chord.symbol : ''}`;
    } else {
      chord = view.chord;
      sig = `play${chord.symbol}${view.bar}${view.segIndex}`;
    }
    chordBox.classList.toggle('idle', stopped || (!view.chord && transport !== 'countin'));
    chordBox.classList.toggle('count', transport === 'countin' && view.countIn > 0);
    if (sig !== chordSig) {
      const changedChord = !chordSig.startsWith('play') || !sig.startsWith('play') || chordSig.slice(0, -2) !== sig.slice(0, -2);
      chordSig = sig;
      chordBox.replaceChildren();
      if (transport === 'countin' && view.countIn) {
        chordBox.append(el('span', 'c', String(view.countIn)));
      } else if (chord) {
        chordBox.append(chordEl(chord));
      } else {
        chordBox.append(el('span', 'c', '–'));
      }
      fitChord();
      if (!stopped && changedChord) {
        chordBox.classList.remove('enter');
        void chordBox.offsetWidth;
        chordBox.classList.add('enter');
      }
    }

    // one dot per slot, grouped the way the meter is felt: 1 1 1 1 | 3 3 | 3 2 2 | 3 3 2 2
    const meter = getMeter(stopped ? song.timeSignature : (view.meter ?? song.timeSignature));
    const pips = $('pips');
    if (pipMeter !== meter.id) {
      pipMeter = meter.id;
      pips.replaceChildren(...meter.groups.map((n) => {
        const g = el('span', 'grp');
        for (let i = 0; i < n; i++) g.append(el('i'));
        return g;
      }));
    }
    const lit = transport === 'countin' ? view.countIn : view.beat;
    [...pips.querySelectorAll('i')].forEach((p, i) => p.classList.toggle('on', !stopped && i === lit - 1));

    const live = !stopped && view.bar > 0;
    $('stat-bar').textContent = live ? `${view.bar} / ${view.bars}` : `– / ${bars.length || '–'}`;
    $('stat-chorus').textContent = live ? String(view.chorus) : '–';
    const bpm = stopped ? song.tempo : (view.bpm ?? song.tempo);
    $('stat-bpm').textContent = `${bpm} BPM`;

    const nextBox = $('stat-next');
    nextBox.replaceChildren();
    if (live && view.next?.chord) nextBox.append(chordEl(view.next.chord));
    else nextBox.textContent = '–';

    const hu = $('headsup');
    const up = live && view.upcoming;
    if (up && (up.keyChanges || up.bpmChanges)) {
      const bits = [];
      if (up.keyChanges) bits.push(`key of ${prettyKey(up.key)}`);
      if (up.bpmChanges) bits.push(`${up.bpm} BPM`);
      hu.textContent = `Next chorus: ${bits.join(', ')}`;
    } else {
      hu.textContent = '';
    }

    const play = $('play');
    const canPlay = player.parsed.ok;
    const label = transport === 'playing' || transport === 'countin' ? 'Pause' : transport === 'paused' ? 'Resume' : 'Play';
    play.setAttribute('aria-label', label);
    play.title = `${label} (Space)`;
    play.setAttribute('aria-disabled', String(stopped && !canPlay));
    $('stop').disabled = stopped;
    $('countin').setAttribute('aria-pressed', String(state.config.countIn));
    $('loop').setAttribute('aria-pressed', String(state.config.loop));

    if (!stopped && view.chord) document.title = `${view.chord.symbol} · ${prettyKey(key)} | Jam Gym`;
    else document.title = 'Jam Gym';
  }

  function renderControls(state) {
    const { song, config, mixer, transport, view } = state;
    const bpm = transport === 'stopped' ? song.tempo : (view.bpm ?? song.tempo);
    if (document.activeElement !== $('bpm')) $('bpm').value = String(bpm);
    $('bpm-slider').value = String(bpm);

    if (document.activeElement !== $('meter')) $('meter').value = song.timeSignature;
    const tm = getMeter(song.timeSignature);
    const hint = tm.describeTempo(bpm);
    $('tempo-hint').textContent = hint ? `${hint}. ${tm.tapHint}.` : '';

    $$('#styles button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === config.style)));
    const style = getStyle(config.style);
    $('style-desc').textContent = style.description;

    // sound pickers: say which sound "Style default" means right now
    const t = resolveTimbres(style, {});
    const nameOf = (list, id) => list.find((x) => x.id === id)?.name ?? id;
    $('snd-drums').options[0].textContent = `Default: ${nameOf(DRUM_SOUNDS, t.drums)}`;
    $('snd-keys').options[0].textContent = `Default: ${nameOf(KEY_SOUNDS, t.chords)}`;
    if (document.activeElement !== $('snd-drums')) $('snd-drums').value = config.sounds.drums;
    if (document.activeElement !== $('snd-keys')) $('snd-keys').value = config.sounds.keys;
    const ss = state.soundStatus;
    $('snd-status').textContent = ss?.loading
      ? `Loading ${ss.names.join(' and ')}…`
      : ss?.failed?.length ? `Couldn't load ${ss.failed.join(' and ')}, so the synth is playing instead.` : '';

    for (const inst of Object.keys(INSTRUMENT_NAMES)) {
      const row = levelsEl.querySelector(`[data-inst="${inst}"]`);
      const range = row.querySelector('input');
      if (document.activeElement !== range) range.value = String(Math.round(mixer[inst].volume * 100));
      const mute = row.querySelector('.mute');
      mute.setAttribute('aria-pressed', String(mixer[inst].muted));
      mute.textContent = mixer[inst].muted ? 'Muted' : 'Mute';
      row.classList.toggle('muted', mixer[inst].muted);
    }

    if (document.activeElement !== keysel) keysel.value = song.key;

    const prog = $('prog');
    // while typing, the box and the state are already identical, so this only fires for external changes (load, example)
    if (prog.value !== song.progressionText) prog.value = song.progressionText;
    const parsed = player.parsed;
    const msg = $('progmsg');
    if (!song.progressionText.trim()) {
      msg.textContent = 'Try something like Cmaj7 | Am7 | Dm7 G7. Bars are separated by |, and chords in one bar by spaces.';
      msg.className = 'msg';
    } else if (!parsed.ok) {
      const more = parsed.errors.length > 1 ? ` (${parsed.errors.length - 1} more)` : '';
      const still = transport !== 'stopped' ? ' Playback carries on with the last valid version.' : '';
      msg.textContent = `${parsed.errors[0]?.message ?? 'Nothing to play yet.'}${more}${still}`;
      msg.className = 'msg bad';
    } else {
      const n = parsed.bars.length;
      msg.textContent = `${n} ${n === 1 ? 'bar' : 'bars'}, ${n * 4} beats. Edits apply from the next chorus.`;
      msg.className = 'msg';
    }
    prog.setAttribute('aria-invalid', String(!parsed.ok && Boolean(song.progressionText.trim())));

    // key change + tempo ramp
    const m = config.modulation;
    $$('#mod-type button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === m.type)));
    $$('#mod-fields .field').forEach((f) => { f.hidden = !f.dataset.show.split(' ').includes(m.type); });
    if (document.activeElement !== intervalSel) intervalSel.value = String(m.interval);
    if (document.activeElement !== randomSel) randomSel.value = m.randomMode;
    if (document.activeElement !== $('mod-every')) $('mod-every').value = String(m.everyLoops);
    $('mod-every-unit').textContent = m.everyLoops === 1 ? 'loop' : 'loops';

    const r = config.tempoRamp;
    $('ramp-on').setAttribute('aria-checked', String(r.enabled));
    $('ramp-label').textContent = r.enabled ? 'On' : 'Off';
    $('ramp-fields').classList.toggle('off', !r.enabled);
    if (document.activeElement !== $('ramp-inc')) $('ramp-inc').value = String(r.increment);
    if (document.activeElement !== $('ramp-every')) $('ramp-every').value = String(r.everyLoops);
    if (document.activeElement !== $('ramp-max')) $('ramp-max').value = String(r.maxBpm);
    $('ramp-every-unit').textContent = r.everyLoops === 1 ? 'loop' : 'loops';
    $('summary').textContent = summarize(config);
  }

  function renderTheme(theme) {
    if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
    const label = { auto: 'automatic', dark: 'dark', light: 'light' }[theme];
    $('theme').setAttribute('aria-label', `Theme: ${label}`);
    $('theme').title = `Theme: ${label}`;
  }

  let lastTheme = null;
  function render(state) {
    const bars = displayBars(state);
    renderBars(state, bars);
    renderStage(state, bars);
    renderControls(state);
    renderSaved(state);
    if (state.theme !== lastTheme) { lastTheme = state.theme; renderTheme(state.theme); }
  }

  store.subscribe(render);
  render(store.get());
  new ResizeObserver(fitChord).observe(document.querySelector('.readout'));
}
