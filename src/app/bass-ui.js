// The Bass line panel: how the walking bass is played. Renders config.bass and writes changes back to it.
// The musical rules live in styles/walking.js; this file only reads and writes settings.

import { defaultBass, getStyle, hasBassOptions } from '../styles/index.js';
import { APPROACHES, PATTERNS, RHYTHMS, describeBass, sanitizeBass } from '../styles/walking.js';

const $ = (id) => document.getElementById(id);
const OPEN_KEY = 'jamgym.bass.open';

const lineWord = (v) => (v < 20 ? 'Scales' : v < 45 ? 'Mostly scales' : v < 65 ? 'Mixed' : v < 85 ? 'Mostly arpeggios' : 'Arpeggios');
const tensionWord = (v) => (v < 15 ? 'Chord tones' : v < 40 ? 'A few' : v < 70 ? 'Some' : 'Lots');

export function mountBassUI({ store }) {
  const fill = (id, list) => {
    for (const item of list) {
      const o = document.createElement('option');
      o.value = item.id;
      o.textContent = item.name;
      $(id).append(o);
    }
  };
  fill('bass-rhythm', RHYTHMS);
  fill('bass-approach', APPROACHES);
  fill('bass-pattern', PATTERNS);

  // remember whether the panel was open (a per-viewer convenience, so storage failing is harmless)
  const details = $('bass-details');
  try { details.open = localStorage.getItem(OPEN_KEY) === '1'; } catch { /* no storage */ }
  details.addEventListener('toggle', () => { try { localStorage.setItem(OPEN_KEY, details.open ? '1' : '0'); } catch { /* no storage */ } });

  /** The bass settings change from the next bar. */
  const patch = (change) => {
    const { config } = store.get();
    store.set({ config: { ...config, bass: sanitizeBass({ ...config.bass, ...change }, config.bass) } });
  };
  $('bass-rhythm').addEventListener('change', (e) => patch({ rhythm: e.target.value }));
  $('bass-approach').addEventListener('change', (e) => patch({ approach: e.target.value }));
  $('bass-pattern').addEventListener('change', (e) => patch({ pattern: e.target.value }));
  $('bass-line').addEventListener('input', (e) => patch({ line: Number(e.target.value) }));
  $('bass-tension').addEventListener('input', (e) => patch({ tension: Number(e.target.value) }));
  $('bass-reset').addEventListener('click', () => {
    const { config } = store.get();
    store.set({ config: { ...config, bass: defaultBass(getStyle(config.style)) } });
  });

  let last = '';
  function render(state) {
    const { config, song } = state;
    const style = getStyle(config.style);
    const sig = JSON.stringify([config.style, config.bass, song.timeSignature]);
    if (sig === last) return; // the store fires on every beat; only redraw when this panel's inputs change
    last = sig;

    const panel = $('bassline');
    panel.hidden = !hasBassOptions(style);
    if (panel.hidden) return;

    const b = config.bass;
    const blues = style.id === 'blues';
    const boogieOnly = blues && b.pattern === 'boogie';
    const def = defaultBass(style);
    const isDefault = JSON.stringify(b) === JSON.stringify(def);

    for (const [id, value] of [['bass-rhythm', b.rhythm], ['bass-approach', b.approach], ['bass-pattern', b.pattern]]) {
      if (document.activeElement !== $(id)) $(id).value = value;
    }
    for (const [id, value] of [['bass-line', b.line], ['bass-tension', b.tension]]) {
      if (document.activeElement !== $(id)) $(id).value = String(value);
    }
    $('bass-line-val').textContent = lineWord(b.line);
    $('bass-tension-val').textContent = tensionWord(b.tension);
    $('bass-pattern-field').hidden = !blues;
    $('bass-sum').textContent = describeBass(b, { blues });

    // the walking controls do nothing while the blues is playing its boogie
    for (const id of ['bass-rhythm', 'bass-line', 'bass-tension', 'bass-approach']) $(id).disabled = boogieOnly;
    $('bass-details').classList.toggle('off', boogieOnly);

    const rhythm = RHYTHMS.find((r) => r.id === b.rhythm);
    const notes = [];
    if (boogieOnly) notes.push(`${PATTERNS.find((p) => p.id === b.pattern).hint}. Choose a different pattern to use the walking controls.`);
    else {
      notes.push(`${rhythm.name}: ${rhythm.hint}.`);
      if (song.timeSignature !== '4/4') notes.push('In 6/8, 7/8 and 10/8 the line follows the groupings: one note per group, or one per eighth for running eighths.');
      else if (b.rhythm === 'eighths') notes.push('Running eighths get busy above about 170 BPM.');
      if (b.tension >= 70) notes.push('With lots of colour, notes such as 9ths and 13ths land on strong beats and can clash with the keys.');
    }
    $('bass-hint').textContent = notes.join(' ');
    $('bass-reset').hidden = isDefault;
    $('bass-reset').textContent = `Style default: ${style.name}`;
  }

  store.subscribe(render);
  render(store.get());
}
