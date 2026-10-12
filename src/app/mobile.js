// Phone layout behaviour. The look lives in css/app.css (the "phone" and "big chords" sections); this file only does
// what CSS can't: remember which view is showing, switch it, run the Big chords mode (full-screen chord, screen kept
// awake) and keep the bottom dock's one-line summary current.
//
// Views (phone only; on a wide screen the nav is hidden and the whole page shows, so body[data-mview] is harmless there):
//   play   the readout, count-in/loop, the bars, Tempo   chords  the bars and the progression box
//   band   Style, Bass line, Keys, Drums, Mix             loop    Key change and Tempo ramp (what happens at a loop's end)

const KEY = 'jamgym.mview.v1';
const VIEWS = ['play', 'chords', 'band', 'loop'];

/**
 * @param {{store: {get(): any, subscribe(fn: Function): any}, storage?: Storage|null}} deps
 */
export function mountMobile({ store, storage = null }) {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const nav = $('mnav');

  // ---- views -----------------------------------------------------------------------------------------------------
  function show(view, { scroll = true } = {}) {
    if (!VIEWS.includes(view)) view = 'play';
    body.dataset.mview = view;
    for (const b of nav.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    try { storage?.setItem(KEY, view); } catch { /* storage blocked: it just starts on Play next time */ }
    if (scroll) window.scrollTo(0, 0);
  }
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) show(b.dataset.view);
  });
  let saved = null;
  try { saved = storage?.getItem(KEY); } catch { /* storage blocked */ }
  show(saved, { scroll: false });

  // ---- Big chords ------------------------------------------------------------------------------------------------
  let wake = null;
  async function holdScreen() {
    try { if (!wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* refused: the screen may dim, nothing else */ }
  }
  function releaseScreen() { try { wake?.release(); } catch { /* already gone */ } wake = null; }

  function setPerform(on) {
    if (on) body.dataset.perform = ''; else delete body.dataset.perform;
    $('perform-open').setAttribute('aria-pressed', String(on));
    if (on) { window.scrollTo(0, 0); holdScreen(); } else releaseScreen();
    // the chord was fitted to the old box; the stage's ResizeObserver refits it, but only once the layout has changed
    window.dispatchEvent(new Event('resize'));
  }
  $('perform-open').addEventListener('click', () => setPerform(!('perform' in body.dataset)));
  $('perform-exit').addEventListener('click', () => setPerform(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && 'perform' in body.dataset) setPerform(false); });
  // a hidden tab loses the wake lock; take it back on return
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && 'perform' in body.dataset) holdScreen(); });
  // tempo in Big chords: the same buttons the Tempo section has, so every rule about limits and mid-play changes stays in one place
  $('perform-slower').addEventListener('click', () => $('bpm-down').click());
  $('perform-faster').addEventListener('click', () => $('bpm-up').click());

  // ---- dock summary + tempo readout ------------------------------------------------------------------------------
  const info = $('fab-info');
  const bpmOut = $('perform-bpm-val');
  function paint(state) {
    const { transport, view, song } = state;
    const stopped = transport === 'stopped';
    const bpm = stopped ? song.tempo : (view.bpm ?? song.tempo);
    const text = !stopped && view.bar > 0 ? `Bar ${view.bar}/${view.bars} · ${bpm} BPM` : `${bpm} BPM`;
    if (info.textContent !== text) info.textContent = text;
    const b = `${bpm} BPM`;
    if (bpmOut.textContent !== b) bpmOut.textContent = b;
  }
  paint(store.get());
  store.subscribe((state) => paint(state));

  return { show, setPerform };
}
