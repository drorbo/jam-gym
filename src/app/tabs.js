// A plain ARIA tabs widget: a [role="tablist"] of [role="tab"] buttons, each naming a [role="tabpanel"] through
// aria-controls. Click or Left/Right arrow switches; which tab was last open is remembered per list, the same
// per-viewer convenience as collapsible.js (and sharing its "storage may be blocked, everything still works" rule).

const KEY = 'jamgym.tabs.v1';

/**
 * @param {HTMLElement} tablist the [role="tablist"] element
 * @param {{storage?: Storage|null, default?: string}} [opts] default: a tab id to start on if nothing was saved
 */
export function mountTabs(tablist, { storage = null, default: fallback } = {}) {
  const listId = tablist.id;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return;
  const panelOf = (tab) => document.getElementById(tab.getAttribute('aria-controls'));

  let saved = {};
  try { saved = JSON.parse(storage?.getItem(KEY) || '{}') ?? {}; } catch { saved = {}; }
  if (typeof saved !== 'object' || saved === null) saved = {};

  function select(id) {
    for (const t of tabs) {
      const on = t.id === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = panelOf(t);
      if (panel) panel.hidden = !on;
    }
    let current = {};
    try { current = JSON.parse(storage?.getItem(KEY) || '{}') ?? {}; } catch { current = {}; }
    current[listId] = id;
    try { storage?.setItem(KEY, JSON.stringify(current)); } catch { /* storage blocked */ }
  }

  tablist.addEventListener('click', (e) => {
    const b = e.target.closest('[role="tab"]');
    if (b) select(b.id);
  });
  tablist.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const at = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next = tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1) + tabs.length) % tabs.length];
    select(next.id);
    next.focus();
  });

  const start = tabs.find((t) => t.id === saved[listId]) ?? tabs.find((t) => t.id === fallback) ?? tabs[0];
  select(start.id);
  return { select };
}
