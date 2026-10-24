// Undo and redo for the chords: the buttons, Ctrl+Z / Ctrl+Y, and keeping a snapshot of the progression text
// each time it changes (typing, the bar editor, a quick progression, a key change that moves the chords, loading a track).
// The history itself is src/app/history.js.

const $ = (id) => document.getElementById(id);

/**
 * @param {{store: ReturnType<typeof import('./state.js').createStore>, player: import('./player.js').Player,
 *          history: ReturnType<typeof import('./history.js').createHistory>}} parts
 */
export function mountHistoryUI({ store, player, history }) {
  const undoBtn = $('undo');
  const redoBtn = $('redo');
  const prog = $('prog');
  const textNow = () => store.get().song.progressionText;

  history.reset(textNow());
  let last = textNow();
  let applying = false;
  let kind = 'edit';

  // Anything that changes the text is remembered here, so no other code has to know about undo.
  // Typing is announced by the box itself just before the change, so a burst of typing is one step.
  if (prog) {
    prog.addEventListener('beforeinput', () => {
      kind = 'typing';
      setTimeout(() => { kind = 'edit'; }, 0); // the change follows in this same task; if there is none, forget it
    });
  }
  store.subscribe(() => {
    const text = textNow();
    if (text === last) return;
    last = text;
    if (!applying) history.push(text, { kind });
    kind = 'edit';
    paint();
  });

  function go(text) {
    if (text === null || text === undefined) return;
    applying = true;
    try { player.setProgressionText(text); } finally { applying = false; }
    last = textNow();
    paint();
  }
  const undo = () => go(history.undo());
  const redo = () => go(history.redo());

  function paint() {
    if (undoBtn) undoBtn.disabled = !history.canUndo;
    if (redoBtn) redoBtn.disabled = !history.canRedo;
  }
  undoBtn?.addEventListener('click', undo);
  redoBtn?.addEventListener('click', redo);

  // The app keeps its own history, which also covers the chords box (its built-in undo is cleared whenever the app
  // rewrites the box). Other text fields, such as the search box, keep their own.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const wantsUndo = key === 'z' && !e.shiftKey;
    const wantsRedo = key === 'y' || (key === 'z' && e.shiftKey);
    if (!wantsUndo && !wantsRedo) return;
    const t = e.target;
    if (t instanceof HTMLElement && t !== prog && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    if (wantsUndo) undo(); else redo();
  });

  paint();
  return { undo, redo };
}
