// The Tracks panel: renders the controller's state and forwards clicks to it. No track logic lives here.
//
// Each region (account, my tracks, browse, messages, legacy list) re-renders only when its own inputs change, so typing
// in a search box or a rename field is never interrupted by a beat event or an unrelated update.

import { METER_IDS, getMeter } from '../theory/meter.js';
import { MAJOR_KEYS, MINOR_KEYS } from '../theory/keys.js';
import { listStyles, getStyle } from '../styles/index.js';
import { avatarUrl } from './api.js';
import { photoToAvatar } from './avatar.js';
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

/** A plain link, not a fetch: signing in with eardle sends the whole page to eardle and back. */
function eardleLink() {
  const a = el('a', 'link', 'Sign in with eardle');
  a.href = '/api/auth/eardle/start';
  a.title = 'Keep your library under your eardle account, on every device';
  return a;
}

/** "Continue with Google" (or "Connect Google"): a plain link, because it sends the whole page to Google and back. */
function googleLink(label = 'Continue with Google', title = 'Opens Google to sign in. The same Google account opens your library on every device.') {
  const a = el('a', 'google-btn');
  a.href = '/api/auth/google/start';
  a.title = title;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('aria-hidden', 'true');
  for (const [fill, d] of [
    ['#4285F4', 'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'],
    ['#34A853', 'M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'],
    ['#FBBC05', 'M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z'],
    ['#EA4335', 'M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'],
  ]) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('fill', fill); p.setAttribute('d', d); svg.append(p);
  }
  a.append(svg, label);
  return a;
}

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
 * A round photo, or the person's first letter on a colour taken from their name when there is no photo (or it fails to load).
 * The photo is drawn over the letter, so a slow or broken image still leaves something sensible.
 */
function avatarEl(id, version, name, size = 40) {
  const span = el('span', 'avatar');
  span.style.setProperty('--sz', `${size}px`);
  let hue = 0;
  for (const ch of String(name)) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  span.style.setProperty('--hue', String(hue));
  span.append(el('span', 'avatar-initial', ([...String(name || '?').trim()][0] ?? '?').toUpperCase()));
  if (version != null && id) {
    const img = el('img');
    img.alt = '';
    img.width = size; img.height = size;
    img.loading = 'lazy'; img.decoding = 'async';
    img.src = avatarUrl(id, version);
    img.addEventListener('error', () => img.remove());
    span.append(img);
  }
  return span;
}

/**
 * @param {{store: ReturnType<typeof import('./state.js').createStore>, tracks: ReturnType<typeof import('./tracks.js').createTracksController>,
 *          player: any, sidebar?: ReturnType<typeof import('./sidebar.js').mountSidebar>}} deps
 */
