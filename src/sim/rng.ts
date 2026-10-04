/**
 * Seeded pseudo-random number generator (CLAUDE.md section 7.1).
 *
 * All randomness in the simulation comes from here, so a run with the same
 * seed is exactly reproducible. That is what makes the three-strategy
 * comparison honest: same seed, same fleet, same scenario (section 0, rule 5).
 *
 * mulberry32: small, fast, good enough for a simulation. Not cryptographic.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform in [min, max). */
  float(min: number, max: number): number;
  /** Fisher-Yates, returns a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /** Uniformly picks one item. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
}

export function makeRng(seed: number): Rng {
  // Keep the state in a 32-bit unsigned integer.
  let state = seed >>> 0;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1));
  }

  function float(min: number, max: number): number {
    return min + next() * (max - min);
  }

  function shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      const a = out[i] as T;
      const b = out[j] as T;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() called on an empty array');
    return items[int(0, items.length - 1)] as T;
  }

  return { next, int, float, shuffle, pick };
}
