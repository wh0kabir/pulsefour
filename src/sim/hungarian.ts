/**
 * The Hungarian algorithm (CLAUDE.md section 9.3, locked decision 3).
 *
 * Solves the assignment problem: pick at most one column per row, at most one
 * row per column, minimising the total cost. Written here rather than pulled
 * from a dependency, as the spec requires.
 *
 * This is the O(n^3) shortest-augmenting-path formulation with potentials
 * (Jonker-Volgenant style). Rectangular matrices are handled directly: with
 * `rows <= cols` every row gets a column; otherwise the matrix is transposed
 * internally and the result mapped back, so every column gets a row.
 *
 * Why solve the whole board at once? A greedy "nearest pair first" pass is what
 * the baselines do (section 9.8). Solving jointly is what lets a distant
 * critical casualty outrank a nearby minor one.
 */

const INF = Infinity;

export interface Assignment {
  /** assignment[row] = column, or -1 when that row got nothing. */
  readonly assignment: Int32Array;
  /** Sum of cost[row][assignment[row]] over assigned rows. */
  readonly total: number;
}

/**
 * @param cost rows x cols matrix of finite numbers. Use a large finite value
 *             (never Infinity) for an infeasible pairing, so the solver can
 *             still produce an assignment and the caller can reject any cell
 *             at or above that value.
 */
export function hungarian(cost: readonly (readonly number[])[]): Assignment {
  const rows = cost.length;
  if (rows === 0) return { assignment: new Int32Array(0), total: 0 };
  const cols = cost[0]!.length;
  if (cols === 0) return { assignment: new Int32Array(rows).fill(-1), total: 0 };

  // The algorithm below requires rows <= cols. Transpose if needed.
  if (rows > cols) {
    const transposed: number[][] = Array.from({ length: cols }, (_, c) =>
      Array.from({ length: rows }, (_, r) => cost[r]![c]!),
    );
    const solved = solve(transposed, cols, rows);
    const assignment = new Int32Array(rows).fill(-1);
    for (let c = 0; c < cols; c++) {
      const r = solved.assignment[c]!;
      if (r >= 0) assignment[r] = c;
    }
    return { assignment, total: solved.total };
  }

  return solve(cost, rows, cols);
}

function solve(
  cost: readonly (readonly number[])[],
  rows: number,
  cols: number,
): Assignment {
  // 1-indexed working arrays, with index 0 used as a sentinel.
  const u = new Float64Array(rows + 1);
  const v = new Float64Array(cols + 1);
  const p = new Int32Array(cols + 1); // p[col] = row currently matched to col
  const way = new Int32Array(cols + 1);

  const minv = new Float64Array(cols + 1);
  const used = new Uint8Array(cols + 1);

  for (let i = 1; i <= rows; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(INF);
    used.fill(0);

    // Grow an alternating tree until we reach a free column.
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;

      for (let j = 1; j <= cols; j++) {
        if (used[j] === 1) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }

      // A fully infeasible row can leave delta at INF; stop rather than
      // poisoning every potential with NaN.
      if (!Number.isFinite(delta)) {
        j0 = j1;
        break;
      }

      for (let j = 0; j <= cols; j++) {
        if (used[j] === 1) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    // Walk the augmenting path back, flipping the matching.
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Int32Array(rows).fill(-1);
  for (let j = 1; j <= cols; j++) {
    const row = p[j]!;
    if (row > 0 && row <= rows) assignment[row - 1] = j - 1;
  }

  let total = 0;
  for (let r = 0; r < rows; r++) {
    const c = assignment[r]!;
    if (c >= 0) total += cost[r]![c]!;
  }

  return { assignment, total };
}

/**
 * Exhaustive reference solver. Exponential: for tests on small matrices only.
 * Exported so the test suite can check the fast path against it.
 */
export function bruteForceAssignment(
  cost: readonly (readonly number[])[],
): { assignment: Int32Array; total: number } {
  const rows = cost.length;
  if (rows === 0) return { assignment: new Int32Array(0), total: 0 };
  const cols = cost[0]!.length;

  const best = { total: INF, assignment: new Int32Array(rows).fill(-1) };
  const takenCols = new Set<number>();
  const current = new Int32Array(rows).fill(-1);

  // As many pairs as possible must be made: min(rows, cols). Without this a
  // tall matrix would "optimally" assign nothing and score 0.
  const required = Math.min(rows, cols);

  // NOTE: deliberately no branch-and-bound pruning on the running total. Costs
  // here can be negative (section 9.2 subtracts a severity benefit), so a
  // partial sum is not a lower bound on the final total. This is a reference
  // solver for tests: correctness over speed.
  function recurse(row: number, runningTotal: number, assigned: number): void {
    if (row === rows) {
      if (assigned === required && runningTotal < best.total) {
        best.total = runningTotal;
        best.assignment = Int32Array.from(current);
      }
      return;
    }

    for (let c = 0; c < cols; c++) {
      if (takenCols.has(c)) continue;
      takenCols.add(c);
      current[row] = c;
      recurse(row + 1, runningTotal + cost[row]![c]!, assigned + 1);
      takenCols.delete(c);
      current[row] = -1;
    }

    // Leaving this row unassigned is only possible when rows > cols.
    if (rows > cols) recurse(row + 1, runningTotal, assigned);
  }

  recurse(0, 0, 0);
  return best;
}
