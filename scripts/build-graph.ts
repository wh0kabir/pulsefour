/**
 * Build the compact browser road graph.
 *
 * CLAUDE.md section 6.1:  data/raw/roads.json  ->  public/data/graph.json
 *
 *     node scripts/build-graph.ts
 *
 * What this stage does:
 *   * Reindexes OSM node ids to dense integers 0..n-1, so the router can use
 *     typed arrays.
 *   * Gives every edge a stable integer edgeId. Stability comes from sorting
 *     the input deterministically, so a rebuild produces identical ids and a
 *     saved scenario does not silently point at a different road.
 *   * Rounds coordinates to 5 decimal places (about 1 metre) and lengths to
 *     1 decimal place.
 *   * Dictionary-encodes road classes and street names, which are massively
 *     repeated.
 *   * Keeps the OSM way id on every edge, because closing "a road" means
 *     closing every edge that shares an osmid (section 8).
 *
 * Speeds are NOT baked in here. They come from the congestion-aware table in
 * src/config/assumptions.ts at runtime, so changing an assumption does not
 * require regenerating the data.
 */

import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { roadClassOf } from '../src/config/assumptions.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN_JSON = join(ROOT, 'data', 'raw', 'roads.json');
const OUT_JSON = join(ROOT, 'public', 'data', 'graph.json');

const COORD_DP = 5;

interface RawNode {
  osmId: number;
  lat: number;
  lng: number;
}

interface RawEdge {
  fromOsmId: number;
  toOsmId: number;
  lengthM: number;
  highway: string;
  osmWayId: number | string | null;
  oneway: boolean;
  name: string | null;
  bridge: string | null;
  tunnel: string | null;
  layer: string | null;
  interior: [number, number][] | null;
}

interface RawFile {
  meta: Record<string, unknown>;
  nodes: RawNode[];
  edges: RawEdge[];
}

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function main(): void {
  const raw = JSON.parse(readFileSync(IN_JSON, 'utf8')) as RawFile;

  // --- nodes: deterministic order, dense indices -------------------------
  const nodes = [...raw.nodes].sort((a, b) => a.osmId - b.osmId);
  const indexByOsmId = new Map<number, number>();
  nodes.forEach((node, i) => indexByOsmId.set(node.osmId, i));

  // --- edges: deterministic order so edgeIds are stable ------------------
  const edges = [...raw.edges].sort(
    (a, b) =>
      a.fromOsmId - b.fromOsmId ||
      a.toOsmId - b.toOsmId ||
      String(a.osmWayId).localeCompare(String(b.osmWayId)),
  );

  const classes: string[] = [];
  const classIndex = new Map<string, number>();
  const names: string[] = [];
  const nameIndex = new Map<string, number>();

  function internClass(value: string): number {
    const existing = classIndex.get(value);
    if (existing !== undefined) return existing;
    const i = classes.length;
    classes.push(value);
    classIndex.set(value, i);
    return i;
  }

  function internName(value: string): number {
    const existing = nameIndex.get(value);
    if (existing !== undefined) return existing;
    const i = names.length;
    names.push(value);
    nameIndex.set(value, i);
    return i;
  }

  const from: number[] = [];
  const to: number[] = [];
  const lengthM: number[] = [];
  const classIdx: number[] = [];
  const osmWayId: number[] = [];
  const oneway: number[] = [];
  const nameIdx: number[] = [];
  const geom: (number[] | 0)[] = [];

  let skipped = 0;

  for (const edge of edges) {
    const fromIdx = indexByOsmId.get(edge.fromOsmId);
    const toIdx = indexByOsmId.get(edge.toOsmId);
    // Cannot happen with a strongly connected component, but never emit a
    // dangling edge: the router would read undefined as node 0.
    if (fromIdx === undefined || toIdx === undefined) {
      skipped++;
      continue;
    }

    from.push(fromIdx);
    to.push(toIdx);
    lengthM.push(round(edge.lengthM, 1));
    classIdx.push(internClass(edge.highway));
    // osmid can be a string when OSM ways were merged; keep the first number.
    osmWayId.push(Number(String(edge.osmWayId).split(',')[0]) || 0);
    oneway.push(edge.oneway ? 1 : 0);
    nameIdx.push(edge.name ? internName(edge.name) : -1);

    if (edge.interior && edge.interior.length > 0) {
      const flat: number[] = [];
      for (const [lat, lng] of edge.interior) {
        flat.push(round(lat, COORD_DP), round(lng, COORD_DP));
      }
      geom.push(flat);
    } else {
      geom.push(0);
    }
  }

  if (skipped > 0) console.warn(`warning: skipped ${skipped} dangling edge(s)`);

  // Road class per edge for SPEED lookups, resolved once here through the
  // single mapping in src/config/assumptions.ts.
  const speedClasses = classes.map(roadClassOf);

  const graph = {
    meta: {
      generated: new Date().toISOString(),
      source: 'OpenStreetMap via OSMnx',
      osmnxVersion: raw.meta['osmnxVersion'],
      component: 'largest strongly connected',
      nodeCount: nodes.length,
      edgeCount: from.length,
      coordDecimalPlaces: COORD_DP,
      attribution: 'Map data © OpenStreetMap contributors, ODbL',
      licence: 'https://www.openstreetmap.org/copyright',
    },
    /** OSM highway tag per class index, for map colouring. */
    classes,
    /** Our speed class per class index, for routing. */
    speedClasses,
    /** Street names; edges index into this, -1 means unnamed. */
    names,
    nodes: {
      lat: nodes.map((n) => round(n.lat, COORD_DP)),
      lng: nodes.map((n) => round(n.lng, COORD_DP)),
      osmId: nodes.map((n) => n.osmId),
    },
    /** Parallel arrays. The array index IS the edgeId. */
    edges: { from, to, lengthM, classIdx, osmWayId, oneway, nameIdx, geom },
  };

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  const json = JSON.stringify(graph);
  writeFileSync(OUT_JSON, json, 'utf8');

  const rawBytes = statSync(OUT_JSON).size;
  const gzBytes = gzipSync(Buffer.from(json)).length;

  console.log(`nodes:        ${graph.meta.nodeCount}`);
  console.log(`edges:        ${graph.meta.edgeCount}`);
  console.log(`classes:      ${classes.length} (${classes.join(', ')})`);
  console.log(`street names: ${names.length}`);
  console.log(`curved edges: ${geom.filter((g) => g !== 0).length}`);
  console.log(`\nwrote public/data/graph.json`);
  console.log(`  raw:      ${(rawBytes / 1024).toFixed(0)} KB`);
  console.log(`  gzipped:  ${(gzBytes / 1024).toFixed(0)} KB`);
}

main();
