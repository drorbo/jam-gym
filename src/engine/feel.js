// Rhythmic feel: swing mapping and humanisation.
//
// Patterns are written on a straight grid (an "and" is 0.5). The style's feel then
// re-times them, so the same pattern can be played straight or swung.

/**
 * Map a straight-grid beat position to a swung one.
 * swing = 0.5 is straight; 0.667 is triplet swing (the "and" lands 2/3 through the beat).
 * The mapping is piecewise linear, so 16ths are swung consistently too.
 */
export function swingMap(pos, swing) {
  if (Math.abs(swing - 0.5) < 1e-6) return pos;
  const b = Math.floor(pos + 1e-9);
  const f = pos - b;
  return f < 0.5 ? b + f * 2 * swing : b + swing + (f - 0.5) * 2 * (1 - swing);
}

/** Apply swing to every event that isn't flagged `fixed`. Durations follow their end points. */
export function applyFeel(events, swing) {
  if (Math.abs(swing - 0.5) < 1e-6) return events;
  return events.map((e) => {
    if (e.fixed) return e;
    const start = swingMap(e.beat, swing);
    const end = swingMap(e.beat + e.dur, swing);
    return { ...e, beat: start, dur: Math.max(0.02, end - start) };
  });
}

/**
 * Add small, seeded timing and velocity variation.
 * @param {object[]} events
 * @param {Record<string,{t?:number, v?:number, lay?:number}>} cfg per-instrument:
 *   t = timing jitter (seconds), v = velocity jitter (0-1), lay = constant offset (seconds, +late)
 * @param {ReturnType<import('./rng.js').createRng>} rng
 */
export function humanize(events, cfg = {}, rng) {
  return events.map((e) => {
    const c = cfg[e.inst];
    if (!c) return e;
    const dt = (e.dt || 0) + (c.lay || 0) + (c.t ? rng.jitter(c.t) : 0);
    const vel = c.v ? e.vel * (1 + rng.jitter(c.v)) : e.vel;
    return { ...e, dt, vel: Math.min(1, Math.max(0.02, vel)) };
  });
}
