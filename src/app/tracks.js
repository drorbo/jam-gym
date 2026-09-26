// The tracks controller: everything the Tracks panel does, with no DOM in it.
// It talks to the API, keeps its state in the app store under `tracks`, and applies loaded tracks through the player.
// The UI (tracks-ui.js) only renders this state and calls these methods, so all of it is testable in Node.

import { ApiError } from './api.js';
import { dataFromLocalSave, setupSignature } from './tracks-model.js';

const PAGE = 20;
const sameName = (a, b) => String(a).trim().toLocaleLowerCase() === String(b).trim().toLocaleLowerCase();

export const emptyBrowse = () => ({
  params: { q: '', style: '', meter: '', key: '', bpmMin: '', bpmMax: '', sort: '' },
  items: [], total: 0, loading: false, error: null, loaded: false,
});

export const initialTracksState = () => ({
  status: 'loading', // 'loading' | 'online' | 'offline'
  me: null,          // { id, displayName, trackCount, publishedCount, banned, eardle } once an identity exists
  features: { eardle: false }, // what the server offers: sign in with eardle
  mine: [], mineLoaded: false,
  active: null,      // the track whose setup is loaded: { id, title, author, likes, isMine, signature }
  tab: 'mine',
  browse: emptyBrowse(),
  busy: {},          // track id -> true while an action on it is in flight
  flash: null,       // { id, text, kind: 'ok' | 'error' }
  recovery: null,    // the recovery code, while it is being shown
  cookieNote: false, // show the one-time "we keep a cookie" note
});

/**
 * @param {{store: ReturnType<typeof import('./state.js').createStore>,
 *          player: {currentSetup: () => object, applySetup: (data: object) => void, saveCurrent?: Function},
 *          api: ReturnType<typeof import('./api.js').createApi>,
 *          storage?: {getItem: Function, setItem: Function},
 *          search?: string,
 *          setTimer?: typeof setTimeout}} deps
 */
