// A steady timer for the scheduler.
//
// Browsers throttle timers on the main thread in background tabs (down to once a second),
// which would starve a lookahead scheduler. Timers inside a Worker are not throttled, so the
// tick comes from a tiny inline Worker, with a main-thread interval as a fallback.
// The tick only says "look now": all musical timing comes from the audio clock.

export function createTicker(onTick, intervalMs = 25) {
  let worker = null;
  let timer = null;

  try {
    const src = `let id=null;onmessage=e=>{if(e.data==='start'){clearInterval(id);id=setInterval(()=>postMessage(0),${intervalMs});}else{clearInterval(id);id=null;}};`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = onTick;
    URL.revokeObjectURL(url);
  } catch {
    worker = null;
  }

  return {
    start() {
      if (worker) worker.postMessage('start');
      else if (!timer) timer = setInterval(onTick, intervalMs);
    },
    stop() {
      if (worker) worker.postMessage('stop');
      else { clearInterval(timer); timer = null; }
    },
    get usesWorker() { return worker !== null; },
  };
}
