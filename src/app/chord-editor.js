// The chord picker: tap a bar in the grid, choose its chord (root, quality, slash bass), and add, remove, copy or move
// bars, without typing. Every change builds new progression text with src/theory/baredit.js and hands it to the Player,
// so the band, saving, sharing and the text box all keep working off the one text.

import {
  ACCIDENTALS, QUALITIES, ROOTS, barSymbols, buildSymbol, canEditText, deleteBar, duplicateBar, insertBar, moveBar,
  gridBars, removeSegment, setChord, splitBar, symbolToPicker, toggleRepeat, tokenizeBars,
} from '../theory/baredit.js';
import { getMeter } from '../theory/meter.js';
import { chordEl } from './ui.js';
import { parseNoteName } from '../theory/notes.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const pretty = (s) => s.replace(/b(?=\d|$)/g, '♭').replace(/#/g, '♯');

/** [label, written] for the slash-bass choices, one per note */
const BASS_NOTES = [['C', 'C'], ['C♯', 'C#'], ['D', 'D'], ['E♭', 'Eb'], ['E', 'E'], ['F', 'F'], ['F♯', 'F#'], ['G', 'G'], ['A♭', 'Ab'], ['A', 'A'], ['B♭', 'Bb'], ['B', 'B']];

/**
 * @param {{store: ReturnType<typeof import('./state.js').createStore>, player: import('./player.js').Player}} parts
 */
