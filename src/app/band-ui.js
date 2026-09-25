// The Bass line, Keys and Drums panels. One component draws all three from the schema in styles/settings.js: a select
// for each choice, a slider with a word for where it sits for each amount, a one-line summary in the header, and a
// button that puts the panel back to the style's own settings. Changes apply from the next bar.

import { defaultBass, defaultComp, defaultKit, defaultSwing, getStyle } from '../styles/index.js';
import { DRUM_PARTS, levelDb } from '../styles/drumparts.js';
import {
  GROUPS, GROUP_IDS, describeGroup, effectiveOption, effectiveValues, fieldsFor, bandSwing, inactiveControls, optionsFor, optionsForMeter,
  sanitizeGroup, wordFor, wordsFor,
} from '../styles/settings.js';
import { mountCollapsibles } from './collapsible.js';

const DEFAULTS = { bass: defaultBass, comp: defaultComp, kit: defaultKit };
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A line or two under a panel: what the chosen options mean, and what does not apply right now. */
function notes(group, v, style, song, bpm) {
  const out = [];
  const meter = song.timeSignature;
  const eff = effectiveValues(group, v, style.id, meter);
  const field = (id) => GROUPS[group].fields.find((f) => f.id === id);
  const idle = inactiveControls(group, v, style.id, meter);
  for (const id of ['groove', 'rhythm', 'pattern']) {
    if (idle[id]) continue; // a control that is switched off is not described: only why it is off
    const f = field(id);
    const o = f && eff[id] !== undefined ? optionsFor(f, style.id).find((x) => x.id === eff[id]) : null;
    if (o?.hint && (f.type === 'select') && !(group === 'comp' && o.id === 'auto')) out.push(`${o.name}: ${o.hint}.`);
  }
  if (v.mix?.length) out.push('A mixed slider wanders up to 30 either side of where you left it, drifting from bar to bar.');
  // the controls that do nothing right now, and why (each one is also greyed out, with the reason as its tooltip)
  const why = new Map();
  for (const [id, reason] of Object.entries(idle)) {
    if (!why.has(reason)) why.set(reason, []);
    why.get(reason).push(field(id).name);
  }
  for (const [reason, names] of why) out.push(`Greyed out (${names.join(', ')}): ${reason}`);
  if (group === 'bass') {
    if (style.id !== 'rock') {
      if (song.timeSignature !== '4/4') out.push('In 6/8, 7/8 and 10/8 the line follows the groupings: one note per group, or one per eighth for running eighths.');
      else if (v.rhythm === 'eighths' && bpm > 170) out.push('Running eighths get busy above about 170 BPM.');
      if (v.tension >= 70) out.push('With lots of colour, notes such as 9ths and 13ths land on strong beats and can clash with the keys.');
    }
  } else if (group === 'comp') {
    if (v.rhythm !== 'auto' && v.rhythm !== 'mixed') out.push('A named rhythm fixes the pattern for a chord that fills the bar; the sliders still shape length, voicing and dynamics, and build the rhythm for shorter chords.');
    if (song.timeSignature !== '4/4') out.push('In 6/8, 7/8 and 10/8 chords fall on the group downbeats, or on the skip at the end of a 3-group.');
  } else if (style.id === 'jazz') {
    out.push('In jazz the Snare slider sets how much the drummer comps behind the soloist; at the bottom there is none.');
  }
  return out.join(' ');
}

