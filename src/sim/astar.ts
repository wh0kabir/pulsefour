/**
 * A* over the road graph (CLAUDE.md section 8).
 *
 * Cost is travel MINUTES. The heuristic is straight-line distance to the goal
 * divided by the fastest speed in the table, which can never overestimate the
 * true remaining time, so A* stays admissible and returns optimal routes.
 *
 * "Unreachable" is a normal answer: this returns null rather than throwing or
 * looping. The allocator uses null to disqualify an option.
 */

import { HEURISTIC_SAFETY, type RoadGraph } from './graph';
import { MinHeap } from './heap';

export interface Route {
  /** Edge ids in order. Empty when start === goal. */
  edgeIds: number[];
  /** Total travel time in minutes. */
  minutes: number;
}

export class AStar {
  private readonly dist: Float64Array;
  private readonly cameFromEdge: Int32Array;
  private readonly visitStamp: Int32Array;
  private readonly closedStamp: Int32Array;
  private stamp = 0;
  private readonly heap = new MinHeap();

  private readonly graph: RoadGraph;

  constructor(graph: RoadGraph) {
    this.graph = graph;
    const n = graph.nodeCount;
    this.dist = new Float64Array(n);
    this.cameFromEdge = new Int32Array(n);
    this.visitStamp = new Int32Array(n);
    this.closedStamp = new Int32Array(n);
  }

  /**
   * Shortest route from `start` to `goal` in travel minutes.
   * Returns null when no open route exists.
   */
  search(start: number, goal: number): Route | null {
    if (start === goal) return { edgeIds: [], minutes: 0 };

    const { graph } = this;
    // Metres per minute at the fastest speed. The heuristic divides by this.
    const bestMetresPerMinute = (graph.maxSpeedKmhEffective * 1000) / 60;

    this.stamp++;
    this.heap.clear();

    this.dist[start] = 0;
    this.cameFromEdge[start] = -1;
    this.visitStamp[start] = this.stamp;
    this.heap.push(start, this.heuristic(start, goal, bestMetresPerMinute));

    while (this.heap.length > 0) {
      const node = this.heap.pop();
      if (node === goal) return this.reconstruct(start, goal);

      // Skip nodes already expanded (lazy deletion instead of decrease-key).
      if (this.closedStamp[node] === this.stamp) continue;
      this.closedStamp[node] = this.stamp;

      const here = this.dist[node]!;
      for (const edgeId of graph.outEdges(node)) {
        if (graph.isClosed(edgeId)) continue;
        const next = graph.edgeTo[edgeId]!;
        if (this.closedStamp[next] === this.stamp) continue;

        const tentative = here + graph.edgeMinutes(edgeId);
        const seen = this.visitStamp[next] === this.stamp;
        if (!seen || tentative < this.dist[next]!) {
          this.dist[next] = tentative;
          this.cameFromEdge[next] = edgeId;
          this.visitStamp[next] = this.stamp;
          this.heap.push(next, tentative + this.heuristic(next, goal, bestMetresPerMinute));
        }
      }
    }

    return null; // Unreachable is a normal answer.
  }

  /** Travel minutes only, without building the path. */
  minutes(start: number, goal: number): number | null {
    const route = this.search(start, goal);
    return route ? route.minutes : null;
  }

  private heuristic(node: number, goal: number, bestMetresPerMinute: number): number {
    // Deflated so the approximation can never overestimate the true remaining
    // time, which would cost A* its optimality guarantee.
    return (this.graph.distanceM(node, goal) * HEURISTIC_SAFETY) / bestMetresPerMinute;
  }

  private reconstruct(start: number, goal: number): Route {
    const edgeIds: number[] = [];
    let node = goal;
    // Guard against a pathological loop; the path cannot exceed edgeCount.
    let guard = this.graph.edgeCount + 1;
    while (node !== start && guard-- > 0) {
      const edgeId = this.cameFromEdge[node]!;
      if (edgeId < 0) break;
      edgeIds.push(edgeId);
      node = this.graph.edgeFrom[edgeId]!;
    }
    edgeIds.reverse();
    return { edgeIds, minutes: this.dist[goal]! };
  }
}
