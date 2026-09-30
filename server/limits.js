// In-memory rate limiting (fixed windows). Best effort: it resets when the server restarts, and per-IP limits can be
// dodged by someone with many addresses. It exists to stop accidents and cheap abuse, not determined attackers.

// A hard ceiling on how many distinct keys can be tracked at once, so a flood of one-off keys (forged IPs, junk
// identities) cannot grow this map without bound and exhaust the container's memory. Each bucket is a short string
// key plus two numbers — comfortably small even at this size. When full, the single oldest bucket is evicted to make
// room (Map iteration order is insertion order); that bucket's own limit resets a little early, which only ever
// relaxes a limit, never tightens one, so this cannot itself lock someone out.
const MAX_BUCKETS = 200_000;

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
        if (!b && buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value);
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
