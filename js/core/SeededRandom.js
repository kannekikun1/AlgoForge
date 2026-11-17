/**
 * Seeded pseudorandom number generator.
 *
 * Algorithm: Mulberry32 (32-bit state, period 2^32) — chosen for speed, tiny state and
 * exact reproducibility across JavaScript engines (it uses only 32-bit integer ops via
 * Math.imul and >>> which are fully specified by ECMAScript).
 *
 * Seeds: any integer or string. Strings and labels are hashed with 32-bit FNV-1a.
 * `fork(label)` derives an independent stream without advancing the parent — this lets
 * generators give every (size, repetition) pair its own reproducible stream.
 *
 * Not suitable for cryptography.
 */
export class SeededRandom {
  #state;

  constructor(seed = 1) {
    this.seed = SeededRandom.normalizeSeed(seed);
    this.#state = this.seed;
  }

  static normalizeSeed(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return (Math.trunc(seed) >>> 0);
    return fnv1a(String(seed));
  }

  /** Uniform float in [0, 1). */
  next() {
    let t = (this.#state = (this.#state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min, max) {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  float(min, max) { return min + this.next() * (max - min); }

  bool(p = 0.5) { return this.next() < p; }

  pick(arr) {
    if (!arr.length) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** In-place Fisher–Yates shuffle; returns the array. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Standard normal sample via Box–Muller (uses two draws). */
  normal(mean = 0, sd = 1) {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Derive an independent generator from the current seed and a label, without consuming state. */
  fork(label) {
    return new SeededRandom(fnv1a(`${this.seed}:${label}`));
  }

  getState() { return this.#state; }
  setState(s) { this.#state = s >>> 0; }
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Random seed for UI defaults (not part of any reproducibility guarantee). */
export function freshSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0] % 1000000;
  }
  return Math.floor(Math.random() * 1000000);
}