export function createTracksController({ store, player, api, storage = null, search = '', setTimer = setTimeout }) {
  const NOTE_KEY = 'jamgym.tracks.note.v1';
  let flashId = 0;
  let searchSeq = 0;

  store.set({ tracks: initialTracksState() });

  const state = () => store.get().tracks;
  const set = (patch) => store.set({ tracks: { ...state(), ...patch } });
  const setBusy = (id, on) => {
    const busy = { ...state().busy };
    if (on) busy[id] = true; else delete busy[id];
    set({ busy });
  };

  function flash(text, kind = 'ok') {
    const id = ++flashId;
    set({ flash: { id, text, kind } });
    const t = setTimer(() => { if (state().flash?.id === id) set({ flash: null }); }, kind === 'error' ? 12_000 : 7_000);
    t?.unref?.();
  }

  /** Turn any failure into a message the person can act on, and note when the server is unreachable. */
  function fail(err) {
    if (err instanceof ApiError) {
      if (err.offline) { set({ status: 'offline' }); flash(err.message, 'error'); return err; }
      const wait = err.code === 'rate_limited' && err.retryAfter ? ` Try again in ${err.retryAfter} seconds.` : '';
      flash(`${err.message}${wait}`, 'error');
      return err;
    }
    flash('Something went wrong. Please try again.', 'error');
    return err;
  }

  const replaceIn = (list, track) => list.map((t) => (t.id === track.id ? { ...t, ...track } : t));

  function makeActive(track, source) {
    set({
      active: {
        id: track.id, title: track.title, author: track.author, likes: track.likes, isMine: track.isMine,
        source, signature: setupSignature(track.data),
      },
    });
  }

  /** The first write creates an identity on the server; pick it up so the panel can show the name. */
  async function noticeIdentity(hadIdentity) {
    if (state().me) return;
    try {
      const me = await api.me();
      set({ me });
      if (me && !hadIdentity) {
        const seen = storage?.getItem(NOTE_KEY) === '1';
        if (!seen) { set({ cookieNote: true }); storage?.setItem(NOTE_KEY, '1'); }
      }
    } catch { /* not important */ }
  }

  const ctrl = {
    get state() { return state(); },

    // ---- start-up --------------------------------------------------------------------------

    async init() {
      try {
        await api.health();
      } catch {
        set({ status: 'offline' });
        return;
      }
      try {
        const { me, features } = await api.whoami();
        set({ status: 'online', me, features: features ?? { eardle: false } });
        if (me) await ctrl.refreshMine();
        // back from eardle: the server has already done the sign-in (or refused it); say which
        const outcome = new URLSearchParams(search).get('eardle');
        if (outcome === 'ok' && me) flash(`Signed in with eardle as ${me.displayName}.`);
        else if (outcome) flash('Signing in with eardle did not work. Please try again.', 'error');
      } catch (err) { fail(err); }
      const shared = new URLSearchParams(search).get('track');
      if (shared) await ctrl.openShared(shared);
    },

    async refreshMe() {
      try { set({ me: await api.me() }); } catch (err) { fail(err); }
    },

    async refreshMine() {
      try {
        const mine = await api.myTracks();
        set({ mine, mineLoaded: true });
        const me = state().me;
        if (me) set({ me: { ...me, trackCount: mine.length, publishedCount: mine.filter((t) => t.visibility === 'published').length } });
      } catch (err) { fail(err); }
    },

    /** Show a short message in the panel (used by the UI for things like "Link copied"). */
    notify: (text, kind = 'ok') => flash(text, kind),

    dismissCookieNote: () => set({ cookieNote: false }),

    setTab(tab) {
      set({ tab });
      if (tab === 'browse' && !state().browse.loaded) ctrl.search({});
    },

    // ---- my tracks -------------------------------------------------------------------------

    /** Save the current setup under a name. An existing track with that name is updated instead. */
    async save(name) {
      const title = String(name ?? '').trim();
      if (!title) { flash('Give it a name first.', 'error'); return null; }
      const data = player.currentSetup();
      const hadIdentity = Boolean(state().me);
      try {
        const existing = state().mine.find((t) => sameName(t.title, title));
        const track = existing
          ? await api.updateTrack(existing.id, { title, data })
          : await api.createTrack({ title, data });
        await noticeIdentity(hadIdentity);
        await ctrl.refreshMine();
        makeActive(track, 'mine');
        flash(existing ? `Updated "${track.title}".` : `Saved "${track.title}".`);
        return track;
      } catch (err) {
        if (err instanceof ApiError && err.offline && player.saveCurrent) {
          // no connection: keep it on this device instead of losing it
          const r = player.saveCurrent(title);
          if (r.ok) flash(`You're offline, so "${r.item.name}" was saved on this device. You can move it to your library later.`);
          else flash(r.error, 'error');
          return null;
        }
        fail(err);
        return null;
      }
    },

    /** Overwrite a saved track with the setup that is loaded right now. */
    async updateFromCurrent(id) {
      setBusy(id, true);
      try {
        const track = await api.updateTrack(id, { data: player.currentSetup() });
        await ctrl.refreshMine();
        makeActive(track, 'mine');
        flash(`Updated "${track.title}" with the current setup.`);
      } catch (err) { fail(err); } finally { setBusy(id, false); }
    },

    async remove(id) {
      setBusy(id, true);
      try {
        const title = state().mine.find((t) => t.id === id)?.title ?? 'The track';
        await api.deleteTrack(id);
        set({ active: state().active?.id === id ? null : state().active });
        await ctrl.refreshMine();
        flash(`Deleted "${title}".`);
      } catch (err) { fail(err); } finally { setBusy(id, false); }
    },

    async setPublished(id, published) {
      setBusy(id, true);
      try {
        const track = published ? await api.publish(id) : await api.unpublish(id);
        set({ mine: replaceIn(state().mine, track) });
        await ctrl.refreshMe();
        flash(published ? `"${track.title}" is now public.` : `"${track.title}" is private again.`);
      } catch (err) { fail(err); } finally { setBusy(id, false); }
    },

    // ---- loading tracks --------------------------------------------------------------------

    /** Load a track's whole setup into the player. Accepts a list item (fetches the full setup) or a full track. */
    async open(trackOrId, source = 'mine') {
      const id = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
      setBusy(id, true);
      try {
        const track = typeof trackOrId === 'object' && trackOrId.data ? trackOrId : await api.getTrack(id);
        player.applySetup(track.data);
        makeActive(track, source);
        flash(`Loaded "${track.title}"${track.isMine ? '' : ` by ${track.author}`}.`);
        return track;
      } catch (err) { fail(err); return null; } finally { setBusy(id, false); }
    },

    /** A track opened from a shared link. */
    async openShared(id) {
      const track = await ctrl.open(id, 'shared');
      if (!track) flash('That track was not found. It may have been made private or removed.', 'error');
      return track;
    },

    /** Save someone's published track into my own library. */
    async copy(id) {
      setBusy(id, true);
      const hadIdentity = Boolean(state().me);
      try {
        const track = await api.copy(id);
        await noticeIdentity(hadIdentity);
        await ctrl.refreshMine();
        flash(`Saved "${track.title}" to your tracks.`);
        return track;
      } catch (err) { fail(err); return null; } finally { setBusy(id, false); }
    },

    shareUrl: (id, origin) => `${origin}/?track=${encodeURIComponent(id)}`,

    // ---- likes and reports -----------------------------------------------------------------

    /** Like or unlike straight away, and undo the change if the server says no. */
    async toggleLike(id) {
      const { browse, mine } = state();
      const item = browse.items.find((t) => t.id === id) ?? mine.find((t) => t.id === id);
      if (!item || item.isMine) return;
      const before = { likes: item.likes, likedByMe: item.likedByMe };
      const want = !item.likedByMe;
      const apply = (patch) => {
        const s = state();
        set({
          browse: { ...s.browse, items: replaceIn(s.browse.items, { id, ...patch }) },
          mine: replaceIn(s.mine, { id, ...patch }),
          active: s.active?.id === id ? { ...s.active, likes: patch.likes } : s.active,
        });
      };
      apply({ likes: Math.max(0, before.likes + (want ? 1 : -1)), likedByMe: want });
      const hadIdentity = Boolean(state().me);
      try {
        const r = want ? await api.like(id) : await api.unlike(id);
        apply({ likes: r.likes, likedByMe: r.likedByMe });
        await noticeIdentity(hadIdentity);
      } catch (err) {
        apply(before);
        fail(err);
      }
    },

    async report(id, reason = '') {
      try {
        const r = await api.report(id, reason);
        if (r.hidden) {
          const s = state();
          set({ browse: { ...s.browse, items: s.browse.items.filter((t) => t.id !== id), total: Math.max(0, s.browse.total - 1) } });
        }
        flash('Thanks for the report. We will take a look.');
      } catch (err) { fail(err); }
    },

    // ---- browsing --------------------------------------------------------------------------

    /**
     * Search the published tracks. `patch` changes filters; `append` fetches the next page.
     * Only the latest search is allowed to write its results, so fast typing can never show stale ones.
     */
    async search(patch = {}, { append = false } = {}) {
      const seq = ++searchSeq;
      const current = state().browse;
      const params = { ...current.params, ...patch };
      set({ browse: { ...current, params, loading: true, error: null } });
      try {
        const offset = append ? current.items.length : 0;
        const r = await api.browse({ ...params, limit: PAGE, offset });
        if (seq !== searchSeq) return;
        const s = state().browse;
        set({ browse: { ...s, params, items: append ? [...s.items, ...r.items] : r.items, total: r.total, loading: false, loaded: true, error: null } });
      } catch (err) {
        if (seq !== searchSeq) return;
        const s = state().browse;
        set({ browse: { ...s, loading: false, loaded: true, error: err instanceof ApiError ? err.message : 'The search failed.' } });
        if (err instanceof ApiError && err.offline) set({ status: 'offline' });
      }
    },

    loadMore: () => ctrl.search({}, { append: true }),

    // ---- account ---------------------------------------------------------------------------

    async rename(name) {
      try {
        set({ me: await api.rename(name) });
        await ctrl.refreshMine();
        flash('Your name was updated.');
        return true;
      } catch (err) { fail(err); return false; }
    },

    async showRecovery() {
      try { set({ recovery: await api.recoveryCode() }); } catch (err) { fail(err); }
    },
    hideRecovery: () => set({ recovery: null }),

    /** Switch this browser to another identity using its recovery code. */
    async recover(code) {
      try {
        const me = await api.recover(code);
        set({ me, active: null, recovery: null, mine: [], mineLoaded: false });
        await ctrl.refreshMine();
        if (state().browse.loaded) await ctrl.search({});
        flash(`Signed in as ${me.displayName}.`);
        return true;
      } catch (err) { fail(err); return false; }
    },

    /** End this browser's eardle sign-in. The library stays with the eardle account; sign in again to open it. */
    async signOut() {
      try {
        await api.signOut();
        set({ me: null, mine: [], mineLoaded: false, active: null, recovery: null });
        if (state().browse.loaded) await ctrl.search({});
        flash('Signed out. Sign in with eardle again to open your library.');
        return true;
      } catch (err) { fail(err); return false; }
    },

    async deleteAccount() {
      try {
        await api.deleteMe();
        set({ me: null, mine: [], mineLoaded: false, active: null, recovery: null });
        if (state().browse.loaded) await ctrl.search({});
        flash('Your tracks, likes and name were deleted.');
        return true;
      } catch (err) { fail(err); return false; }
    },

    // ---- moving the old browser-only list into the library ---------------------------------

    /** Progressions saved on this device by the earlier version of the app. */
    localSaves: () => store.get().saved ?? [],

    async importLocal() {
      const local = ctrl.localSaves();
      if (!local.length) return;
      const hadIdentity = Boolean(state().me);
      try {
        const r = await api.importTracks(local.map((x) => ({ title: x.name, data: dataFromLocalSave(x) })));
        const skipped = new Set(r.skipped.map((s) => s.title));
        const remaining = local.filter((x) => skipped.has(x.name));
        store.set({ saved: remaining, activeSaved: null });
        await noticeIdentity(hadIdentity);
        await ctrl.refreshMine();
        flash(remaining.length
          ? `Moved ${r.created} to your library. ${remaining.length} could not be moved and stay on this device.`
          : `Moved ${r.created} ${r.created === 1 ? 'progression' : 'progressions'} to your library.`);
      } catch (err) { fail(err); }
    },
  };

  return ctrl;
}