export function mountTracksUI({ store, tracks, player, sidebar = null }) {
  // Local UI state: which inline panel or confirmation is open. Not part of the app state on purpose.
  const ui = { accountPanel: null, confirm: null /* {id, kind} */, authMode: 'signup' /* 'signup' | 'login' */ };
  const last = {};
  let debounce = null;

  // ---- static setup ----------------------------------------------------------------------

  const option = (label, value) => { const o = el('option', '', label); o.value = value; return o; };
  const fStyle = $('f-style'); const fMeter = $('f-meter'); const fKey = $('f-key'); const fSort = $('f-sort');
  fStyle.append(option('Any', ''), ...listStyles().map((s) => option(s.name, s.id)));
  fMeter.append(option('Any', ''), ...METER_IDS.map((id) => option(id, id)));
  fKey.append(option('Any', ''), ...[...MAJOR_KEYS, ...MINOR_KEYS].map((k) => option(prettyKey(k), k)));
  fSort.append(option('Best match', ''), option('Most liked', 'likes'), option('Newest', 'new'));

  const tabs = { mine: $('tab-mine'), presets: $('tab-presets'), browse: $('tab-browse'), account: $('tab-account') };
  for (const [name, tab] of Object.entries(tabs)) tab.addEventListener('click', () => tracks.setTab(name));
  $('tracks').querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const names = Object.keys(tabs);
    const at = names.indexOf(tracks.state.tab);
    const next = names[(at + (e.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length];
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

  // the Style/Time/Key/Tempo/Sort fields live behind a "Filters" button, the same popup interaction as the
  // starting-key and quick-progressions pickers (src/app/ui.js, src/app/quick-ui.js): most visits to Browse are
  // just a search, so the fields people reach for occasionally stay out of the way until asked for.
  const filterpick = $('filterpick'); const filterbtn = $('filterbtn'); const filterpop = $('filterpop');
  const setFilterPop = (open) => {
    filterpop.hidden = !open;
    filterbtn.setAttribute('aria-expanded', String(open));
    filterpick.classList.toggle('open', open);
  };
  filterbtn.addEventListener('click', () => setFilterPop(filterpop.hidden));
  document.addEventListener('pointerdown', (e) => { if (!filterpop.hidden && !filterpick.contains(e.target)) setFilterPop(false); });
  filterpick.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !filterpop.hidden) { setFilterPop(false); filterbtn.focus(); e.stopPropagation(); }
  });
  $('filters-clear').addEventListener('click', () => {
    fStyle.value = ''; fMeter.value = ''; fKey.value = ''; fSort.value = ''; $('f-bpm-min').value = ''; $('f-bpm-max').value = '';
    runSearch();
  });

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
      delete: `Delete "${t.title}" for good? Its likes go with it.`,
      overwrite: `Replace the saved setup in "${t.title}" with what is loaded now?`,
    }[kind];
    box.append(el('p', '', text));
    const row = el('div', 'confirm-actions');
    row.append(
      button({ delete: 'Delete', overwrite: 'Replace' }[kind], `chip confirm-yes${kind === 'delete' ? ' danger' : ''}`, { 'data-act': `confirm-${kind}`, 'data-id': id }),
      button('Cancel', 'chip', { 'data-act': 'cancel', 'data-id': id }),
    );
    box.append(row);
    return box;
  }

  // ---- messages, loaded track, account ---------------------------------------------------

  function renderMessages(state) {
    const t = state.tracks;
    const box = $('tracks-msg');
    const hero = $('hero-flash');
    if (t.flash) {
      box.textContent = t.flash.text;
      box.className = `msg tracks-msg${t.flash.kind === 'error' ? ' bad' : ''}`;
      // with the sidebar closed nobody would see it, so say it under the player as well
      hero.hidden = Boolean(sidebar?.isOpen);
      hero.textContent = t.flash.text;
      hero.classList.toggle('bad', t.flash.kind === 'error');
      return;
    }
    hero.hidden = true;
    hero.textContent = '';
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

  /** A labelled text or password field for the login forms. `kind` 'username' is text; the others are passwords. */
  function fieldInput(label, kind, autocomplete) {
    const wrap = el('label', 'pfield'); wrap.append(el('span', '', label));
    const input = el('input');
    input.type = kind === 'username' ? 'text' : 'password';
    input.name = kind; input.id = `f-${kind}`; input.autocomplete = autocomplete; input.required = true;
    if (kind === 'username') { input.maxLength = 20; input.spellcheck = false; input.autocapitalize = 'none'; input.setAttribute('autocorrect', 'off'); }
    else input.maxLength = 128;
    wrap.append(input);
    return wrap;
  }

  /** The little "you" chip in the Jam Hub header: tap it to open My account. */
  function renderHubMe(t) {
    const chip = $('hub-me');
    chip.hidden = !t.me;
    chip.replaceChildren();
    if (!t.me) return;
    chip.append(avatarEl(t.me.id, t.me.avatar, t.me.displayName, 24), el('span', 'hub-me-name', t.me.displayName));
    chip.setAttribute('aria-label', `My account: ${t.me.displayName}`);
  }

  function renderAccount(t) {
    const box = $('acct');
    box.replaceChildren();
    if (t.status === 'offline') { box.append(el('p', 'msg', 'My account needs a connection to the server.')); return; }
    const me = t.me;
    const card = (title, ...kids) => { const c = el('section', 'acct-card'); if (title) c.append(el('h3', '', title)); c.append(...kids); box.append(c); return c; };
    const inlinePanel = (name) => (ui.accountPanel === name ? el('div', 'inline-panel') : null);

    // ---- profile ----
    if (me) {
      const head = el('div', 'profile-head');
      head.append(avatarEl(me.id, me.avatar, me.displayName, 88));
      const side = el('div', 'profile-side');
      const photoBtns = el('div', 'profile-btns');
      photoBtns.append(button(me.avatar != null ? 'Change photo' : 'Add a photo', 'chip', { 'data-act': 'pick-photo' }));
      if (me.avatar != null) photoBtns.append(button('Remove', 'link', { 'data-act': 'remove-photo' }));
      const file = el('input'); file.type = 'file'; file.id = 'avatar-file'; file.accept = 'image/*'; file.hidden = true;
      side.append(photoBtns, el('p', 'hint', 'Cropped from the middle and shrunk here before it is sent. Shown next to your published tracks.'), file);
      head.append(side);

      const nameLabel = el('label', 'pfield'); nameLabel.append(el('span', '', 'Name'));
      const name = el('input'); name.type = 'text'; name.id = 'profile-name'; name.name = 'display-name'; name.maxLength = 24; name.value = me.displayName; name.autocomplete = 'nickname'; name.spellcheck = false;
      nameLabel.append(name);
      const bioLabel = el('label', 'pfield'); bioLabel.append(el('span', '', 'About you'));
      const bio = el('textarea'); bio.id = 'profile-bio'; bio.name = 'bio'; bio.rows = 4; bio.maxLength = 280; bio.value = me.bio ?? '';
      bio.placeholder = 'What do you play? What are you working on?';
      const count = el('span', 'pcount', `${[...bio.value].length}/280`); count.id = 'bio-count';
      bioLabel.append(bio, count);
      const actions = el('div', 'profile-btns');
      actions.append(button('Save profile', 'chip primary', { 'data-act': 'save-profile' }), button('See my public profile', 'link', { 'data-act': 'open-profile', 'data-id': me.id }));
      card('Your profile', head, nameLabel, bioLabel, el('p', 'hint', 'Your name, photo and bio are public once you publish a track.'), actions);
    }

    // ---- logging in and out ----
    const hasLogin = Boolean(me?.username || me?.eardle || me?.google);
    if (hasLogin) {
      const login = card('Your login');
      if (me.username) login.append(el('p', '', `Logged in as ${me.username}. Only you see this name; others see your display name.${me.google ? ' Google is connected too.' : ''}`));
      else if (me.google) login.append(el('p', '', 'You are signed in with Google, so your library follows you to every device.'));
      else login.append(el('p', '', 'You are signed in with your eardle account, so your library follows you to every device.'));
      const row = el('div', 'profile-btns');
      row.append(button('Log out', 'chip', { 'data-act': 'sign-out' }));
      if (me.username) row.append(button('Change password', 'link', { 'data-act': 'account', 'data-panel': 'password' }));
      row.append(button('Log out everywhere', 'link', { 'data-act': 'account', 'data-panel': 'signout-everywhere' }));
      login.append(row);
      if (t.features.google && !me.google) {
        login.append(el('p', 'hint', 'Connect your Google account to also open this library with one tap, on any device.'));
        const connect = el('div', 'auth-more auth-connect');
        connect.append(googleLink('Connect Google', 'Opens Google. Afterwards the same Google account opens this library.'));
        login.append(connect);
      }
      const inline = inlinePanel('password') ?? inlinePanel('signout-everywhere');
      if (inline && ui.accountPanel === 'password' && me.username) {
        const form = el('form', 'auth-form'); form.id = 'password-form'; form.autocomplete = 'on';
        form.append(fieldInput('Current password', 'current-password', 'current-password'), fieldInput('New password', 'new-password', 'new-password'),
          el('p', 'hint', 'Other devices are logged out when you change it. There is no password reset, so choose one you will remember.'));
        const actions = el('div', 'profile-btns');
        const save = button('Change password', 'chip primary'); save.type = 'submit';
        actions.append(save, button('Cancel', 'chip', { 'data-act': 'account-close' }));
        form.append(actions);
        inline.append(form);
        login.append(inline);
      } else if (inline && ui.accountPanel === 'signout-everywhere') {
        inline.append(el('p', '', 'Logs you out on every device, including this one, in case one was lost. Your library stays with your account.'),
          button('Log out everywhere', 'chip danger', { 'data-act': 'do-signout-everywhere' }), button('Cancel', 'chip', { 'data-act': 'account-close' }));
        login.append(inline);
      }
    } else {
      // no login yet: a guest, or a library that so far only lives in this browser
      const signup = ui.authMode === 'signup';
      const auth = card(me ? 'Add a login' : 'Log in or create an account');
      auth.append(el('p', '', me
        ? 'Your tracks only live in this browser right now. Add a username and password to open them on any device.'
        : 'Create an account to add a photo and a bio and to keep your tracks and presets. Already have one? Log in.'));
      const mode = el('div', 'seg authmode');
      mode.setAttribute('role', 'radiogroup'); mode.setAttribute('aria-label', 'Create an account or log in');
      for (const [v, label] of [['signup', me ? 'Add a login' : 'Create account'], ['login', 'Log in']]) {
        const b = button(label, '', { role: 'radio', 'aria-checked': String(ui.authMode === v), 'data-act': 'auth-mode', 'data-panel': v });
        mode.append(b);
      }
      auth.append(mode);
      const form = el('form', 'auth-form'); form.id = 'auth-form'; form.autocomplete = 'on';
      form.append(fieldInput('Username', 'username', 'username'), fieldInput('Password', 'password', signup ? 'new-password' : 'current-password'));
      form.append(el('p', 'hint', signup
        ? 'No email needed. A username is 3–20 letters, numbers, dots, dashes or underscores, and a password at least 8 characters. There is no password reset, so choose one you will remember.'
        : me ? 'Logging in switches this browser to that account; tracks saved here without a login join it.' : ''));
      const go = button(signup ? (me ? 'Add login' : 'Create account') : 'Log in', 'chip primary'); go.type = 'submit';
      form.append(go);
      auth.append(form);
      if (t.features.google || t.features.eardle) {
        const more = el('div', 'auth-more');
        more.append(el('span', 'auth-or', 'or'));
        if (t.features.google) more.append(googleLink());
        if (t.features.eardle) { const a = eardleLink(); a.className = 'chip'; a.textContent = 'Sign in with eardle'; more.append(a); }
        auth.append(more);
      }
    }

    // ---- danger zone ----
    if (me) {
      const danger = card('Delete my data');
      danger.classList.add('acct-danger');
      danger.append(el('p', '', 'Removes your name, photo, bio, all your tracks (including published ones) and your likes. It cannot be undone.'));
      if (ui.accountPanel === 'delete') {
        const row = el('div', 'profile-btns');
        row.append(button('Delete everything', 'chip danger', { 'data-act': 'do-delete-account' }), button('Cancel', 'chip', { 'data-act': 'account-close' }));
        danger.append(row);
      } else danger.append(button('Delete my data…', 'link danger', { 'data-act': 'account', 'data-panel': 'delete' }));
    }
  }

  function renderCookieNote(t) {
    const note = $('cookie-note');
    note.hidden = !t.cookieNote;
    if (!t.cookieNote) return;
    note.replaceChildren(
      el('p', '', 'We keep one small cookie so your tracks stay yours. It holds a random ID and nothing else, and it is only used for saving, publishing and liking. You can delete everything under My account at any time.'),
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
      } else actions.append(button('Publish', 'link', { 'data-act': 'publish', 'data-id': t.id }));
    }
    actions.append(button('Delete', 'link danger', { 'data-act': 'ask-delete', 'data-id': t.id }));
    for (const b of actions.querySelectorAll('button')) b.disabled = busy;
    li.append(actions);
    if (ui.confirm?.id === t.id && ['delete', 'overwrite'].includes(ui.confirm.kind)) li.append(confirmBox(t.id, ui.confirm.kind, t));
    return li;
  }

  function renderMine(state) {
    const t = state.tracks;
    const list = $('my-list');
    list.replaceChildren();
    const published = t.mine.filter((x) => x.visibility === 'published').length;
    $('sum-mine').textContent = t.status === 'offline' || !t.mine.length ? '' : `${t.mine.length}${published ? ` · ${published} published` : ''}`;
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
    $('sec-local').hidden = saved.length === 0;
    $('sum-local').textContent = saved.length ? String(saved.length) : '';
    box.replaceChildren();
    if (!saved.length) return;
    const online = state.tracks.status === 'online';
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

  function browseRow(t, { showAuthor = true } = {}) {
    const li = el('li', `track${tracks.state.active?.id === t.id ? ' is-active' : ''}`);
    const busy = Boolean(tracks.state.busy[t.id]);
    const main = el('div', 'track-main');
    const open = button('', 'track-open', { 'data-act': 'open-browse', 'data-id': t.id, title: 'Load this track into the player' });
    open.append(
      el('span', 'track-title', t.title),
      el('span', 'track-meta', metaLine(t)),
      el('span', 'track-chords', chordPreview(t)),
    );
    if (t.description) open.append(el('span', 'track-desc', t.description));
    main.append(open, likeControl(t));
    li.append(main);
    if (showAuthor) {
      const by = button('', 'author', { 'data-act': 'open-profile', 'data-id': t.authorId, title: `See ${t.author}'s profile` });
      by.append(avatarEl(t.authorId, t.authorAvatar, t.author, 24), el('span', '', `${t.author}${t.isMine ? ' (you)' : ''}`));
      li.append(by);
    }
    const actions = el('div', 'track-actions');
    actions.append(button('Save a copy', 'link', { 'data-act': 'copy', 'data-id': t.id }), button('Copy link', 'link', { 'data-act': 'share', 'data-id': t.id }));
    for (const b of actions.querySelectorAll('button')) b.disabled = busy;
    li.append(actions);
    return li;
  }

  /** An open profile replaces the search box and results; closing it brings them back. */
  function applyProfileMode(open) {
    for (const id of ['browse-form', 'browse-count', 'browse-list']) $(id).hidden = open;
    if (open) $('browse-more').hidden = true;
    $('profile-view').hidden = !open;
  }

  function renderProfile(state) {
    const t = state.tracks;
    const p = t.profile;
    const view = $('profile-view');
    view.replaceChildren();
    applyProfileMode(Boolean(p));
    if (!p) return;
    view.append(button('← Back to tracks', 'link', { 'data-act': 'close-profile' }));
    if (p.status === 'loading') { view.append(el('p', 'msg', 'Loading…')); return; }
    if (p.status === 'error') { view.append(el('p', 'msg bad', p.error)); return; }
    const { profile, tracks: list } = p.data;
    const head = el('div', 'profile-head profile-public');
    head.append(avatarEl(profile.id, profile.avatar, profile.name, 72));
    const who = el('div', 'profile-who');
    const joined = new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    who.append(el('h3', '', `${profile.name}${t.me?.id === profile.id ? ' (you)' : ''}`),
      el('p', 'track-meta', `${plural(profile.published, 'published track')} · ${plural(profile.likes, 'like')} · here since ${joined}`));
    head.append(who);
    view.append(head);
    if (profile.bio) view.append(el('p', 'profile-bio', profile.bio));
    if (t.me?.id === profile.id) view.append(button('Edit my profile', 'chip', { 'data-act': 'go-account' }));
    view.append(el('h3', 'profile-tracks-title', 'Published tracks'));
    const ul = el('ul', 'track-list');
    if (!list.length) ul.append(el('li', 'track-empty', 'No published tracks.'));
    for (const track of list) ul.append(browseRow(track, { showAuthor: false }));
    view.append(ul);
  }

  function renderBrowse(state) {
    const b = state.tracks.browse;
    const list = $('browse-list');
    list.replaceChildren();
    const active = Object.entries(b.params).filter(([k, v]) => k !== 'sort' && v !== '' && v != null).length;
    $('filter-count').textContent = String(active);
    $('filter-count').hidden = !active;
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
      const filtered = q || Object.entries(b.params).some(([k, v]) => k !== 'q' && k !== 'sort' && v !== '' && v != null);
      if (b.total > 0) count.textContent = `${plural(b.total, 'track')}${q ? ` matching "${q}"` : ''}`;
      else if (filtered) count.textContent = `No tracks match${q ? ` "${q}"` : ''}. Try fewer filters, or search for a chord such as Dm7.`;
      else count.textContent = 'Nothing has been published yet. Save a track in My tracks and publish it to be the first.';
    } else count.textContent = '';
    for (const t of b.items) list.append(browseRow(t));
    $('browse-more').hidden = !(b.items.length < b.total);
    $('browse-more').disabled = b.loading;
    $('browse-more').textContent = b.loading ? 'Loading…' : `Show more (${b.total - b.items.length} left)`;
    if (state.tracks.profile) applyProfileMode(true);
  }

  // ---- render ----------------------------------------------------------------------------

  function render(state) {
    const t = state.tracks;
    if (!t) return;
    const tab = t.tab;
    for (const [name, node] of Object.entries(tabs)) { node.setAttribute('aria-selected', String(name === tab)); node.tabIndex = name === tab ? 0 : -1; }
    $('panel-mine').hidden = tab !== 'mine';
    $('panel-presets').hidden = tab !== 'presets';
    $('panel-browse').hidden = tab !== 'browse';
    $('panel-account').hidden = tab !== 'account';
    $('sec-toggle-all').hidden = tab === 'browse' || tab === 'account'; // neither has collapsible sections

    // only rebuild a region when something it shows has changed
    const edited = t.active ? setupSignature(buildTrackData(state)) !== t.active.signature : false;
    const sigs = {
      messages: [t.flash?.id, t.status, sidebar?.isOpen],
      loaded: [t.active, edited, t.active && state.song.tempo],
      account: [t.me, t.features, t.status, ui.accountPanel, ui.authMode],
      hubme: [t.me],
      profile: [t.profile, t.busy, t.active, t.me?.id, t.status],
      note: [t.cookieNote],
      mine: [t.mine, t.active, t.busy, t.mineLoaded, t.status, t.me?.displayName, ui.confirm],
      browse: [t.browse, t.busy, t.active, t.status, ui.confirm, Boolean(t.profile)],
      local: [state.saved, t.status],
    };
    for (const [name, fn] of Object.entries({
      messages: () => renderMessages(state), loaded: () => renderLoaded(state), account: () => renderAccount(t), hubme: () => renderHubMe(t), profile: () => renderProfile(state),
      note: () => renderCookieNote(t), mine: () => renderMine(state), browse: () => renderBrowse(state), local: () => renderLocal(state),
    })) {
      const s = JSON.stringify(sigs[name]);
      if (last[name] !== s) { last[name] = s; fn(); }
    }
    renderSaveButton();
  }

  /** Force the regions that depend on local UI state to redraw. */
  const poke = () => { last.account = null; last.mine = null; last.browse = null; last.profile = null; render(store.get()); };

  // ---- clicks (one listener for the whole panel) -------------------------------------------

  const byId = (id) => tracks.state.mine.find((t) => t.id === id) ?? tracks.state.browse.items.find((t) => t.id === id) ?? tracks.state.profile?.data?.tracks.find((t) => t.id === id);

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
      case 'load': { const t = byId(id); if (t && await tracks.open(t.data ? t : id, 'mine')) sidebar?.closeIfSheet(); break; }
      case 'open-browse': if (await tracks.open(id, 'browse')) sidebar?.closeIfSheet(); break;
      case 'like': tracks.toggleLike(id); break;
      case 'copy': tracks.copy(id); break;
      case 'unpublish': tracks.setPublished(id, false); break;
      case 'publish': tracks.setPublished(id, true); break;
      case 'share': {
        const ok = await copyText(tracks.shareUrl(id, location.origin));
        tracks.notify(ok ? 'Link copied. Anyone with it can open this track.' : `Copy this link: ${tracks.shareUrl(id, location.origin)}`, ok ? 'ok' : 'error');
        break;
      }
      case 'ask-delete': case 'ask-overwrite':
        ui.confirm = { id, kind: act.slice(4) }; poke(); break;
      case 'cancel': ui.confirm = null; poke(); break;
      case 'confirm-delete': ui.confirm = null; poke(); tracks.remove(id); break;
      case 'confirm-overwrite': ui.confirm = null; poke(); tracks.updateFromCurrent(id); break;
      case 'retry-search': tracks.search({}); break;
      case 'dismiss-note': tracks.dismissCookieNote(); break;
      case 'account': ui.accountPanel = ui.accountPanel === panel ? null : panel; poke(); $('f-current-password')?.focus(); break;
      case 'auth-mode': ui.authMode = panel; poke(); $('f-username')?.focus(); break;
      case 'account-close': ui.accountPanel = null; poke(); break;
      case 'save-profile': await tracks.saveProfile({ displayName: $('profile-name').value, bio: $('profile-bio').value }); break;
      case 'pick-photo': $('avatar-file')?.click(); break;
      case 'remove-photo': tracks.removeAvatar(); break;
      case 'open-profile': tracks.openProfile(id); break;
      case 'close-profile': tracks.closeProfile(); break;
      case 'go-account': tracks.setTab('account'); break;
      case 'sign-out': { if (await tracks.signOut()) { ui.accountPanel = null; poke(); } break; }
      case 'do-signout-everywhere': { if (await tracks.signOutEverywhere()) { ui.accountPanel = null; poke(); } break; }
      case 'do-delete-account': { if (await tracks.deleteAccount()) { ui.accountPanel = null; poke(); } break; }
      case 'import-local': tracks.importLocal(); break;
      case 'local-load': { const item = player.loadSaved(id); if (item) { $('save-name').value = item.name; tracks.notify(`Loaded "${item.name}" from this device.`); } break; }
      case 'local-delete': player.deleteSaved(id); break;
      default: break;
    }
  });

  // Enter in the inline fields acts like their button; Escape closes the open inline panel or confirmation
  $('tracks').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'profile-name') { e.preventDefault(); $('tracks').querySelector('[data-act="save-profile"]')?.click(); }
    if (e.key === 'Escape' && (ui.confirm || ui.accountPanel)) {
      e.preventDefault(); // this Escape closes the open question, not the whole sidebar
      ui.confirm = null; ui.accountPanel = null; poke();
    }
  });

  // the login forms: a real <form>, so Enter works and password managers know what the fields are
  $('tracks').addEventListener('submit', async (e) => {
    const form = e.target.closest('form');
    if (form?.id === 'auth-form') {
      e.preventDefault();
      const u = $('f-username').value; const p = $('f-password').value;
      const ok = ui.authMode === 'signup' ? await tracks.signUp(u, p) : await tracks.logIn(u, p);
      if (ok) { ui.accountPanel = null; poke(); }
    } else if (form?.id === 'password-form') {
      e.preventDefault();
      if (await tracks.changePassword($('f-current-password').value, $('f-new-password').value)) { ui.accountPanel = null; poke(); }
    }
  });

  // the photo: a file picked (or taken, on a phone) is cropped and shrunk here, then sent
  $('tracks').addEventListener('change', async (e) => {
    if (e.target.id !== 'avatar-file') return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { await tracks.setAvatar(await photoToAvatar(file)); } catch (err) { tracks.notify(err.message, 'error'); }
  });
  $('tracks').addEventListener('input', (e) => {
    if (e.target.id === 'profile-bio') $('bio-count').textContent = `${[...e.target.value].length}/280`;
  });
  $('hub-me').addEventListener('click', () => tracks.setTab('account'));

  store.subscribe(render);
  sidebar?.onChange(() => render(store.get()));
  render(store.get());
}
