// The Tracks sidebar: a panel that slides in from the right and can be collapsed again.
//
// On a wide screen it docks beside the practice controls and pushes them over, so the play button stays in reach
// while you browse. On a narrow screen it slides over the page like a sheet, with a scrim behind it; Escape or a tap
// on the scrim closes it. Whether it was open is remembered (a per-viewer convenience: if storage is blocked, it
// simply starts closed).

const KEY = 'jamgym.sidebar.v1';
const OVERLAY = '(max-width: 1099px)';

export function mountSidebar({ storage = null } = {}) {
  const $ = (id) => document.getElementById(id);
  const sidebar = $('sidebar');
  const toggle = $('tracks-toggle');
  const scrim = $('scrim');
  const body = document.body;
  const overlay = window.matchMedia(OVERLAY);
  const listeners = new Set();

  let open = false;
  try { open = storage?.getItem(KEY) === 'open'; } catch { /* storage blocked */ }

  const remember = () => { try { storage?.setItem(KEY, open ? 'open' : 'closed'); } catch { /* storage blocked */ } };

  /** Apply the current state to the page. */
  function apply({ moveFocus = false } = {}) {
    body.dataset.sidebar = open ? 'open' : 'closed';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-open', open);
    sidebar.inert = !open; // keeps the closed panel's controls out of the tab order
    const sheet = open && overlay.matches;
    scrim.hidden = !sheet;
    body.classList.toggle('sidebar-lock', sheet); // no page scrolling behind a sheet
    if (moveFocus) {
      if (open && sheet) $('sidebar-close').focus();
      else if (!open) toggle.focus();
    }
    listeners.forEach((fn) => fn(open));
  }

  function set(next, { moveFocus = false, persist = true } = {}) {
    if (next === open) return;
    open = next;
    if (persist) remember();
    apply({ moveFocus });
  }

  toggle.addEventListener('click', () => set(!open, { moveFocus: true }));
  $('sidebar-close').addEventListener('click', () => set(false, { moveFocus: true }));
  scrim.addEventListener('click', () => set(false, { moveFocus: true }));
  sidebar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open && overlay.matches && !e.defaultPrevented) set(false, { moveFocus: true });
  });
  // rotating a phone or resizing across the breakpoint changes between docked and sheet
  overlay.addEventListener?.('change', () => apply());

  apply();
  return {
    get isOpen() { return open; },
    open: (opts) => set(true, opts),
    close: (opts) => set(false, opts),
    toggle: () => set(!open, { moveFocus: true }),
    /** After loading a track on a phone, get the sheet out of the way so the player is visible. */
    closeIfSheet: () => { if (open && overlay.matches) set(false, { moveFocus: true }); },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
