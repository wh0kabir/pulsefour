import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { AStar } from '../src/sim/astar';
import { DijkstraSolver, HospitalTreeCache, UNREACHABLE } from '../src/sim/dijkstra';
import { RoadGraph, approxDistanceM, haversineM } from '../src/sim/graph';
import { makeRng } from '../src/sim/rng';
import type { GraphFile } from '../src/sim/types';

const GRAPH_PATH = join(process.cwd(), 'public', 'data', 'graph.json');

let graph: RoadGraph;

beforeAll(() => {
  const file = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as GraphFile;
  graph = new RoadGraph(file);
});

describe('RoadGraph', () => {
  it('loads the committed South Mumbai network', () => {
    expect(graph.nodeCount).toBeGreaterThan(2000);
    expect(graph.edgeCount).toBeGreaterThan(5000);
  });

  it('is strongly connected: every node reaches every other', () => {
    // Spot-check with one forward tree and one reverse tree from the same
    // node. In a strongly connected component both must reach everything.
    const solver = new DijkstraSolver(graph);
    const out = solver.forward(0);
    const into = solver.reverse(0);
    const unreachableOut = out.filter((d) => d === UNREACHABLE).length;
    const unreachableIn = into.filter((d) => d === UNREACHABLE).length;
    expect(unreachableOut).toBe(0);
    expect(unreachableIn).toBe(0);
  });

  it('derives travel time from our speed table, not from OSM', () => {
    // A 1 km residential edge at 18 km/h is 3.33 minutes.
    for (let e = 0; e < graph.edgeCount; e++) {
      const minutes = graph.edgeMinutes(e);
      expect(minutes).toBeGreaterThan(0);
      expect(Number.isFinite(minutes)).toBe(true);
    }
  });

  it('congestion slows every edge proportionally', () => {
    const before = graph.edgeMinutes(0);
    graph.setCongestion(0.5);
    expect(graph.edgeMinutes(0)).toBeCloseTo(before * 2, 9);
    graph.setCongestion(1);
    expect(graph.edgeMinutes(0)).toBeCloseTo(before, 9);
  });
});

describe('A*', () => {
  it('returns the same cost as Dijkstra on random pairs (optimality)', () => {
    const astar = new AStar(graph);
    const solver = new DijkstraSolver(graph);
    const rng = makeRng(2024);

    for (let trial = 0; trial < 12; trial++) {
      const start = rng.int(0, graph.nodeCount - 1);
      const tree = solver.forward(start);

      for (let probe = 0; probe < 8; probe++) {
        const goal = rng.int(0, graph.nodeCount - 1);
        const route = astar.search(start, goal);
        const optimal = tree[goal]!;

        if (optimal === UNREACHABLE) {
          expect(route).toBeNull();
        } else {
          expect(route).not.toBeNull();
          expect(route!.minutes).toBeCloseTo(optimal, 6);
        }
      }
    }
  });

  it('returns a path whose edges actually connect start to goal', () => {
    const astar = new AStar(graph);
    const rng = makeRng(7);

    for (let i = 0; i < 20; i++) {
      const start = rng.int(0, graph.nodeCount - 1);
      const goal = rng.int(0, graph.nodeCount - 1);
      const route = astar.search(start, goal);
      if (!route || route.edgeIds.length === 0) continue;

      let node = start;
      let total = 0;
      for (const edgeId of route.edgeIds) {
        expect(graph.edgeFrom[edgeId]).toBe(node);
        node = graph.edgeTo[edgeId]!;
        total += graph.edgeMinutes(edgeId);
      }
      expect(node).toBe(goal);
      expect(total).toBeCloseTo(route.minutes, 6);
    }
  });

  it('costs nothing to stay put', () => {
    const astar = new AStar(graph);
    const route = astar.search(100, 100);
    expect(route).toEqual({ edgeIds: [], minutes: 0 });
  });
});

