// The Bass line, Keys and Drums panels. One component draws all three from the schema in styles/settings.js: a select
// for each choice, a slider with a word for where it sits for each amount, a one-line summary in the header, and a
// button that puts the panel back to the style's own settings. Changes apply from the next bar.

import { defaultBass, defaultComp, defaultKit, getStyle } from '../styles/index.js';
import { GROUPS, GROUP_IDS, describeGroup, fieldsFor, optionsFor, sanitizeGroup, wordFor, wordsFor } from '../styles/settings.js';
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
  const field = (id) => GROUPS[group].fields.find((f) => f.id === id);
  for (const id of ['rhythm', 'pattern']) {
    const f = field(id);
    const o = f && v[id] !== undefined ? optionsFor(f, style.id).find((x) => x.id === v[id]) : null;
    if (o?.hint && (f.type === 'select') && !(group === 'comp' && o.id === 'auto')) out.push(`${o.name}: ${o.hint}.`);
  }
  if (v.mix?.length) out.push('A mixed slider wanders up to 30 either side of where you left it, drifting from bar to bar.');
  if (group === 'bass') {
    if (style.id === 'blues' && v.pattern === 'boogie') out.push('The walking controls do nothing while the blues plays its boogie.');
    else if (style.id !== 'rock') {
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

  /** Draw a panel's controls for a style. Redone only when the style changes, since the fields and options differ. */
  function build(group, style) {
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
        for (const o of optionsFor(f, style.id)) { const opt = el('option', '', o.name); opt.value = o.id; sel.append(opt); }
        sel.addEventListener('change', () => patch(group, { [f.id]: sel.value }));
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
    body.append(grid, hint, reset);
    details.append(summary, body);
    section.append(details);
    root.append(section);
    panels[group] = { section, details, sum, grid, hint, reset, inputs: {} };
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

    if (builtFor !== style.id) { builtFor = style.id; for (const g of GROUP_IDS) build(g, style); }
    for (const group of GROUP_IDS) {
      const p = panels[group];
      const v = config[group];
      const defaults = DEFAULTS[group](style);
      for (const { field: f, wrap, input, out, mix } of Object.values(p.inputs)) {
        if (document.activeElement !== input) input.value = String(v[f.id]);
        if (f.type === 'slider') {
          const mixed = v.mix.includes(f.id);
          out.textContent = mixed ? `Mixed around ${wordFor(f, style.id, v[f.id]).toLowerCase()}` : wordFor(f, style.id, v[f.id]);
          mix.setAttribute('aria-pressed', String(mixed));
          wrap.classList.toggle('is-mixed', mixed);
        }
        const active = f.activeWhen ? f.activeWhen(v, style.id) : true;
        input.disabled = !active;
        wrap.classList.toggle('inactive', !active);
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
