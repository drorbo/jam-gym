// The quick progressions under the progression box: pick a kind, then a progression. Choosing one changes the chords only
// (moved into your starting key); the odd-meter ones also set the time and say so in their tooltip. The tabs start on the
// style you are playing, and follow it when you change style, until you pick a tab yourself.

import { getStyle } from '../styles/index.js';
import { keyPrefersFlats, parseKey } from '../theory/keys.js';
import { transposeProgressionText } from '../theory/progression.js';
import { PROGRESSION_GROUPS, groupForStyle } from './progressions.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A quick progression written in C, moved into the given key. */
export function inKey(text, keyName) {
  const key = parseKey(keyName) ?? { pc: 0, minor: false };
  return transposeProgressionText(text, key.pc, keyPrefersFlats(key.pc, key.minor));
}

export function mountQuickProgressions({ store, player }) {
  const tabsEl = document.getElementById('quick-tabs');
  const listEl = document.getElementById('examples');
  if (!tabsEl || !listEl) return;
  let manual = null; // a tab the person picked
  let lastStyle = null;
  let last = '';

  for (const g of PROGRESSION_GROUPS) {
    const b = el('button', '', g.name);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.group = g.id;
    tabsEl.append(b);
  }
  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-group]');
    if (!b) return;
    manual = b.dataset.group;
    render(store.get());
  });

  function render(state) {
    const { config, song } = state;
    if (config.style !== lastStyle) { lastStyle = config.style; manual = null; } // changing style brings the tabs along
    const group = PROGRESSION_GROUPS.find((g) => g.id === manual) ?? groupForStyle(config.style);
    const shown = group.items.map((ex) => inKey(ex.text, song.key));
    const sig = JSON.stringify([group.id, shown, song.progressionText, song.timeSignature]);
    if (sig === last) return; // the store fires on every beat; only redraw when the chips would change
    last = sig;

    tabsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.group === group.id)));
    listEl.replaceChildren(...group.items.map((ex, i) => {
      const b = el('button', 'chip', ex.name);
      b.type = 'button';
      b.title = ex.timeSignature
        ? `Also sets the time to ${ex.timeSignature}: these only make sense in their meter. Your style and settings stay as they are.`
        : 'Just the chords: your style, settings and tempo stay as they are.';
      // pressed when this is what is in the box (in your key, and in this meter if it needs one)
      const there = song.progressionText.trim() === shown[i].trim() && (!ex.timeSignature || ex.timeSignature === song.timeSignature);
      b.setAttribute('aria-pressed', String(there));
      b.addEventListener('click', () => {
        if (ex.timeSignature) player.setTimeSignature(ex.timeSignature); // first, so the text is read in that meter
        player.setProgressionText(inKey(ex.text, store.get().song.key));
      });
      return b;
    }));
    tabsEl.dataset.style = getStyle(config.style).id;
  }

  store.subscribe((state) => render(state));
  render(store.get());
}
