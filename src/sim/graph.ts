/**
 * The road graph in a form the router can use fast (CLAUDE.md sections 6, 8).
 *
 * Pure TypeScript: no DOM, no browser globals. Testable in Node.
 *
 * Edges are stored as compressed sparse rows (CSR): for node `n`, its outgoing
 * edges are `edgeIdsByNode[rowStart[n] .. rowStart[n+1]]`. That keeps the hot
 * loop over typed arrays with no allocation per visit.
 *
 * Closing a road NEVER edits the graph (section 8). A closed-edge set is
 * consulted during search, and opening a road just removes it from that set.
 */

import { SPEED_KMH, type RoadClass } from '../config/assumptions';
import type { GraphFile, LatLng, SpeedClass } from './types';

export class RoadGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;

  /** Node coordinates, parallel arrays. */
  readonly lat: Float64Array;
  readonly lng: Float64Array;

  /** Per edge. */
  readonly edgeFrom: Int32Array;
  readonly edgeTo: Int32Array;
  readonly edgeLengthM: Float64Array;
  readonly edgeOsmWayId: Int32Array;
  readonly edgeNameIdx: Int32Array;
  /** Minutes to traverse at the class speed, before congestion. */
  readonly edgeBaseMinutes: Float64Array;

  /** CSR adjacency over outgoing edges. */
  private readonly rowStart: Int32Array;
  private readonly rowEdges: Int32Array;

  /** CSR adjacency over INCOMING edges, for reverse searches into hospitals. */
  private readonly revRowStart: Int32Array;
  private readonly revRowEdges: Int32Array;

  readonly names: string[];
  readonly speedClasses: SpeedClass[];
  readonly classIdx: Int32Array;

  /** Edge ids sharing an OSM way id. Closing "a road" closes all of them. */
  private readonly edgesByWay: Map<number, number[]>;

  /** Closed edges. Not part of the graph; consulted by the search. */
  private closed = new Set<number>();

  /** Multiplies every speed. 1.0 normal, lower is worse traffic. */
  private congestion = 1;

  constructor(file: GraphFile) {
    this.nodeCount = file.nodes.lat.length;
    this.edgeCount = file.edges.from.length;

    this.lat = Float64Array.from(file.nodes.lat);
    this.lng = Float64Array.from(file.nodes.lng);

    this.edgeFrom = Int32Array.from(file.edges.from);
    this.edgeTo = Int32Array.from(file.edges.to);
    this.edgeLengthM = Float64Array.from(file.edges.lengthM);
    this.edgeOsmWayId = Int32Array.from(file.edges.osmWayId);
    this.edgeNameIdx = Int32Array.from(file.edges.nameIdx);
    this.classIdx = Int32Array.from(file.edges.classIdx);
    this.names = file.names;
    this.speedClasses = file.speedClasses;

    // Base traversal time in minutes, from OUR congestion-aware speed table.
    // OSMnx's guessed speeds are deliberately not used (section 6.1).
    this.edgeBaseMinutes = new Float64Array(this.edgeCount);
    for (let e = 0; e < this.edgeCount; e++) {
      const speedClass = (this.speedClasses[this.classIdx[e]!] ?? 'other') as RoadClass;
      const kmh = SPEED_KMH[speedClass];
      const km = this.edgeLengthM[e]! / 1000;
      this.edgeBaseMinutes[e] = (km / kmh) * 60;
    }

    // --- build CSR, forward and reverse ---------------------------------
    const outDegree = new Int32Array(this.nodeCount + 1);
    const inDegree = new Int32Array(this.nodeCount + 1);
    for (let e = 0; e < this.edgeCount; e++) {
      outDegree[this.edgeFrom[e]!]!++;
      inDegree[this.edgeTo[e]!]!++;
    }

    this.rowStart = new Int32Array(this.nodeCount + 1);
    this.revRowStart = new Int32Array(this.nodeCount + 1);
    for (let n = 0; n < this.nodeCount; n++) {
      this.rowStart[n + 1] = this.rowStart[n]! + outDegree[n]!;
      this.revRowStart[n + 1] = this.revRowStart[n]! + inDegree[n]!;
    }

    this.rowEdges = new Int32Array(this.edgeCount);
    this.revRowEdges = new Int32Array(this.edgeCount);
    const outCursor = Int32Array.from(this.rowStart.subarray(0, this.nodeCount));
    const inCursor = Int32Array.from(this.revRowStart.subarray(0, this.nodeCount));
    for (let e = 0; e < this.edgeCount; e++) {
      this.rowEdges[outCursor[this.edgeFrom[e]!]!++] = e;
      this.revRowEdges[inCursor[this.edgeTo[e]!]!++] = e;
    }

    this.edgesByWay = new Map();
    for (let e = 0; e < this.edgeCount; e++) {
      const way = this.edgeOsmWayId[e]!;
      const list = this.edgesByWay.get(way);
      if (list) list.push(e);
      else this.edgesByWay.set(way, [e]);
    }
  }

  static fromJson(file: GraphFile): RoadGraph {
    return new RoadGraph(file);
  }

  /** Outgoing edge ids of a node. */
  outEdges(node: number): Int32Array {
    return this.rowEdges.subarray(this.rowStart[node]!, this.rowStart[node + 1]!);
  }

  /** Incoming edge ids of a node. */
  inEdges(node: number): Int32Array {
    return this.revRowEdges.subarray(this.revRowStart[node]!, this.revRowStart[node + 1]!);
  }

  /** Travel time in minutes, accounting for congestion. */
  edgeMinutes(edgeId: number): number {
    return this.edgeBaseMinutes[edgeId]! / this.congestion;
  }

  isClosed(edgeId: number): boolean {
    return this.closed.has(edgeId);
  }

  get closedEdgeIds(): number[] {
    return [...this.closed].sort((a, b) => a - b);
  }

  setCongestion(multiplier: number): void {
    // Guard against a zero or negative multiplier, which would make every
    // route take infinite time or run backwards.
    this.congestion = Math.max(0.05, multiplier);
  }

  getCongestion(): number {
    return this.congestion;
  }

  /** Fastest possible speed, used by the A* heuristic so it never overestimates. */
  get maxSpeedKmhEffective(): number {
    return Math.max(...Object.values(SPEED_KMH)) * Math.max(this.congestion, 1);
  }

  edgeIdsForWay(osmWayId: number): number[] {
    return this.edgesByWay.get(osmWayId) ?? [];
  }

  /**
   * Close a road. By default the whole road (every edge sharing the osmid,
   * both directions); `wholeRoad: false` closes just that segment.
   */
  closeRoad(edgeId: number, wholeRoad = true): number[] {
    const ids = wholeRoad ? this.edgeIdsForWay(this.edgeOsmWayId[edgeId]!) : [edgeId];
    for (const id of ids) this.closed.add(id);
    return ids;
  }

  openRoad(edgeId: number, wholeRoad = true): number[] {
    const ids = wholeRoad ? this.edgeIdsForWay(this.edgeOsmWayId[edgeId]!) : [edgeId];
    for (const id of ids) this.closed.delete(id);
    return ids;
  }

  closeEdges(edgeIds: number[]): void {
    for (const id of edgeIds) this.closed.add(id);
  }

  openEdges(edgeIds: number[]): void {
    for (const id of edgeIds) this.closed.delete(id);
  }

  position(node: number): LatLng {
    return { lat: this.lat[node]!, lng: this.lng[node]! };
  }

  edgeName(edgeId: number): string {
    const idx = this.edgeNameIdx[edgeId]!;
    return idx >= 0 ? (this.names[idx] ?? 'Unnamed road') : 'Unnamed road';
  }

  /**
   * Straight-line distance in metres, equirectangular approximation.
   * Accurate enough at this scale and much cheaper than haversine; the
   * difference is measured in docs/DATA.md.
   */
  distanceM(aNode: number, bNode: number): number {
    return approxDistanceM(
      this.lat[aNode]!,
      this.lng[aNode]!,
      this.lat[bNode]!,
      this.lng[bNode]!,
    );
  }

  /** Nearest graph node to a coordinate. Brute force; fine at 3k nodes. */
  nearestNode(lat: number, lng: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let n = 0; n < this.nodeCount; n++) {
      const d = approxDistanceM(lat, lng, this.lat[n]!, this.lng[n]!);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Interpolate a position a fraction of the way along an edge. */
  positionOnEdge(edgeId: number, fraction: number): LatLng {
    const a = this.edgeFrom[edgeId]!;
    const b = this.edgeTo[edgeId]!;
    const t = Math.min(Math.max(fraction, 0), 1);
    return {
      lat: this.lat[a]! + (this.lat[b]! - this.lat[a]!) * t,
      lng: this.lng[a]! + (this.lng[b]! - this.lng[a]!) * t,
    };
  }
}

// Metres per degree, evaluated for the study area's latitude (about 18.97 N)
// rather than the usual equatorial constants. Derived from the standard
// meridian/parallel series at that latitude.
const METRES_PER_DEGREE_LAT = 110_692;
const METRES_PER_DEGREE_LNG = 111_413;

/**
 * The equirectangular approximation can overestimate true distance slightly on
 * long diagonal spans (measured worst case across this graph is well under 1%;
 * see docs/DATA.md). The A* heuristic must NEVER overestimate or it stops
 * returning optimal routes, so it deflates the straight-line distance by this
 * factor before dividing by the fastest speed.
 */
export const HEURISTIC_SAFETY = 0.98;

export function approxDistanceM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const meanLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const x = (bLng - aLng) * Math.cos(meanLat) * METRES_PER_DEGREE_LNG;
  const y = (bLat - aLat) * METRES_PER_DEGREE_LAT;
  return Math.hypot(x, y);
}

/** True great-circle distance. Used only to check the approximation. */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_008.8;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
