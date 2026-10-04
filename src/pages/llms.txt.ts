import type { APIRoute } from 'astro';

import graph from '../../public/data/graph.json';
import hospitalFile from '../../public/data/hospitals.json';
import scenario from '../../public/data/scenario-parel.json';

/**
 * /llms.txt -- the index an AI agent reads first (llmstxt.org convention).
 *
 * The console is a client-side island, so fetching /console without running
 * JavaScript returns an empty shell. This file, and /llms-full.txt, are how
 * an agent actually learns what this project is and where the data lives.
 *
 * Generated from the committed data, so the numbers cannot drift.
 */
export const GET: APIRoute = ({ site }) => {
  const base = site?.origin ?? '';
  const u = (path: string) => `${base}${path}`;

  const body = `# Pulse

> A control-room decision-support console for a mass-casualty event. It
> recommends which ambulance goes to which casualty and which hospital each
> casualty goes to, re-deciding every simulated minute as roads close and
> hospitals fill. Every recommendation is explained and every decision is
> written to a tamper-evident log.

Pulse is a **simulation**. The street network and hospital locations are real,
extracted from OpenStreetMap for South Mumbai's eastern spine
(${graph.meta.nodeCount.toLocaleString()} junctions, ${graph.meta.edgeCount.toLocaleString()} road segments,
${hospitalFile.meta.hospitalCount} hospitals). Casualties, ambulances, bed counts and supplies are
simulated and labelled as such. It is not a medical device, not a diagnosis,
and not connected to BMC, the 108 ambulance service or any hospital system.

Routing is A* over the real road graph with cached Dijkstra trees for batch
costs. Allocation solves an ambulance-by-casualty cost matrix with the
Hungarian method, so severity can outrank proximity. The audit trail is a
SHA-256 hash chain verified against a separately pinned checkpoint.

## Pages

- [Landing](${u('/')}): the pitch, and what is real versus simulated.
- [About](${u('/about')}): how the allocator works, the full assumptions register, data sources and limits. Server-rendered and readable without JavaScript.
- [Console](${u('/console')}): the live product. A client-side React island, so fetching it without a browser returns an empty shell. Read [llms-full.txt](${u('/llms-full.txt')}) instead.

## For agents

- [llms-full.txt](${u('/llms-full.txt')}): everything below in one file, including the full assumptions register, the data schema and the measured results.

## Data (static JSON, fetchable directly)

- [graph.json](${u('/data/graph.json')}): the road network. Parallel arrays; an edge's index is its edgeId. ${graph.meta.nodeCount.toLocaleString()} nodes, ${graph.meta.edgeCount.toLocaleString()} edges, largest strongly connected component.
- [hospitals.json](${u('/data/hospitals.json')}): ${hospitalFile.meta.hospitalCount} hospitals, ${hospitalFile.meta.traumaCapableCount} modelled trauma-capable. Locations from OpenStreetMap; capacity and capability simulated.
- [scenario-parel.json](${u('/data/scenario-parel.json')}): the demo scenario. ${scenario.casualtySchedule.reduce((n, w) => n + w.count, 0)} casualties over ${scenario.casualtySchedule.length} waves, fleet of ${scenario.fleet.als + scenario.fleet.bls}, ${scenario.durationMin} simulated minutes.
- [sample-state.json](${u('/data/sample-state.json')}): a frozen WorldState snapshot in the exact shape the UI renders.

## Source

- [Repository](https://github.com/wh0kabir/pulsefour)

## Attribution

Map data (c) OpenStreetMap contributors, available under the Open Database
Licence: https://www.openstreetmap.org/copyright
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
};
