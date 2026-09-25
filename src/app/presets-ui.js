// Presets, in two places.
//
// The Style panel has the quick row: the three built-in presets for the chosen style (each one also sets its best tempo),
// and a small "My presets" button that opens the sidebar. Everything you save lives in the sidebar's "My presets" tab, like
// tracks do, so the quick row stays short: a form to save the band as it is now, and the list to use, replace or delete.
//
// This file only draws what the controller (presets-controller.js) holds and calls its methods.

import { getStyle } from '../styles/index.js';
import { MAX_NAME, MAX_PRESETS, describePreset, presetSignature, sameName, settingsFromConfig } from './presets.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (label, cls, attrs = {}) => {
  const b = el('button', cls, label);
  b.type = 'button';
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  return b;
};
const $ = (id) => document.getElementById(id);

const SYNC_TEXT = {
  local: 'On this device only. Saving a track creates an account that keeps your presets on all your devices.',
  syncing: 'Syncing to your account…',
  synced: 'Kept on this device and in your account, so they are on your other devices too.',
  offline: 'Offline: they are safe on this device and will sync when you are back online.',
  error: 'Could not sync just now: they are safe on this device.',
};

export function mountPresetsUI({ store, presets, tracks = null, sidebar = null }) {
  const root = $('presets');
  if (!root) return;

  // the band as it is now, worked out only when the configuration changes (the store fires on every beat)
  let cfgRef = null;
  let current = '';
  const isActive = (p) => presetSignature(p.settings) === current;

  const tip = (p) => `${p.blurb} Sets the tempo to ${p.tempo} BPM.`;

  // ---- the quick row in the Style panel ----------------------------------------------------
  const builtinRow = $('preset-builtin');
  const openBtn = $('preset-open');
  openBtn.addEventListener('click', () => {
    sidebar?.open({ moveFocus: true });
    tracks?.setTab('presets');
  });

  function chip(p) {
    const b = button(p.name, 'chip preset', { title: tip(p), 'aria-pressed': String(isActive(p)) });
    b.addEventListener('click', () => presets.apply(p));
    return b;
  }

  // ---- the sidebar tab ---------------------------------------------------------------------
  const form = $('preset-save');
  const nameInput = $('preset-name');
  const saveBtn = $('preset-save-btn');
  const listEl = $('preset-list');
  nameInput.maxLength = MAX_NAME;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = presets.saveCurrent(nameInput.value);
    if (r.ok) nameInput.value = '';
    renderSaveButton();
  });
  nameInput.addEventListener('input', renderSaveButton);

  /** "Save", or "Update" when the name is one you already have (saving under it replaces that preset). */
  function renderSaveButton() {
    const items = store.get().presets?.items ?? [];
    const exists = items.some((p) => sameName(p.name, nameInput.value));
    saveBtn.textContent = exists ? 'Update' : 'Save';
    saveBtn.classList.toggle('is-update', exists);
    saveBtn.disabled = !exists && items.length >= MAX_PRESETS;
    saveBtn.title = saveBtn.disabled ? `You can keep up to ${MAX_PRESETS} presets. Delete one to make room.` : '';
  }

  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const item = (store.get().presets?.items ?? []).find((p) => p.id === b.dataset.id);
    if (!item) return;
    if (b.dataset.act === 'use') presets.apply(item);
    else if (b.dataset.act === 'replace') presets.saveCurrent(item.name);
    else if (b.dataset.act === 'delete') presets.remove(item.id);
  });

  function row(p) {
    const li = el('li', `track${isActive(p) ? ' is-active' : ''}`);
    const open = button('', 'track-open', { 'data-act': 'use', 'data-id': p.id, title: 'Use this preset' });
    open.append(el('span', 'track-title', p.name), el('span', 'track-meta', describePreset(p.settings)));
    li.append(open);
    const actions = el('div', 'track-actions');
    actions.append(
      button('Replace with current settings', 'link', { 'data-act': 'replace', 'data-id': p.id }),
      button('Delete', 'link danger', { 'data-act': 'delete', 'data-id': p.id }),
    );
    li.append(actions);
    return li;
  }

  /** The message under a control: what just happened, with an Undo after a delete. */
  function fillNote(node, note) {
    node.replaceChildren();
    node.classList.toggle('error', note?.kind === 'error');
    if (!note) return;
    node.append(note.text);
    if (note.undo) {
      const u = button('Undo', 'linkbtn');
      u.addEventListener('click', () => presets.undo());
      node.append(' ', u);
    }
  }

  let last = '';
  function render(state, force = false) {
    const { config, presets: p } = state;
    if (!p) return;
    if (config !== cfgRef) { cfgRef = config; current = presetSignature(settingsFromConfig(config)); }
    const style = getStyle(config.style);
    const builtin = presets.builtin(style.id);
    const active = [...builtin, ...p.items].map(isActive);
    const sig = JSON.stringify([style.id, p.items.map((x) => [x.id, x.name, x.updatedAt]), active, p.note, p.sync]);
    if (sig === last && !force) return; // the store fires on every beat; only redraw when something here would change
    last = sig;

    // the Style panel
    $('preset-style').textContent = style.name;
    builtinRow.replaceChildren(...builtin.map(chip));
    openBtn.textContent = p.items.length ? `My presets (${p.items.length})` : 'My presets';
    fillNote($('preset-note'), p.note);

    // the sidebar tab
    listEl.replaceChildren();
    if (p.items.length) listEl.append(...p.items.map(row));
    else {
      const empty = el('li', 'track-empty');
      empty.textContent = 'Nothing saved yet. Set the band up the way you like it, name it above and press Save. Then use it over any progression.';
      listEl.append(empty);
    }
    $('sum-presets').textContent = p.items.length ? String(p.items.length) : '';
    $('preset-sync').textContent = p.items.length ? SYNC_TEXT[p.sync] ?? '' : '';
    fillNote($('presets-msg'), p.note);
    renderSaveButton();
  }

  store.subscribe((state) => render(state));
  render(store.get(), true);
}
