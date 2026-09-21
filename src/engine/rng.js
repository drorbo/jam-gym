// Small seeded PRNG so "random" behaviour is reproducible (and therefore testable).

/** mulberry32: 32-bit state, plenty for musical variation. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix several integers into one seed. */
export function hashSeed(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    h ^= (p | 0) + 0x9e3779b9;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function createRng(seed) {
  const next = mulberry32(seed);
  const rng = {
    next,
    /** integer in [0, n) */
    int: (n) => Math.floor(next() * n),
    /** true with probability p */
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** uniform in [-amount, amount] */
    jitter: (amount) => (next() * 2 - 1) * amount,
    /** weighted choice: items = [[value, weight], ...] */
    weighted(items) {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [value, w] of items) {
        r -= w;
        if (r < 0) return value;
      }
      return items[items.length - 1][0];
    },
    shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
  return rng;
}
