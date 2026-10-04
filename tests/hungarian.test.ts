import { describe, expect, it } from 'vitest';

import { bruteForceAssignment, hungarian } from '../src/sim/hungarian';
import { makeRng } from '../src/sim/rng';

function totalOf(cost: number[][], assignment: Int32Array): number {
  let sum = 0;
  for (let r = 0; r < assignment.length; r++) {
    const c = assignment[r]!;
    if (c >= 0) sum += cost[r]![c]!;
  }
  return sum;
}

describe('hungarian', () => {
  it('solves a known 3x3 optimally', () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const { assignment, total } = hungarian(cost);
    expect(total).toBe(5); // 4 + 0 + ... -> best is 1+2+2 = 5
    expect(totalOf(cost, assignment)).toBe(total);
  });

  it('matches brute force on random square matrices', () => {
    const rng = makeRng(11);
    for (let trial = 0; trial < 60; trial++) {
      const n = rng.int(1, 6);
      const cost = Array.from({ length: n }, () =>
        Array.from({ length: n }, () => rng.int(0, 50)),
      );
      const fast = hungarian(cost);
      const slow = bruteForceAssignment(cost);
      expect(fast.total).toBeCloseTo(slow.total, 9);
      expect(totalOf(cost, fast.assignment)).toBeCloseTo(fast.total, 9);
    }
  });

  it('matches brute force on wide matrices (more columns than rows)', () => {
    const rng = makeRng(22);
    for (let trial = 0; trial < 50; trial++) {
      const rows = rng.int(1, 5);
      const cols = rows + rng.int(1, 4);
      const cost = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => rng.int(0, 40)),
      );
      const fast = hungarian(cost);
      const slow = bruteForceAssignment(cost);
      expect(fast.total).toBeCloseTo(slow.total, 9);
      // Every row must get a distinct column.
      const seen = new Set<number>();
      for (const c of fast.assignment) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
    }
  });

  it('matches brute force on tall matrices (more rows than columns)', () => {
    const rng = makeRng(33);
    for (let trial = 0; trial < 50; trial++) {
      const cols = rng.int(1, 4);
      const rows = cols + rng.int(1, 4);
      const cost = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => rng.int(0, 40)),
      );
      const fast = hungarian(cost);
      const slow = bruteForceAssignment(cost);
      expect(fast.total).toBeCloseTo(slow.total, 9);
      // Exactly `cols` rows get an assignment, all distinct.
      const assigned = [...fast.assignment].filter((c) => c >= 0);
      expect(assigned.length).toBe(cols);
      expect(new Set(assigned).size).toBe(cols);
    }
  });

  it('handles negative costs (benefit can exceed travel cost)', () => {
    // Section 9.2 subtracts a severity benefit, so cells are often negative.
    const rng = makeRng(44);
    for (let trial = 0; trial < 30; trial++) {
      const n = rng.int(1, 5);
      const cost = Array.from({ length: n }, () =>
        Array.from({ length: n }, () => rng.int(-100, 50)),
      );
      const fast = hungarian(cost);
      const slow = bruteForceAssignment(cost);
      expect(fast.total).toBeCloseTo(slow.total, 9);
    }
  });

  it('still returns a valid assignment when some cells are the infeasible value M', () => {
    const M = 1e9;
    const cost = [
      [5, M, M],
      [M, 7, M],
      [M, M, 2],
    ];
    const { assignment } = hungarian(cost);
    expect([...assignment]).toEqual([0, 1, 2]);
  });

  it('picks the feasible cell when a row has exactly one', () => {
    const M = 1e9;
    const cost = [
      [M, 3, M],
      [1, M, M],
      [M, M, 4],
    ];
    const { assignment } = hungarian(cost);
    expect(assignment[0]).toBe(1);
    expect(assignment[1]).toBe(0);
    expect(assignment[2]).toBe(2);
  });

  it('returns empty for empty input', () => {
    expect(hungarian([]).assignment.length).toBe(0);
    expect(hungarian([[]]).assignment[0]).toBe(-1);
  });

  it('is deterministic: identical input gives identical output', () => {
    const rng = makeRng(55);
    const cost = Array.from({ length: 6 }, () =>
      Array.from({ length: 8 }, () => rng.int(0, 99)),
    );
    const a = hungarian(cost);
    const b = hungarian(cost);
    expect([...a.assignment]).toEqual([...b.assignment]);
    expect(a.total).toBe(b.total);
  });
});
