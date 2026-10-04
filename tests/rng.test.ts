import { describe, expect, it } from 'vitest';
import { makeRng } from '../src/sim/rng';

describe('makeRng', () => {
  it('is deterministic: the same seed gives the same sequence', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('gives different sequences for different seeds', () => {
    const a = Array.from({ length: 20 }, (_, i) => i);
    const seqA = a.map(() => makeRng(1).next());
    const seqB = a.map(() => makeRng(2).next());
    expect(seqA[0]).not.toEqual(seqB[0]);
  });

  it('stays in [0, 1)', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 2000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() respects inclusive bounds and covers them', () => {
    const rng = makeRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(3, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('shuffle() permutes without losing or duplicating items', () => {
    const rng = makeRng(42);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(input);
    expect(out).toHaveLength(input.length);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
    // The input array itself is untouched.
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('shuffle() is reproducible for a given seed', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(makeRng(5).shuffle(input)).toEqual(makeRng(5).shuffle(input));
  });

  it('pick() throws on an empty array rather than returning undefined', () => {
    expect(() => makeRng(1).pick([])).toThrow();
  });
});
