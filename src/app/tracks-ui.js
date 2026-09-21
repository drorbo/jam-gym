// The Tracks panel: renders the controller's state and forwards clicks to it. No track logic lives here.
//
// Each region (account, my tracks, browse, messages, legacy list) re-renders only when its own inputs change, so typing
// in a search box or a rename field is never interrupted by a beat event or an unrelated update.

import { METER_IDS, getMeter } from '../theory/meter.js';
import { MAJOR_KEYS, MINOR_KEYS } from '../theory/keys.js';
import { listStyles, getStyle } from '../styles/index.js';
import { describeSaved } from './saved.js';
import { buildTrackData, setupSignature } from './tracks-model.js';
import { prettyKey } from './ui.js';

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const button = (label, cls, attrs = {}) => {
  const b = el('button', cls, label);
  b.type = 'button';
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  return b;
};

const HEART = 'M12 20.3 4.6 13.1C2.6 11.1 2.6 8 4.5 6.3 6.400 4.700 9 5 10.700 6.700L12 8l1.300-1.300C15 5 17.600 4.700 19.500 6.300c1.900 1.700 1.900 4.800-.1 6.800z';
function heartSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', HEART);
  svg.append(path);
  return svg;
}

/** "Key of B♭ · 7/8 · Jazz · 132 BPM · 8 bars" */
const metaLine = (t) => [`Key of ${prettyKey(t.key)}`, t.timeSignature, getStyle(t.style).name, `${t.tempo} BPM`, `${t.bars} ${t.bars === 1 ? 'bar' : 'bars'}`].join(' · ');
const chordPreview = (t) => {
  const shown = t.chords.slice(0, 8).join('  ');
  return t.chords.length > 8 ? `${shown}  …` : shown;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {{store: ReturnType<typeof import('./state.js').createStore>, tracks: ReturnType<typeof import('./tracks.js').createTracksController>,
 *          player: any}} deps
 */
export function mountTracksUI({ store, tracks, player }) {
  // Local UI state: which inline panel or confirmation is open. Not part of the app state on purpose.
  const ui = { accountPanel: null, confirm: null /* {id, kind} */, recoverError: '' };
  const last = {};
  let debounce = null;

  // ---- static setup ----------------------------------------------------------------------

  const option = (label, value) => { const o = el('option', '', label); o.value = value; return o; };
  const fStyle = $('f-style'); const fMeter = $('f-meter'); const fKey = $('f-key'); const fSort = $('f-sort');
  fStyle.append(option('Any', ''), ...listStyles().map((s) => option(s.name, s.id)));
  fMeter.append(option('Any', ''), ...METER_IDS.map((id) => option(id, id)));
  fKey.append(option('Any', ''), ...[...MAJOR_KEYS, ...MINOR_KEYS].map((k) => option(prettyKey(k), k)));
  fSort.append(option('Best match', ''), option('Most liked', 'likes'), option('Newest', 'new'));

  const tabs = { mine: $('tab-mine'), browse: $('tab-browse') };
  for (const [name, tab] of Object.entries(tabs)) tab.addEventListener('click', () => tracks.setTab(name));
  $('tracks').querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tracks.state.tab === 'mine' ? 'browse' : 'mine';
    tracks.setTab(next);
    tabs[next].focus();
  });

  // save box
  $('save-form').addEventListener('submit', (e) => { e.preventDefault(); tracks.save($('save-name').value); });
  $('save-name').addEventListener('input', () => renderSaveButton());

  // browse form: typing waits for a pause; selects and the form's Enter act at once
  const runSearch = () => tracks.search({
    q: $('browse-q').value, style: fStyle.value, meter: fMeter.value, key: fKey.value,
    bpmMin: $('f-bpm-min').value, bpmMax: $('f-bpm-max').value, sort: fSort.value,
  });
  const runSoon = () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 300); };
  $('browse-form').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(debounce); runSearch(); });
  $('browse-q').addEventListener('input', runSoon);
  for (const id of ['f-bpm-min', 'f-bpm-max']) $(id).addEventListener('input', runSoon);
  for (const sel of [fStyle, fMeter, fKey, fSort]) sel.addEventListener('change', runSearch);
  $('browse-more').addEventListener('click', () => tracks.loadMore());

  // ---- shared row pieces -----------------------------------------------------------------

  function stateChip(t) {
    if (t.visibility === 'published') return el('span', 'state state-pub', `Published · ${plural(t.likes, 'like')}`);
    if (t.visibility === 'hidden') return el('span', 'state state-hidden', 'Removed by a moderator');
    return el('span', 'state', 'Private');
  }

  /** The heart. A button for other people's tracks, a plain count for your own. */
  function likeControl(t) {
    if (t.isMine) {
      const own = el('span', 'heart own');
      own.append(heartSvg(), el('span', '', String(t.likes)));
      own.title = 'Likes on your track';
      own.setAttribute('aria-label', `${plural(t.likes, 'like')} on your track`);
      return own;
    }
    const b = button('', `heart${t.likedByMe ? ' on' : ''}`, {
      'aria-pressed': String(t.likedByMe),
      'aria-label': `${t.likedByMe ? 'Unlike' : 'Like'} "${t.title}" (${plural(t.likes, 'like')})`,
      'data-act': 'like', 'data-id': t.id,
    });
    b.append(heartSvg(), el('span', '', String(t.likes)));
    return b;
  }

  function confirmBox(id, kind, t) {
    const box = el('div', 'confirm');
    const text = {
      publish: `Everyone will be able to see and play this track: its title, chords, tempo and style, and your name (${tracks.state.me?.displayName ?? 'your name'}). You can make it private again at any time.`,
      delete: `Delete "${t.title}" for good? Its likes go with it.`,
      overwrite: `Replace the saved setup in "${t.title}" with what is loaded now?`,
    }[kind];
    box.append(el('p', '', text));
    const row = el('div', 'confirm-actions');
    row.append(
      button({ publish: 'Publish', delete: 'Delete', overwrite: 'Replace' }[kind], `chip confirm-yes${kind === 'delete' ? ' danger' : ''}`, { 'data-act': `confirm-${kind}`, 'data-id': id }),
      button('Cancel', 'chip', { 'data-act': 'cancel', 'data-id': id }),
    );
    box.append(row);
    return box;
  }

  // ---- messages, loaded track, account ---------------------------------------------------

  function renderMessages(state) {
    const t = state.tracks;
    const box = $('tracks-msg');
    if (t.flash) { box.textContent = t.flash.text; box.className = `msg tracks-msg${t.flash.kind === 'error' ? ' bad' : ''}`; return; }
    if (t.status === 'offline') { box.textContent = "You're offline, so tracks can only be saved on this device for now."; box.className = 'msg tracks-msg'; return; }
    box.textContent = '';
    box.className = 'msg tracks-msg';
  }

  function renderLoaded(state) {
    const a = state.tracks.active;
    const line = $('loaded-line'); const now = $('loaded-now');
    if (!a) { line.hidden = true; now.hidden = true; return; }
    const edited = setupSignature(buildTrackData(state)) !== a.signature;
    const text = `Loaded: “${a.title}”${a.isMine ? '' : ` by ${a.author}`} · ${plural(a.likes, 'like')}${edited ? ' · edited since loading' : ''}`;
    line.textContent = text; line.hidden = false;
    now.textContent = text; now.hidden = false;
  }

  function renderAccount(t) {
    const box = $('account');
    box.replaceChildren();
    if (t.status === 'offline') return;
    const row = el('p', 'account-line');
    if (t.me) {
      row.append('You are ', el('strong', '', t.me.displayName), ' ');
      const links = el('span', 'account-links');
      links.append(
        button('Change name', 'link', { 'data-act': 'account', 'data-panel': 'rename' }),
        button('Recovery code', 'link', { 'data-act': 'account', 'data-panel': 'recovery' }),
        button('Use another code', 'link', { 'data-act': 'account', 'data-panel': 'recover' }),
        button('Delete my data', 'link', { 'data-act': 'account', 'data-panel': 'delete' }),
      );
      row.append(links);
    } else {
      row.append('Your tracks stay in this browser once you save one. ');
      row.append(button('Use a recovery code', 'link', { 'data-act': 'account', 'data-panel': 'recover' }));
    }
    box.append(row);

    const panel = ui.accountPanel;
    if (!panel) return;
    const inline = el('div', 'inline-panel');
    if (panel === 'rename' && t.me) {
      const input = el('input'); input.type = 'text'; input.id = 'rename-input'; input.name = 'display-name'; input.maxLength = 24; input.value = t.me.displayName; input.setAttribute('aria-label', 'Your display name');
      inline.append(el('p', '', 'This name appears on tracks you publish.'), input,
        button('Save name', 'chip', { 'data-act': 'do-rename' }), button('Cancel', 'chip', { 'data-act': 'account-close' }));
    } else if (panel === 'recovery') {
      if (t.recovery) {
        inline.append(el('p', '', 'Your recovery code opens your library in another browser or after clearing cookies. Keep it private: anyone with it can use your library.'));
        inline.append(el('code', 'code', t.recovery));
        inline.append(button('Copy', 'chip', { 'data-act': 'copy-code' }), button('Hide', 'chip', { 'data-act': 'account-close' }));
      } else {
        inline.append(el('p', '', 'Show the code that lets you open this library somewhere else.'), button('Show my code', 'chip', { 'data-act': 'show-code' }), button('Cancel', 'chip', { 'data-act': 'account-close' }));
      }
    } else if (panel === 'recover') {
      const input = el('input'); input.type = 'text'; input.id = 'recover-input'; input.name = 'recovery-code'; input.placeholder = 'XXXX-XXXX-XXXX-…'; input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('aria-label', 'Recovery code');
      inline.append(el('p', '', t.me ? 'Switch this browser to another library. Tracks in this one stay with its own recovery code.' : 'Enter the recovery code from your other browser.'), input,
        button('Use code', 'chip', { 'data-act': 'do-recover' }), button('Cancel', 'chip', { 'data-act': 'account-close' }));
    } else if (panel === 'delete' && t.me) {
      inline.append(el('p', '', 'This deletes your name, all your tracks (including published ones) and your likes. It cannot be undone.'),
        button('Delete everything', 'chip danger', { 'data-act': 'do-delete-account' }), button('Cancel', 'chip', { 'data-act': 'account-close' }));
    }
    box.append(inline);
  }

  function renderCookieNote(t) {
    const note = $('cookie-note');
    note.hidden = !t.cookieNote;
    if (!t.cookieNote) return;
    note.replaceChildren(
      el('p', '', 'We keep one small cookie so your tracks stay yours. It holds a random ID and nothing else, and it is only used for saving, publishing and liking. You can delete everything above at any time.'),
      button('Got it', 'chip', { 'data-act': 'dismiss-note' }),
    );
  }

  // ---- my tracks -------------------------------------------------------------------------

  function renderSaveButton() {
    const t = tracks.state;
    const name = $('save-name').value.trim().toLocaleLowerCase();
    const exists = t.mine.some((x) => x.title.toLocaleLowerCase() === name);
    $('save-btn').textContent = exists ? 'Update' : 'Save';
    $('save-btn').classList.toggle('is-update', exists);
  }

  function myRow(t, active) {
    const li = el('li', `track${active?.id === t.id ? ' is-active' : ''}`);
    const busy = Boolean(tracks.state.busy[t.id]);
    const open = button('', 'track-open', { 'data-act': 'load', 'data-id': t.id, title: 'Load this track' });
    const head = el('span', 'track-head');
    head.append(el('span', 'track-title', t.title), stateChip(t));
    open.append(head, el('span', 'track-meta', metaLine(t)), el('span', 'track-chords', chordPreview(t)));
    li.append(open);

    const actions = el('div', 'track-actions');
    if (t.visibility !== 'hidden') {
      actions.append(button('Replace with current setup', 'link', { 'data-act': 'ask-overwrite', 'data-id': t.id }));
      if (t.visibility === 'published') {
        actions.append(button('Make private', 'link', { 'data-act': 'unpublish', 'data-id': t.id }), button('Copy link', 'link', { 'data-act': 'share', 'data-id': t.id }));
      } else actions.append(button('Publish…', 'link', { 'data-act': 'ask-publish', 'data-id': t.id }));
    }
    actions.append(button('Delete', 'link danger', { 'data-act': 'ask-delete', 'data-id': t.id }));
    for (const b of actions.querySelectorAll('button')) b.disabled = busy;
    li.append(actions);
    if (ui.confirm?.id === t.id && ['publish', 'delete', 'overwrite'].includes(ui.confirm.kind)) li.append(confirmBox(t.id, ui.confirm.kind, t));
    return li;
  }

  function renderMine(state) {
    const t = state.tracks;
    const list = $('my-list');
    list.replaceChildren();
    if (t.status === 'offline') return;
    if (!t.mine.length) {
      const empty = el('li', 'track-empty');
      empty.textContent = t.mineLoaded || !t.me
        ? 'Nothing saved yet. Name the track above and press Save to keep everything: chords, key, time signature, tempo, style, swing, sounds and levels.'
        : 'Loading your tracks…';
      list.append(empty);
      return;
    }
    for (const track of t.mine) list.append(myRow(track, t.active));
  }

  // ---- the older, browser-only list ------------------------------------------------------

  function renderLocal(state) {
    const box = $('local-box');
    const saved = state.saved ?? [];
    box.hidden = saved.length === 0;
    box.replaceChildren();
    if (!saved.length) return;
    const online = state.tracks.status === 'online';
    box.append(el('h3', '', `On this device (${saved.length})`));
    box.append(el('p', 'msg', online
      ? 'Saved here by an earlier version, or while you were offline. Move them into your library to keep them safe.'
      : 'Saved on this device because there is no connection. They can be moved into your library once you are back online.'));
    if (online) box.append(button(saved.length === 1 ? 'Move it to my library' : `Move all ${saved.length} to my library`, 'chip', { 'data-act': 'import-local' }));
    const ul = el('ul', 'track-list');
    for (const item of saved) {
      const li = el('li', 'track');
      const open = button('', 'track-open', { 'data-act': 'local-load', 'data-id': item.id });
      open.append(el('span', 'track-title', item.name), el('span', 'track-meta', describeSaved(item)));
      li.append(open);
      const actions = el('div', 'track-actions');
      actions.append(button('Delete', 'link danger', { 'data-act': 'local-delete', 'data-id': item.id }));
      li.append(actions);
      ul.append(li);
    }
    box.append(ul);
  }

  // ---- browse ----------------------------------------------------------------------------

  function browseRow(t) {
    const li = el('li', `track${tracks.state.active?.id === t.id ? ' is-active' : ''}`);
    const busy = Boolean(tracks.state.busy[t.id]);
    const main = el('div', 'track-main');
    const open = button('', 'track-open', { 'data-act': 'open-browse', 'data-id': t.id, title: 'Load this track into the player' });
    open.append(
      el('span', 'track-title', t.title),
      el('span', 'track-by', `by ${t.author}${t.isMine ? ' (you)' : ''}`),
      el('span', 'track-meta', metaLine(t)),
      el('span', 'track-chords', chordPreview(t)),
    );
    if (t.description) open.append(el('span', 'track-desc', t.description));
    main.append(open, likeControl(t));
    li.append(main);
    const actions = el('div', 'track-actions');
    actions.append(button('Save a copy', 'link', { 'data-act': 'copy', 'data-id': t.id }), button('Copy link', 'link', { 'data-act': 'share', 'data-id': t.id }));
    if (!t.isMine) actions.append(button('Report', 'link', { 'data-act': 'ask-report', 'data-id': t.id }));
    for (const b of actions.querySelectorAll('button')) b.disabled = busy;
    li.append(actions);
    if (ui.confirm?.id === t.id && ui.confirm.kind === 'report') {
      const box = el('div', 'confirm');
      const input = el('input'); input.type = 'text'; input.className = 'report-reason'; input.name = 'report-reason'; input.maxLength = 300; input.placeholder = 'What is wrong? (optional)'; input.setAttribute('aria-label', 'Reason for the report');
      box.append(el('p', '', 'Report this track to the moderators?'), input,
        button('Send report', 'chip confirm-yes', { 'data-act': 'confirm-report', 'data-id': t.id }), button('Cancel', 'chip', { 'data-act': 'cancel', 'data-id': t.id }));
      li.append(box);
    }
    return li;
  }

  function renderBrowse(state) {
    const b = state.tracks.browse;
    const list = $('browse-list');
    list.replaceChildren();
    const count = $('browse-count');
    count.className = 'msg';
    if (state.tracks.status === 'offline') { count.textContent = 'Browsing needs a connection to the server.'; $('browse-more').hidden = true; return; }
    if (b.error) {
      count.className = 'msg bad';
      count.textContent = b.error;
      const retry = button('Try again', 'link', { 'data-act': 'retry-search' });
      count.append(' ', retry);
    } else if (b.loading && !b.items.length) count.textContent = 'Searching…';
    else if (b.loaded) {
      const q = b.params.q.trim();
      count.textContent = b.total === 0
        ? `No tracks match${q ? ` "${q}"` : ''}. Try fewer filters, or search for a chord such as Dm7.`
        : `${plural(b.total, 'track')}${q ? ` matching "${q}"` : ''}`;
    } else count.textContent = '';
    for (const t of b.items) list.append(browseRow(t));
    $('browse-more').hidden = !(b.items.length < b.total);
    $('browse-more').disabled = b.loading;
    $('browse-more').textContent = b.loading ? 'Loading…' : `Show more (${b.total - b.items.length} left)`;
  }

  // ---- render ----------------------------------------------------------------------------

  function render(state) {
    const t = state.tracks;
    if (!t) return;
    const tab = t.tab;
    for (const [name, node] of Object.entries(tabs)) { node.setAttribute('aria-selected', String(name === tab)); node.tabIndex = name === tab ? 0 : -1; }
    $('panel-mine').hidden = tab !== 'mine';
    $('panel-browse').hidden = tab !== 'browse';

    // only rebuild a region when something it shows has changed
    const edited = t.active ? setupSignature(buildTrackData(state)) !== t.active.signature : false;
    const sigs = {
      messages: [t.flash?.id, t.status],
      loaded: [t.active, edited, t.active && state.song.tempo],
      account: [t.me, t.status, t.recovery, ui.accountPanel],
      note: [t.cookieNote],
      mine: [t.mine, t.active, t.busy, t.mineLoaded, t.status, t.me?.displayName, ui.confirm],
      browse: [t.browse, t.busy, t.active, t.status, ui.confirm],
      local: [state.saved, t.status],
    };
    for (const [name, fn] of Object.entries({
      messages: () => renderMessages(state), loaded: () => renderLoaded(state), account: () => renderAccount(t),
      note: () => renderCookieNote(t), mine: () => renderMine(state), browse: () => renderBrowse(state), local: () => renderLocal(state),
    })) {
      const s = JSON.stringify(sigs[name]);
      if (last[name] !== s) { last[name] = s; fn(); }
    }
    renderSaveButton();
  }

  /** Force the regions that depend on local UI state to redraw. */
  const poke = () => { last.account = null; last.mine = null; last.browse = null; render(store.get()); };

  // ---- clicks (one listener for the whole panel) -------------------------------------------

  const byId = (id) => tracks.state.mine.find((t) => t.id === id) ?? tracks.state.browse.items.find((t) => t.id === id);

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  $('tracks').addEventListener('click', async (e) => {
    const target = e.target.closest('[data-act]');
    if (!target) return;
    const { act, id, panel } = target.dataset;
    switch (act) {
      case 'load': { const t = byId(id); if (t) tracks.open(t.data ? t : id, 'mine'); break; }
      case 'open-browse': tracks.open(id, 'browse'); break;
      case 'like': tracks.toggleLike(id); break;
      case 'copy': tracks.copy(id); break;
      case 'unpublish': tracks.setPublished(id, false); break;
      case 'share': {
        const ok = await copyText(tracks.shareUrl(id, location.origin));
        tracks.notify(ok ? 'Link copied. Anyone with it can open this track.' : `Copy this link: ${tracks.shareUrl(id, location.origin)}`, ok ? 'ok' : 'error');
        break;
      }
      case 'ask-publish': case 'ask-delete': case 'ask-overwrite': case 'ask-report':
        ui.confirm = { id, kind: act.slice(4) }; poke(); break;
      case 'cancel': ui.confirm = null; poke(); break;
      case 'confirm-publish': ui.confirm = null; poke(); tracks.setPublished(id, true); break;
      case 'confirm-delete': ui.confirm = null; poke(); tracks.remove(id); break;
      case 'confirm-overwrite': ui.confirm = null; poke(); tracks.updateFromCurrent(id); break;
      case 'confirm-report': {
        const reason = target.closest('li')?.querySelector('.report-reason')?.value ?? '';
        ui.confirm = null; poke(); tracks.report(id, reason); break;
      }
      case 'retry-search': tracks.search({}); break;
      case 'dismiss-note': tracks.dismissCookieNote(); break;
      case 'account': ui.accountPanel = ui.accountPanel === panel ? null : panel; if (panel !== 'recovery') tracks.hideRecovery(); poke(); $('rename-input')?.focus(); $('recover-input')?.focus(); break;
      case 'account-close': ui.accountPanel = null; tracks.hideRecovery(); poke(); break;
      case 'show-code': tracks.showRecovery(); break;
      case 'copy-code': { const ok = await copyText(tracks.state.recovery ?? ''); tracks.notify(ok ? 'Recovery code copied.' : 'Select the code and copy it by hand.', ok ? 'ok' : 'error'); break; }
      case 'do-rename': { if (await tracks.rename($('rename-input').value)) { ui.accountPanel = null; poke(); } break; }
      case 'do-recover': { if (await tracks.recover($('recover-input').value)) { ui.accountPanel = null; poke(); } break; }
      case 'do-delete-account': { if (await tracks.deleteAccount()) { ui.accountPanel = null; poke(); } break; }
      case 'import-local': tracks.importLocal(); break;
      case 'local-load': { const item = player.loadSaved(id); if (item) { $('save-name').value = item.name; tracks.notify(`Loaded "${item.name}" from this device.`); } break; }
      case 'local-delete': player.deleteSaved(id); break;
      default: break;
    }
  });

  // Enter in the inline fields acts like their button; Escape closes the open inline panel or confirmation
  $('tracks').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'rename-input') { e.preventDefault(); $('tracks').querySelector('[data-act="do-rename"]')?.click(); }
    if (e.key === 'Enter' && e.target.id === 'recover-input') { e.preventDefault(); $('tracks').querySelector('[data-act="do-recover"]')?.click(); }
    if (e.key === 'Escape' && (ui.confirm || ui.accountPanel)) { ui.confirm = null; ui.accountPanel = null; tracks.hideRecovery(); poke(); }
  });

  store.subscribe(render);
  render(store.get());
}