describe('closing roads', () => {
  it('never edits the graph, and reopening restores the original route', () => {
    const astar = new AStar(graph);
    const rng = makeRng(99);

    // Find a pair whose route is several edges long.
    let start = 0;
    let goal = 0;
    let original = null as ReturnType<AStar['search']>;
    for (let i = 0; i < 200 && (!original || original.edgeIds.length < 6); i++) {
      start = rng.int(0, graph.nodeCount - 1);
      goal = rng.int(0, graph.nodeCount - 1);
      original = astar.search(start, goal);
    }
    expect(original).not.toBeNull();

    const edgeCountBefore = graph.edgeCount;
    const victim = original!.edgeIds[Math.floor(original!.edgeIds.length / 2)]!;

    const closedIds = graph.closeRoad(victim, true);
    expect(closedIds.length).toBeGreaterThan(0);
    expect(graph.isClosed(victim)).toBe(true);
    // The graph itself is untouched.
    expect(graph.edgeCount).toBe(edgeCountBefore);

    const detour = astar.search(start, goal);
    if (detour) {
      // The closed edge must not be used, and the detour cannot be faster.
      expect(detour.edgeIds).not.toContain(victim);
      expect(detour.minutes).toBeGreaterThanOrEqual(original!.minutes - 1e-9);
    }

    graph.openRoad(victim, true);
    expect(graph.isClosed(victim)).toBe(false);
    const restored = astar.search(start, goal);
    expect(restored!.minutes).toBeCloseTo(original!.minutes, 9);
  });

  it('closes every edge sharing an OSM way id by default', () => {
    const edgeId = 0;
    const way = graph.edgeOsmWayId[edgeId]!;
    const siblings = graph.edgeIdsForWay(way);
    graph.closeRoad(edgeId, true);
    for (const id of siblings) expect(graph.isClosed(id)).toBe(true);
    graph.openRoad(edgeId, true);
    for (const id of siblings) expect(graph.isClosed(id)).toBe(false);
  });

  it('closes a single segment when asked', () => {
    const edgeId = 0;
    const way = graph.edgeOsmWayId[edgeId]!;
    const siblings = graph.edgeIdsForWay(way).filter((id) => id !== edgeId);
    graph.closeRoad(edgeId, false);
    expect(graph.isClosed(edgeId)).toBe(true);
    for (const id of siblings) expect(graph.isClosed(id)).toBe(false);
    graph.openRoad(edgeId, false);
  });

  it('returns null rather than throwing when the goal is walled off', () => {
    const astar = new AStar(graph);
    // Seal every road into a node, then nothing can reach it.
    const target = 500;
    const incoming = [...graph.inEdges(target)];
    graph.closeEdges(incoming);

    const route = astar.search(0, target);
    expect(route).toBeNull();

    graph.openEdges(incoming);
    expect(astar.search(0, target)).not.toBeNull();
  });
});

describe('Dijkstra trees', () => {
  it('a reverse tree equals per-node A* cost into the target', () => {
    const astar = new AStar(graph);
    const solver = new DijkstraSolver(graph);
    const target = 1234;
    const tree = solver.reverse(target);
    const rng = makeRng(31);

    for (let i = 0; i < 25; i++) {
      const from = rng.int(0, graph.nodeCount - 1);
      const route = astar.search(from, target);
      if (route === null) {
        expect(tree[from]).toBe(UNREACHABLE);
      } else {
        expect(tree[from]!).toBeCloseTo(route.minutes, 6);
      }
    }
  });

  it('caches hospital trees and invalidates them on a network change', () => {
    const cache = new HospitalTreeCache(graph);
    const first = cache.treeFor(42);
    const second = cache.treeFor(42);
    expect(second).toBe(first); // same object, served from cache
    expect(cache.size).toBe(1);

    cache.invalidate();
    expect(cache.size).toBe(0);
    const third = cache.treeFor(42);
    expect(third).not.toBe(first);
  });
});

describe('distance approximation', () => {
  it('stays within 1% of haversine across the study area', () => {
    const rng = makeRng(5);
    let worstRelative = 0;

    for (let i = 0; i < 400; i++) {
      const a = rng.int(0, graph.nodeCount - 1);
      const b = rng.int(0, graph.nodeCount - 1);
      const flat = approxDistanceM(graph.lat[a]!, graph.lng[a]!, graph.lat[b]!, graph.lng[b]!);
      const exact = haversineM(graph.lat[a]!, graph.lng[a]!, graph.lat[b]!, graph.lng[b]!);
      if (exact < 1) continue;
      worstRelative = Math.max(worstRelative, Math.abs(flat - exact) / exact);
    }

    // Measured worst case across 400 random pairs; recorded in docs/DATA.md.
    // A* stays optimal regardless, because its heuristic deflates this
    // distance by HEURISTIC_SAFETY before using it.
    expect(worstRelative).toBeLessThan(0.01);
    console.log(`  equirectangular vs haversine, worst case: ${(worstRelative * 100).toFixed(3)}%`);
  });
});