export function mountBandUI({ store, storage = null }) {
  const root = $('band-panels');
  const panels = {};
  let builtFor = null;

  function $(id) { return document.getElementById(id); }

  const patch = (group, change) => {
    const { config } = store.get();
    const style = getStyle(config.style);
    store.set({ config: { ...config, [group]: sanitizeGroup(group, { ...config[group], ...change }, DEFAULTS[group](style)) } });
  };

  /**
   * A groove or bass figure can ask for a swing (the straight Latin ones want 50%). Choosing one sets it; leaving the last one
   * puts the style's own swing back. `field` is what is being changed ('groove' or 'pattern') and `value` what it becomes.
   */
  function presetSwing(field, value) {
    const { config, song, transport, view } = store.get();
    const style = getStyle(config.style);
    const before = bandSwing(style.id, config.kit, config.bass);
    const after = bandSwing(style.id, field === 'groove' ? { ...config.kit, groove: value } : config.kit, field === 'pattern' ? { ...config.bass, pattern: value } : config.bass);
    if (after !== null) store.set({ config: { ...config, swing: after } });
    else if (before !== null) {
      store.set({ config: { ...config, swing: defaultSwing(style, transport === 'stopped' ? song.tempo : (view?.bpm ?? song.tempo)) } });
    }
  }

  /** Draw a panel's controls for a style. Redone only when the style changes, since the fields and options differ. */
  function build(group, style, meter) {
    const p = panels[group];
    p.grid.replaceChildren();
    p.inputs = {};
    for (const f of fieldsFor(group, style.id)) {
      const id = `band-${group}-${f.id}`;
      if (f.type === 'select') {
        const wrap = el('label', 'field bl-field');
        wrap.append(f.name);
        const sel = el('select');
        sel.id = id;
        for (const o of optionsForMeter(f, style.id, meter)) { const opt = el('option', '', o.name); opt.value = o.id; sel.append(opt); }
        sel.addEventListener('change', () => {
          if (f.id === 'groove' || (f.id === 'pattern' && group === 'bass')) presetSwing(f.id, sel.value);
          patch(group, { [f.id]: sel.value });
        });
        wrap.append(sel);
        p.grid.append(wrap);
        p.inputs[f.id] = { field: f, wrap, input: sel };
      } else {
        const wrap = el('div', 'bl-range');
        const head = el('div', 'swing-head');
        const label = el('label', '', f.name);
        label.htmlFor = id;
        if (f.hint) label.title = f.hint;
        const out = el('output');
        out.htmlFor = id;
        // Mix: let this slider wander around where it is left instead of staying put
        const mix = el('button', 'mixbtn', 'Mix');
        mix.type = 'button';
        mix.title = `Mix: ${f.name} wanders around this setting from bar to bar`;
        mix.addEventListener('click', () => {
          const current = store.get().config[group].mix ?? [];
          patch(group, { mix: current.includes(f.id) ? current.filter((x) => x !== f.id) : [...current, f.id] });
        });
        head.append(label, out, mix);
        const input = el('input', 'slider');
        input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '5'; input.id = id;
        input.addEventListener('input', () => patch(group, { [f.id]: Number(input.value) }));
        const words = wordsFor(f, style.id);
        const ends = el('div', 'swing-ends');
        ends.append(el('span', '', words[0]), el('span', '', words[words.length - 1]));
        ends.setAttribute('aria-hidden', 'true');
        wrap.append(head, input, ends);
        p.grid.append(wrap);
        p.inputs[f.id] = { field: f, wrap, input, out, mix };
      }
    }
  }

  /** The drum mixer's faders for a style (Brushes only for jazz). */
  function buildMixer(style) {
    const m = panels.kit.mixer;
    m.grid.replaceChildren();
    m.rows = {};
    for (const part of DRUM_PARTS) {
      if (part.styles && !part.styles.includes(style.id)) continue;
      const id = `band-kit-level-${part.id}`;
      const row = el('div', 'mm-row');
      const label = el('label', '', part.name);
      label.htmlFor = id;
      const out = el('output');
      out.htmlFor = id;
      const input = el('input', 'slider');
      input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '5'; input.id = id;
      input.addEventListener('input', () => patch('kit', { levels: { ...store.get().config.kit.levels, [part.id]: Number(input.value) } }));
      input.addEventListener('dblclick', () => patch('kit', { levels: { ...store.get().config.kit.levels, [part.id]: 50 } })); // back to unity
      row.append(label, out, input);
      m.grid.append(row);
      m.rows[part.id] = { input, out };
    }
  }

  // ---- static shell: one collapsible panel per group -----------------------------------------
  for (const group of GROUP_IDS) {
    const section = el('section', 'bassline');
    section.setAttribute('aria-label', GROUPS[group].title);
    const details = el('details');
    details.dataset.section = `panel-${group}`;
    const summary = el('summary');
    const title = el('span', 'bl-title', GROUPS[group].title);
    const sum = el('span', 'bl-sum');
    summary.append(title, sum);
    const body = el('div', 'bl-body');
    const grid = el('div', 'bl-grid');
    const hint = el('p', 'hint');
    const reset = el('button', 'chip');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      const { config } = store.get();
      store.set({ config: { ...config, [group]: DEFAULTS[group](getStyle(config.style)) } });
    });
    let mixer = null;
    if (group === 'kit') {
      // the mini mixer: one small fader per drum, folded away until wanted (drawn per style in build())
      const md = el('details', 'minimix');
      md.dataset.section = 'panel-kit-mixer';
      const ms = el('summary');
      const msum = el('span', 'bl-sum');
      ms.append(el('span', 'bl-title', 'Drum mixer'), msum);
      const mg = el('div', 'mm-grid');
      md.append(ms, mg);
      mixer = { details: md, sum: msum, grid: mg, rows: {} };
    }
    body.append(grid, ...(mixer ? [mixer.details] : []), hint, reset);
    details.append(summary, body);
    section.append(details);
    root.append(section);
    panels[group] = { section, details, sum, grid, hint, reset, mixer, inputs: {} };
  }
  mountCollapsibles({ root, storage });

  let last = '';
  function render(state) {
    const { config, song } = state;
    const style = getStyle(config.style);
    const bpm = state.transport === 'stopped' ? song.tempo : (state.view?.bpm ?? song.tempo);
    const sig = JSON.stringify([config.style, config.bass, config.comp, config.kit, song.timeSignature, bpm > 170]);
    if (sig === last) return; // the store fires on every beat; only redraw when these panels' inputs change
    last = sig;

    const built = `${style.id}|${song.timeSignature}`; // the lists differ between the meters (Bembé is a 6/8 groove)
    if (builtFor !== built) { builtFor = built; for (const g of GROUP_IDS) build(g, style, song.timeSignature); buildMixer(style); }
    for (const group of GROUP_IDS) {
      const p = panels[group];
      const v = config[group];
      const defaults = DEFAULTS[group](style);
      const idle = inactiveControls(group, v, style.id, song.timeSignature);
      for (const { field: f, wrap, input, out, mix } of Object.values(p.inputs)) {
        // a stored choice that plays like another one in this meter shows as that one
        const shown = f.type === 'select' ? effectiveOption(f, v[f.id], style.id, song.timeSignature) : v[f.id];
        if (document.activeElement !== input) input.value = String(shown);
        if (f.type === 'slider') {
          const mixed = v.mix.includes(f.id);
          out.textContent = mixed ? `Mixed around ${wordFor(f, style.id, v[f.id]).toLowerCase()}` : wordFor(f, style.id, v[f.id]);
          mix.setAttribute('aria-pressed', String(mixed));
          wrap.classList.toggle('is-mixed', mixed);
        }
        const why = idle[f.id];
        input.disabled = Boolean(why);
        if (mix) mix.disabled = Boolean(why); // a slider that does nothing has nothing to wander around
        wrap.classList.toggle('inactive', Boolean(why));
        if (why) wrap.title = why; else wrap.removeAttribute('title');
      }
      if (p.mixer) {
        for (const [id, { input, out }] of Object.entries(p.mixer.rows)) {
          if (document.activeElement !== input) input.value = String(v.levels[id]);
          const db = levelDb(v.levels[id]);
          out.textContent = db === -Infinity ? 'Off' : `${db > 0 ? '+' : ''}${Math.round(db)} dB`;
        }
        const changed = DRUM_PARTS.filter((x) => p.mixer.rows[x.id] && v.levels[x.id] !== defaults.levels[x.id]).map((x) => x.name);
        p.mixer.sum.textContent = changed.length ? changed.join(', ') : 'Every drum at its own level';
      }
      p.sum.textContent = describeGroup(group, v, defaults, style.id);
      p.hint.textContent = notes(group, v, style, song, bpm);
      const isDefault = JSON.stringify(sanitizeGroup(group, v, defaults)) === JSON.stringify(defaults);
      p.reset.hidden = isDefault;
      p.reset.textContent = `Style default: ${style.name}`;
    }
  }

  store.subscribe(render);
  render(store.get());
}
