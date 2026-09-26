import { createApi } from './api.js';
import { Player } from './player.js';
import { loadSaved, persistSaved } from './saved.js';
import { createStore, loadState, saveState } from './state.js';
import { createPresetsController } from './presets-controller.js';
import { createTracksController } from './tracks.js';
import { mountBandUI } from './band-ui.js';
import { mountCollapsibles } from './collapsible.js';
import { mountSidebar } from './sidebar.js';
import { mountPresetsUI } from './presets-ui.js';
import { mountQuickProgressions } from './quick-ui.js';
import { mountTracksUI } from './tracks-ui.js';
import { mountUI } from './ui.js';

const store = createStore({ ...loadState(), saved: loadSaved(), activeSaved: null });
const player = new Player(store);
mountUI({ store, player });
mountQuickProgressions({ store, player });

let storage = null;
try { storage = window.localStorage; } catch { /* storage blocked: the cookie note will simply show each visit */ }
mountBandUI({ store, storage });

// Tracks: the server-backed library and community list. If the server can't be reached the app still works,
// and saving falls back to this device.
const api = createApi();
const tracks = createTracksController({ store, player, api, storage, search: location.search });

// Presets: the band settings you save. They live on this device, and also sync to your account once you have one.
const presets = createPresetsController({ store, api, storage, player });
presets.start();
const sidebar = mountSidebar({ storage });
mountTracksUI({ store, player, tracks, sidebar });
mountPresetsUI({ store, presets, tracks, sidebar });
mountCollapsibles({ root: document.getElementById('sidebar'), storage, toggleAll: document.getElementById('sec-toggle-all') });
tracks.init();
// the sign-in with eardle result is announced once (by tracks.init from the address), then taken off the address bar
try {
  const url = new URL(location.href);
  if (url.searchParams.has('eardle')) { url.searchParams.delete('eardle'); history.replaceState(null, '', url.pathname + url.search + url.hash); }
} catch { /* an old browser: the parameter just stays */ }

store.subscribe((state, patch) => {
  if (patch.song || patch.config || patch.mixer || patch.theme) saveState(state);
  if (patch.saved) persistSaved(state.saved);
});

// Handy for debugging in the console.
window.__jam = { store, player, tracks, presets, sidebar };
