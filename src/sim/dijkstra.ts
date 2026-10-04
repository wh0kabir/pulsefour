/**
 * Dijkstra trees for batch costs (CLAUDE.md section 8).
 *
 * The allocator needs travel times from every ambulance to every casualty, and
 * from every casualty to every hospital. Running hundreds of A* queries per
 * tick would be wasteful. Instead:
 *
 *   * one FORWARD tree per ambulance   -> cost to every node
 *   * one REVERSE tree per hospital    -> cost from every node INTO it
 *
 * Hospital trees are cached and invalidated only when a road opens or closes,
 * or congestion changes.
 */

import type { RoadGraph } from './graph';
import { MinHeap } from './heap';

export const UNREACHABLE = Infinity;

/** Travel minutes from (or into) one source, indexed by node. */
export type CostTree = Float64Array;

export class DijkstraSolver {
  private readonly heap = new MinHeap();
  private readonly settled: Uint8Array;

  private readonly graph: RoadGraph;

  constructor(graph: RoadGraph) {
    this.graph = graph;
    this.settled = new Uint8Array(graph.nodeCount);
  }

  /** Travel minutes FROM `source` to every node. */
  forward(source: number): CostTree {
    return this.run(source, false);
  }

  /** Travel minutes INTO `target` from every node (search over reversed edges). */
  reverse(target: number): CostTree {
    return this.run(target, true);
  }

  private run(source: number, reversed: boolean): CostTree {
    const { graph } = this;
    const dist = new Float64Array(graph.nodeCount).fill(UNREACHABLE);
    this.settled.fill(0);
    this.heap.clear();

    dist[source] = 0;
    this.heap.push(source, 0);

    while (this.heap.length > 0) {
      const node = this.heap.pop();
      if (this.settled[node] === 1) continue;
      this.settled[node] = 1;

      const here = dist[node]!;
      const edges = reversed ? graph.inEdges(node) : graph.outEdges(node);

      for (const edgeId of edges) {
        if (graph.isClosed(edgeId)) continue;
        // Walking the reverse tree, we arrive at the edge's FROM node.
        const next = reversed ? graph.edgeFrom[edgeId]! : graph.edgeTo[edgeId]!;
        if (this.settled[next] === 1) continue;

        const tentative = here + graph.edgeMinutes(edgeId);
        if (tentative < dist[next]!) {
          dist[next] = tentative;
          this.heap.push(next, tentative);
        }
      }
    }

    return dist;
  }
}

/**
 * Caches one reverse tree per hospital. Invalidated wholesale whenever the
 * network changes, which is rare (a road closing, congestion changing).
 */
export class HospitalTreeCache {
  private trees = new Map<number, CostTree>();
  private readonly solver: DijkstraSolver;

  constructor(graph: RoadGraph) {
    this.solver = new DijkstraSolver(graph);
  }

  /** Travel minutes into `hospitalNode` from every node. */
  treeFor(hospitalNode: number): CostTree {
    const cached = this.trees.get(hospitalNode);
    if (cached) return cached;
    const tree = this.solver.reverse(hospitalNode);
    this.trees.set(hospitalNode, tree);
    return tree;
  }

  /** Call when a road opens or closes, or congestion changes. */
  invalidate(): void {
    this.trees.clear();
  }

  get size(): number {
    return this.trees.size;
  }
}
