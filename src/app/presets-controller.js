// The presets controller: everything the presets row does, with no DOM in it (presets-ui.js only draws it).
//
// A person's own presets always live on this device, so they work offline and without an account. Once the person has an
// identity (they have saved a track, so there is already a cookie) the list is also synced to the account: every change is
// sent, and the server's answer is merged in, so a second device sees the same presets. Presets never create an identity.

import {
  applySettings, builtinPresets, loadLibrary, mergeLibraries, presetSignature, removePreset, restorePreset,
  sanitizeLibrary, savePreset, saveLibrary, settingsFromConfig, randomId,
} from './presets.js';

export const initialPresetsState = (items = []) => ({
  items,               // the person's own presets
  sync: 'local',       // 'local' (device only) | 'syncing' | 'synced' | 'offline' | 'error'
  note: null,          // { id, text, kind: 'ok' | 'error', undo?: true }
});

/**
 * @param {{store: ReturnType<typeof import('./state.js').createStore>,
 *          api?: {syncPresets: (payload: object) => Promise<object>} | null,
 *          storage?: {getItem: Function, setItem: Function} | null,
 *          player?: {setTempo: (bpm: number) => void} | null,
 *          now?: () => number, makeId?: () => string, setTimer?: typeof setTimeout}} deps
 */
export function createPresetsController({ store, api = null, storage = null, player = null, now = Date.now, makeId = randomId, setTimer = setTimeout }) {
  let lib = loadLibrary(storage);
  let lastRemoved = null;
  let syncing = false;
  let again = false;
  let noteSeq = 0;

  const hasIdentity = () => Boolean(store.get().tracks?.me);
  const state = () => store.get().presets;
  const set = (patch) => store.set({ presets: { ...state(), ...patch } });
  store.set({ presets: initialPresetsState(lib.items) });

  function flash(text, kind = 'ok', undo = false) {
    const id = ++noteSeq;
    set({ note: { id, text, kind, undo } });
    const t = setTimer(() => { if (state().note?.id === id) set({ note: null }); }, kind === 'error' ? 10_000 : 7_000);
    t?.unref?.();
  }

  const commit = (next) => {
    lib = next;
    saveLibrary(storage, lib);
    set({ items: lib.items });
    ctrl.sync();
  };

  const toWire = (p) => ({ id: p.id, name: p.name, data: p.settings, updatedAt: p.updatedAt });

  const ctrl = {
    get state() { return state(); },

    /** The built-in presets for a style. */
    builtin: (styleId) => builtinPresets(styleId),

    /** Is the band exactly as this preset sets it? */
    isActive: (preset) => presetSignature(settingsFromConfig(store.get().config)) === presetSignature(preset.settings),

    /**
     * Lay a preset over the band and set its tempo (while playing, from the next beat). The chords, key and meter are never
     * touched. A preset saved without a tempo leaves yours alone.
     */
    apply(preset) {
      store.set({ config: applySettings(store.get().config, preset.settings) });
      const bpm = preset.settings?.tempo ?? null;
      if (bpm) {
        if (player) player.setTempo(bpm);
        else store.set({ song: { ...store.get().song, tempo: bpm } });
      }
      flash(`${preset.name} applied${bpm ? `, tempo ${bpm} BPM` : ''}.`);
    },

    /** Save the band as it is now, with the tempo, under a name (an existing name is updated). */
    saveCurrent(name) {
      const { config, song } = store.get();
      const r = savePreset(lib, { name, settings: { ...settingsFromConfig(config), tempo: song.tempo } }, { now: now(), makeId });
      if (!r.ok) { flash(r.error, 'error'); return r; }
      commit(r.lib);
      flash(r.replaced ? `Updated "${r.item.name}".` : `Saved "${r.item.name}".${hasIdentity() ? '' : ' It is kept on this device.'}`);
      return r;
    },

    remove(id) {
      const r = removePreset(lib, id, now());
      if (!r.removed) return;
      lastRemoved = r.removed;
      commit(r.lib);
      flash(`Deleted "${r.removed.name}".`, 'ok', true);
    },

    undo() {
      if (!lastRemoved) return;
      const item = lastRemoved;
      lastRemoved = null;
      commit(restorePreset(lib, item, now()));
      flash(`Brought back "${item.name}".`);
    },

    /** Send the list to the account and merge the answer in. Does nothing without an identity or a server. */
    async sync() {
      if (!api || !hasIdentity()) return;
      if (syncing) { again = true; return; }
      syncing = true;
      set({ sync: 'syncing' });
      try {
        do {
          again = false;
          const res = await api.syncPresets({
            presets: lib.items.map(toWire),
            deleted: Object.entries(lib.deleted).map(([id, at]) => ({ id, at })),
          });
          const remote = sanitizeLibrary({ items: res.presets, deleted: Object.fromEntries((res.deleted ?? []).map((d) => [d.id, d.at])) });
          // changes made while the request was out are still in `lib`, and win if they are newer
          lib = mergeLibraries(lib, remote);
          saveLibrary(storage, lib);
          set({ items: lib.items });
          if (res.skipped) flash(`${res.skipped} preset${res.skipped === 1 ? ' was' : 's were'} not synced: your account is full.`, 'error');
        } while (again);
        set({ sync: 'synced' });
      } catch (err) {
        set({ sync: err?.offline ? 'offline' : 'error' });
      } finally {
        syncing = false;
      }
    },

    /** Start syncing now if there is an account, and whenever one appears (the first saved track creates it). */
    start() {
      let had = hasIdentity();
      if (had) ctrl.sync();
      store.subscribe(() => {
        const has = hasIdentity();
        if (has && !had) ctrl.sync();
        had = has;
      });
    },
  };
  return ctrl;
}
