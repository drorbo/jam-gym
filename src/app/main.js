import { createApi } from './api.js';
import { Player } from './player.js';
import { loadSaved, persistSaved } from './saved.js';
import { createStore, loadState, saveState } from './state.js';
import { createTracksController } from './tracks.js';
import { mountBassUI } from './bass-ui.js';
import { mountCollapsibles } from './collapsible.js';
import { mountSidebar } from './sidebar.js';
import { mountTracksUI } from './tracks-ui.js';
import { mountUI } from './ui.js';

const store = createStore({ ...loadState(), saved: loadSaved(), activeSaved: null });
const player = new Player(store);
mountUI({ store, player });
mountBassUI({ store });

// Tracks: the server-backed library and community list. If the server can't be reached the app still works,
// and saving falls back to this device.
let storage = null;
try { storage = window.localStorage; } catch { /* storage blocked: the cookie note will simply show each visit */ }
const tracks = createTracksController({ store, player, api: createApi(), storage, search: location.search });
const sidebar = mountSidebar({ storage });
mountTracksUI({ store, player, tracks, sidebar });
mountCollapsibles({ root: document.getElementById('sidebar'), storage, toggleAll: document.getElementById('sec-toggle-all') });
tracks.init();

store.subscribe((state, patch) => {
  if (patch.song || patch.config || patch.mixer || patch.theme) saveState(state);
  if (patch.saved) persistSaved(state.saved);
});

// Handy for debugging in the console.
window.__jam = { store, player, tracks, sidebar };
