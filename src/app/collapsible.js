// Collapsible sections. Any <details data-section="id"> inside `root` remembers whether it was open, and a
// "Collapse all / Expand all" button acts on the sections of whichever panel is showing.
//
// Whether a section is open is a per-viewer convenience kept in localStorage; if storage is blocked, everything simply
// starts open and still works.

const KEY = 'jamgym.sections.v1';

export function mountCollapsibles({ root = document, storage = null, toggleAll = null } = {}) {
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(KEY) || '{}') ?? {}; } catch { saved = {}; }
  if (typeof saved !== 'object') saved = {};

  const sections = [...root.querySelectorAll('details[data-section]')];
  const visible = () => sections.filter((d) => !d.hidden && !d.closest('[hidden]'));
  const allClosed = () => visible().every((d) => !d.open);
  const refreshButton = () => { if (toggleAll) toggleAll.textContent = allClosed() ? 'Expand all' : 'Collapse all'; };

  for (const d of sections) {
    const id = d.dataset.section;
    if (typeof saved[id] === 'boolean') d.open = saved[id];
    d.addEventListener('toggle', () => {
      // read the stored map again: another group of sections (the sidebar, the band panels) may have written to it
      let current = {};
      try { current = JSON.parse(storage?.getItem(KEY) || '{}') ?? {}; } catch { current = {}; }
      current[id] = d.open;
      try { storage?.setItem(KEY, JSON.stringify(current)); } catch { /* storage blocked */ }
      refreshButton();
    });
  }

  toggleAll?.addEventListener('click', () => {
    const open = allClosed();
    for (const d of visible()) d.open = open;
    refreshButton();
  });

  // the visible sections change when the tab does
  const watcher = new MutationObserver(refreshButton);
  for (const panel of root.querySelectorAll('[role="tabpanel"]')) watcher.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  for (const d of sections) watcher.observe(d, { attributes: true, attributeFilter: ['hidden'] });
  refreshButton();
  return { refresh: refreshButton };
}
