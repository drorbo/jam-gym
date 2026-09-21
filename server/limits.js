// In-memory rate limiting (fixed windows). Best effort: it resets when the server restarts, and per-IP limits can be
// dodged by someone with many addresses. It exists to stop accidents and cheap abuse, not determined attackers.

export function createLimiter(clock = Date.now) {
  const buckets = new Map();

  const timer = setInterval(() => {
    const t = clock();
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
  }, 60_000);
  timer.unref?.();

  return {
    /**
     * Count one hit against `key`.
     * @returns {{ok: true} | {ok: false, retryAfter: number}} retryAfter in whole seconds
     */
    hit(key, max, windowMs) {
      const t = clock();
      let b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        b = { count: 0, resetAt: t + windowMs };
        buckets.set(key, b);
      }
      b.count++;
      return b.count <= max ? { ok: true } : { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - t) / 1000)) };
    },
    size: () => buckets.size,
    stop: () => clearInterval(timer),
  };
}
