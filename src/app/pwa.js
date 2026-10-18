// Installing Jam Gym as an app. The site works exactly as before; this only adds a service worker (so the app is kept for
// offline use) and an "Install app" button when the browser offers one. The big download, the recorded sounds (about 30 MB),
// starts only once the app is installed, so someone just browsing the website never downloads it. The install text says so.

/**
 * @param {{button: HTMLElement|null, info: HTMLElement|null, note: HTMLElement|null, nav?: Navigator, win?: Window}} parts
 *   button, info: the Install app button and the sentence about offline use (both hidden until the browser offers installing);
 *   note: where offline progress is shown
 */
export function mountPwa({ button, info, note, nav = navigator, win = window } = {}) {
  if (!('serviceWorker' in nav)) return;
  let prompt = null;
  let registration = null;

  const offer = (on) => { if (button) button.hidden = !on; if (info) info.hidden = !on; };
  offer(false);
  const installed = () => (win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || nav.standalone === true;

  // ask the worker to keep the sounds too (skipped if the person asked their browser to save data)
  const keepSounds = () => {
    const worker = registration && registration.active;
    if (!worker) return;
    worker.postMessage({ type: nav.connection && nav.connection.saveData ? 'status' : 'keep-samples' });
  };

  win.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    prompt = event;
    offer(true);
  });
  if (button) {
    button.addEventListener('click', async () => {
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice.catch(() => {});
      prompt = null;
      offer(false);
    });
  }
  win.addEventListener('appinstalled', () => { prompt = null; offer(false); keepSounds(); });

  const show = ({ done, total, state }) => {
    if (!note) return;
    if (state === 'ready') note.textContent = 'Ready to use offline.';
    else if (state === 'partial') note.textContent = 'Some sounds could not be saved for offline use yet. They will be tried again next time.';
    else if (state === 'working') note.textContent = `Saving sounds for offline use… ${Math.floor((done / Math.max(total, 1)) * 100)}%`;
    else note.textContent = '';
    note.hidden = !note.textContent;
  };
  nav.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'offline-progress') show(event.data);
  });

  win.addEventListener('load', async () => {
    try {
      await nav.serviceWorker.register('/sw.js');
      registration = await nav.serviceWorker.ready;
      // opened as an installed app (this includes the Android app and iPhone's Add to Home Screen): keep the sounds now
      if (installed()) keepSounds();
      else registration.active && registration.active.postMessage({ type: 'status' });
    } catch { /* no worker (private window, blocked): the site just works online, as before */ }
  });
}
