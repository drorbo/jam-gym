import { Player } from './player.js';
import { loadSaved, persistSaved } from './saved.js';
import { createStore, loadState, saveState } from './state.js';
import { mountUI } from './ui.js';

const store = createStore({ ...loadState(), saved: loadSaved(), activeSaved: null });
const player = new Player(store);
mountUI({ store, player });

store.subscribe((state, patch) => {
  if (patch.song || patch.config || patch.mixer || patch.theme) saveState(state);
  if (patch.saved) persistSaved(state.saved);
});

// Handy for debugging in the console.
window.__jam = { store, player };