export function mountChordEditor({ store, player }) {
  const bars = $('bars');
  const picker = $('chordpicker');
  if (!bars || !picker) return;

  /** @type {{bar:number, seg:number}|null} */
  let sel = null;
  let message = '';
  let shown = '';

  const text = () => store.get().song.progressionText;
  const timeSignature = () => store.get().song.timeSignature;

  function setEditing(on) {
    if (Boolean(store.get().editing) !== on) store.set({ editing: on });
  }

  function open(bar, seg = 0) {
    sel = { bar, seg };
    message = '';
    setEditing(true);
    paint(true);
  }

  function close({ focus = true } = {}) {
    const bar = sel?.bar;
    sel = null;
    message = '';
    setEditing(false);
    paint(true);
    if (focus && bar !== undefined) bars.querySelector(`li.bar[data-bar="${bar}"] .barhit`)?.focus();
  }

  /** Run an edit; show why when it cannot be done. */
  function apply(result) {
    if (result.error) { message = result.error; paint(true); return false; }
    message = '';
    player.setProgressionText(result.text);
    return true;
  }

  const symbolAt = (bar, seg) => barSymbols(text(), bar)[seg] ?? 'C';
  /** The chord being edited, as the picker's parts. N.C. or something unreadable starts from a plain C. */
  const partsAt = (bar, seg) => symbolToPicker(symbolAt(bar, seg)) ?? { root: 'C', acc: '', quality: '', bass: '' };

  function choose(change) {
    if (!sel) return;
    const next = { ...partsAt(sel.bar, sel.seg), ...change };
    const symbol = buildSymbol(next);
    if (!symbol) { message = 'That combination is not a chord'; paint(true); return; }
    apply(setChord(text(), sel.bar, sel.seg, symbol));
  }

  // ---- taps on the bar grid ------------------------------------------------------------------------------

  bars.addEventListener('click', (e) => {
    const hit = e.target.closest('.barhit');
    if (!hit) return;
    const li = hit.closest('li.bar');
    if (!li) return;
    if (li.classList.contains('add')) {
      const count = tokenizeBars(text()).bars.length;
      if (apply(insertBar(text(), count - 1))) open(count, 0);
      return;
    }
    open(Number(li.dataset.bar), 0);
  });

  // ---- the picker ----------------------------------------------------------------------------------------

  function button(label, { key, pressed, disabled, cls = 'pk', title, onClick }) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (key) b.dataset.k = key;
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    if (disabled) b.disabled = true;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }
  // each part has its own class so the wide layout can put Root and Quality side by side (css/app.css)
  const GROUP_CLASS = { Root: 'pk-root', Quality: 'pk-quality', 'Bass note (slash chord)': 'pk-bass', 'Chord in this bar': 'pk-segs' };
  const group = (label, ...children) => {
    const g = el('div', `pk-group ${GROUP_CLASS[label] ?? ''}`.trim());
    g.append(el('div', 'pk-label', label));
    const row = el('div', 'pk-row');
    row.append(...children);
    g.append(row);
    return g;
  };

  function paint(force = false) {
    const t = text();
    // the grid is rebuilt whenever its bars change, so the marker is put back every time
    bars.querySelectorAll('li.bar').forEach((li) => li.classList.toggle('editing', Boolean(sel) && li.dataset.bar === String(sel.bar)));
    const stamp = `${sel ? `${sel.bar}.${sel.seg}` : '-'}|${t}|${timeSignature()}|${message}`;
    if (!force && stamp === shown) return;
    shown = stamp;

    if (!sel) { picker.hidden = true; picker.replaceChildren(); return; }

    const doc = tokenizeBars(t);
    if (sel.bar >= doc.bars.length) {
      if (!doc.bars.length) { close({ focus: false }); return; }
      sel.bar = doc.bars.length - 1;
    }
    const keep = document.activeElement?.closest?.('#chordpicker') ? document.activeElement.dataset.k : null;

    const editable = canEditText(t);
    const symbols = barSymbols(t, sel.bar);
    if (sel.seg >= symbols.length) sel.seg = Math.max(0, symbols.length - 1);
    const here = doc.bars[sel.bar];
    const isRepeat = here.content === '%';
    const parts = partsAt(sel.bar, sel.seg);
    const isNC = symbolAt(sel.bar, sel.seg) === 'NC';
    const cap = getMeter(timeSignature()).groups.length;

    // The top line is every bar as a small chip, so the chords stay in view while the panel is open: tap one to edit it.
    const strip = el('div', 'pk-strip');
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Bars. Choose the one to edit');
    gridBars(t).forEach((bar, i) => {
      const chip = button('', {
        key: `bar${i}`, pressed: i === sel.bar, cls: 'pk-bar',
        onClick: () => { sel.bar = i; sel.seg = 0; message = ''; paint(true); },
      });
      chip.setAttribute('aria-label', `Bar ${i + 1}: ${bar.chords.map((s) => s.chord?.symbol ?? s.text).join(' ')}${bar.repeat ? ' (repeat)' : ''}`);
      const chords = el('span', 'pk-chords');
      bar.chords.forEach((s) => {
        const c = el('span', s.invalid ? 'pk-c bad' : 'pk-c');
        if (s.chord) c.append(chordEl(s.chord)); else c.textContent = s.text;
        chords.append(c);
      });
      chip.append(el('span', 'pk-n', `${i + 1}${bar.repeat ? ' %' : ''}`), chords);
      strip.append(chip);
    });
    strip.append(button('+', {
      key: 'barnew', cls: 'pk pk-bar pk-newbar', title: 'Add a bar at the end',
      onClick: () => { const n = doc.bars.length; if (apply(insertBar(text(), n - 1))) { sel.bar = n; sel.seg = 0; paint(true); } },
    }));
    const head = el('div', 'pk-head');
    head.append(strip, button('Done', { cls: 'pk-done', key: 'done', onClick: () => close() }));

    // The line of bars and Done stay put at the top; only the buttons under them scroll.
    const body = [];
    if (!editable) {
      body.push(el('p', 'msg bad', 'There is a chord here the app cannot read. Fix it in the box below, then come back to the buttons.'));
    } else {
      if (symbols.length > 1) {
        body.push(group('Chord in this bar', ...symbols.map((s, i) => button(pretty(s), {
          key: `seg${i}`, pressed: i === sel.seg, cls: 'pk pk-seg',
          onClick: () => { sel.seg = i; paint(true); },
        }))));
      }
      body.push(
        group('Root',
          ...ROOTS.map((r) => button(r, { key: `r${r}`, pressed: !isNC && parts.root === r, onClick: () => choose({ root: r }) })),
          ...ACCIDENTALS.map(([label, acc]) => button(label, { key: `a${label}`, pressed: !isNC && parts.acc === acc, cls: 'pk pk-acc', title: acc === 'b' ? 'Flat' : acc === '#' ? 'Sharp' : 'Natural', onClick: () => choose({ acc }) }))),
        group('Quality', ...QUALITIES.map(([label, quality]) => button(label, { key: `q${quality || 'maj'}`, pressed: !isNC && parts.quality === quality, onClick: () => choose({ quality }) }))),
        group('Bass note (slash chord)',
          button('none', { key: 'bnone', pressed: !isNC && !parts.bass, onClick: () => choose({ bass: '' }) }),
          ...BASS_NOTES.map(([label, note]) => button(label, {
            key: `b${note}`, pressed: !isNC && Boolean(parts.bass) && parseNoteName(parts.bass) === parseNoteName(note), onClick: () => choose({ bass: note }),
          }))),
      );

      const chordActions = el('div', 'pk-actions');
      chordActions.append(
        button('N.C.', { key: 'nc', cls: 'pk pk-act', pressed: isNC, title: 'No chord: the drums keep going', onClick: () => apply(setChord(text(), sel.bar, sel.seg, 'NC')) }),
        button('+ Chord in this bar', { key: 'split', cls: 'pk pk-act', disabled: symbols.length >= cap, title: symbols.length >= cap ? `${timeSignature()} fits at most ${cap} chords in a bar` : 'Split the bar between more chords', onClick: () => apply(splitBar(text(), sel.bar, timeSignature())) }),
        button('Remove this chord', { key: 'rmseg', cls: 'pk pk-act', disabled: symbols.length < 2, onClick: () => apply(removeSegment(text(), sel.bar, sel.seg)) }),
        button(isRepeat ? 'Write the repeat out' : 'Repeat the bar before (%)', { key: 'rep', cls: 'pk pk-act', disabled: !isRepeat && sel.bar === 0, onClick: () => apply(toggleRepeat(text(), sel.bar)) }),
      );
      const barActions = el('div', 'pk-actions');
      const at = sel.bar;
      barActions.append(
        button('← Earlier', { key: 'left', cls: 'pk pk-act', disabled: at === 0, onClick: () => { if (apply(moveBar(text(), at, -1))) { sel.bar = at - 1; paint(true); } } }),
        button('Later →', { key: 'right', cls: 'pk pk-act', disabled: at === doc.bars.length - 1, onClick: () => { if (apply(moveBar(text(), at, 1))) { sel.bar = at + 1; paint(true); } } }),
        button('Duplicate bar', { key: 'dup', cls: 'pk pk-act', onClick: () => { if (apply(duplicateBar(text(), at))) { sel.bar = at + 1; sel.seg = 0; paint(true); } } }),
        button('Insert bar after', { key: 'ins', cls: 'pk pk-act', onClick: () => { if (apply(insertBar(text(), at))) { sel.bar = at + 1; sel.seg = 0; paint(true); } } }),
        button('Delete bar', { key: 'del', cls: 'pk pk-act pk-danger', onClick: () => {
          if (apply(deleteBar(text(), at))) {
            if (!tokenizeBars(text()).bars.length) close({ focus: false });
            else { sel.bar = Math.min(at, tokenizeBars(text()).bars.length - 1); sel.seg = 0; paint(true); }
          }
        } }),
      );
      // the choosers above are about the chord's sound; these are about what the bar holds and where it sits
      const section = (label, cls, row) => {
        const g = el('div', `pk-group ${cls}`);
        g.append(el('div', 'pk-label', label), row);
        return g;
      };
      body.push(el('hr', 'pk-rule'), section('Chords in this bar', 'pk-chordacts', chordActions), section('This bar', 'pk-baracts', barActions));
    }
    const status = el('p', message ? 'msg bad pk-status' : 'msg pk-status', message);
    status.setAttribute('role', 'status');
    const scroller = el('div', 'pk-body');
    scroller.tabIndex = -1;
    scroller.append(...body);

    // the panel is rebuilt on every change: stay where the person had scrolled to
    const scrolledTo = picker.querySelector('.pk-body')?.scrollTop ?? 0;
    picker.replaceChildren(head, status, scroller);
    picker.hidden = false;
    scroller.scrollTop = scrolledTo;
    picker.setAttribute('aria-label', `Edit bar ${sel.bar + 1}${isRepeat ? ' (repeats the bar before)' : ''}`);
    // keep the bar being edited in the middle of the line of chords
    const chosen = strip.querySelector('[aria-pressed="true"]');
    if (chosen) strip.scrollLeft = chosen.offsetLeft - (strip.clientWidth - chosen.offsetWidth) / 2;
    if (keep) picker.querySelector(`[data-k="${keep}"]`)?.focus({ preventScroll: true });
  }

  picker.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sel) { e.preventDefault(); e.stopPropagation(); close(); }
  });

  // keep the picker in step with the text (an undo, typing in the box, a loaded track) and the playing highlight
  store.subscribe(() => { if (sel || !picker.hidden) paint(); else shown = ''; });
  paint(true);
}
