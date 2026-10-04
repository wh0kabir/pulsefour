import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { APIRoute } from 'astro';

import * as assumptions from '../config/assumptions';
import { AREA } from '../config/area';
import graph from '../../public/data/graph.json';
import hospitalFile from '../../public/data/hospitals.json';
import scenario from '../../public/data/scenario-parel.json';

/**
 * /llms-full.txt -- the whole project as plain text, for an agent handed only
 * the deployed URL.
 *
 * Assembled at build time from the committed docs and the live config, so it
 * cannot drift from what the simulation actually runs.
 */

function readDoc(relative: string): string {
  try {
    return readFileSync(join(process.cwd(), relative), 'utf8').trim();
  } catch {
    return `(${relative} not available in this build)`;
  }
}

export const GET: APIRoute = ({ site }) => {
  const base = site?.origin ?? '';

  const hospitalRows = hospitalFile.hospitals
    .map(
      (h) =>
        `  - ${h.name} | beds ${h.beds.total} | ICU ${h.beds.icuTotal} | ` +
        `trauma-capable (simulated): ${h.traumaCapable ? 'yes' : 'no'} | ` +
        `location ${h.provenance.location}, capacity ${h.provenance.capacity}, capability ${h.provenance.capability}`,
    )
    .join('\n');

  const body = `# Pulse - full reference for AI agents

Generated at build time from the committed data and configuration.
Deployed at: ${base || '(unknown origin)'}
Source: https://github.com/wh0kabir/pulsefour

===============================================================================
WHAT THIS IS, AND WHAT IT IS NOT
===============================================================================

Pulse is a decision-support console for a disaster control room. It watches a
SIMULATED mass-casualty event on a REAL map of South Mumbai and recommends
which ambulance goes to which casualty, and which hospital each casualty goes
to. It re-decides every simulated minute as roads close, hospitals fill and new
casualties appear.

Real:
  - The drivable street network, from OpenStreetMap.
  - Hospital locations, from OpenStreetMap.
  - Routing and travel times computed over that real network.

Simulated:
  - Casualties, ambulances, bed counts, ICU counts, supplies.
  - Trauma capability (OpenStreetMap does not record it).
  - Every timing parameter listed in the assumptions register below.

It is NOT a medical device, NOT a diagnosis, and NOT connected to BMC, the 108
ambulance service, or any hospital system. Hospital capacity is read through a
HospitalFeed interface of which the prototype implements a simulated version:
Pulse is designed to consume a capacity feed, it is not connected to one.

The deterioration limits are modelling parameters, NOT clinical thresholds.
Pulse reports only that a casualty waited past the limit it was given. It makes
no claim about lives or clinical outcomes.

===============================================================================
STUDY AREA
===============================================================================

South Mumbai's eastern spine, Fort/CST north to Parel/Chinchpokli.

  min_lat ${AREA.minLat}   max_lat ${AREA.maxLat}
  min_lon ${AREA.minLon}   max_lon ${AREA.maxLon}

Approximately 8.7 km north-south by 3.2 km east-west.

===============================================================================
ARCHITECTURE
===============================================================================

Browser only. No backend, no API keys, no accounts. Static deploy.

  Astro (static) -- one React island -- Zustand UI state
        |
        |  postMessage: commands down, WorldState up
        v
  Web Worker
    engine.ts     1 real second = 1 simulated minute
    astar.ts      A* for the path an ambulance drives
    dijkstra.ts   cached trees for the batch cost matrix
    allocator.ts  Hungarian over ambulance x casualty
    strategies/   pulse, nearest, fcfs
    ledger.ts     SHA-256 hash chain via Web Crypto

The UI never imports simulation code, only shared types and the worker client.
The worker owns all mutable state. src/sim/ is pure TypeScript, no DOM, tested
in Node.

NOTE FOR AGENTS: ${base}/console is a client-side island. Fetching it without
executing JavaScript returns an empty shell. Everything it would show is
described in this file, and the underlying data is fetchable as JSON below.

===============================================================================
HOW THE ALLOCATOR DECIDES
===============================================================================

Every simulated minute, from scratch:

1. Candidates are every non-black casualty without a confirmed ambulance, every
   idle or heading-to-pickup ambulance, and every hospital.

2. A pairing is infeasible if the hospital has no free bed, lacks the supplies
   that severity needs, is not trauma-capable for a red casualty, or if no open
   route exists. Infeasible cells get a large finite value, not infinity.

3. For each ambulance a and casualty c, the best feasible hospital h* minimises
     trip = travel(a->c) + travel(c->h) + loadPenalty(h) + alsPenalty + icuPenalty
   and the matrix cell is
     cost[a][c] = lambda * trip - severityWeight(c) * waitingFactor(c)
   Subtracting the benefit is what lets a distant critical casualty outrank a
   nearby minor one. Dividing by priority would not.

4. The Hungarian algorithm solves the whole board at once, rather than greedily
   assigning the nearest pair first.

5. Capacity conflicts are resolved by reserving beds in descending benefit order
   and re-solving up to three times.

6. Stability: a casualty already aboard keeps its ambulance; an ambulance headed
   to a pickup is only reassigned if the new plan is at least 20% better than
   continuing with its current one, recomputed under current conditions.

7. A casualty that cannot be served is raised to a human as an escalation, never
   dropped silently.

Every decision stores the factors it used (travel times, load penalty, severity
weight, waiting factor, total cost) and the rejected alternatives with reasons.

===============================================================================
MEASURED RESULTS - reported as they come out
===============================================================================

Parel crowd crush, seed ${scenario.seed}, ${scenario.durationMin} simulated minutes. All three
strategies run on the same seed, the same fleet and the same scenario. Both
baselines ignore severity and hospital capacity, as current practice is
described in the research.

  metric                                      pulse   nearest    fcfs
  ------------------------------------------------------------------
  Mean time to ambulance on scene (min)        19.6      25.9    16.0
  Share on scene within 20 min                  57%       25%     85%
  Critical patients who reached a bed         7 of 9    3 of 9  9 of 9
  Mean admission, red (min)                    14.9       9.7    27.3
  Mean admission, yellow (min)                 20.4      22.0    27.6
  Mean admission, green (min)                  38.5      14.3    22.8
  Hospital overload events                        9        26       5
  Waited past their limit                         1         3       0

READ THESE CAREFULLY:

  - First-come-first-served beats Pulse on MEAN RESPONSE TIME. That is not a
    bug. A strategy that ignores severity treats a walking-wounded casualty as
    urgently as a critical one, and green casualties are the most numerous, so
    serving them promptly flatters the average.

  - Nearest-hospital dispatch posts the FASTEST red admission time (9.7 min)
    only because it admits 3 of 9 critical patients and leaves the rest queued
    at a full hospital. Its average is taken over the three it managed. Pulse
    admits 7 of 9. Comparing those means without the counts is misleading.

  - Pulse causes roughly a third of the nearest-hospital baseline's overload
    events, because it is the only one of the three that prices in how full a
    hospital already is.

Reproduce:
  node --import ./scripts/ts-resolve.mjs scripts/compare-report.ts

===============================================================================
ASSUMPTIONS REGISTER - every invented number
===============================================================================

Speeds by road class under congestion (km/h):
${Object.entries(assumptions.SPEED_KMH)
  .map(([k, v]) => `  ${k.padEnd(14)} ${v}`)
  .join('\n')}

Congestion multiplier: ${assumptions.CONGESTION.default} default, ${assumptions.CONGESTION.rain} for rain.
Severity weights: ${Object.entries(assumptions.SEVERITY_WEIGHT).map(([k, v]) => `${k} ${v}`).join(', ')}.
Deterioration limits (min): ${Object.entries(assumptions.DETERIORATION_LIMIT_MIN).map(([k, v]) => `${k} ${v}`).join(', ')}.
Treatment time occupying a bed (min): ${Object.entries(assumptions.TREATMENT_TIME_MIN).map(([k, v]) => `${k} ${v}`).join(', ')}.
Supplies per handover: ${Object.entries(assumptions.SUPPLY_USE).map(([k, v]) => `${k} ${v.bloodUnits} blood / ${v.oxygenUnits} oxygen`).join(', ')}.
Hospital load penalty: 0 min up to ${assumptions.LOAD_PENALTY.freeUpToFraction * 100}% full, rising quadratically to ${assumptions.LOAD_PENALTY.maxPenaltyMin} min at 100%.
Waiting factor: 1 + waitedMin / ${assumptions.WAITING.divisorMin}, capped at ${assumptions.WAITING.cap}.
ALS preference penalty: ${assumptions.ALS_PREFERENCE_PENALTY_MIN} min for a BLS unit carrying a red casualty.
ICU shortage penalty: ${assumptions.ICU_SHORTAGE_PENALTY_MIN} min.
Reassignment margin: ${assumptions.REASSIGNMENT_MARGIN * 100}%.
Fleet: ${assumptions.FLEET.als + assumptions.FLEET.bls} (${assumptions.FLEET.als} ALS, ${assumptions.FLEET.bls} BLS).
Casualty mix: ${Object.entries(assumptions.CASUALTY_MIX).map(([k, v]) => `${v} ${k}`).join(', ')}.
Start-of-run hospital occupancy: ${assumptions.START_OCCUPANCY.min * 100}-${assumptions.START_OCCUPANCY.max * 100}%, seeded.
Response target line: ${assumptions.RESPONSE_TARGET_MIN} min. UNVERIFIED - from team research notes, not a primary source.
Clock: 1 real second = 1 simulated minute at 1x. Speeds ${assumptions.SPEEDS.join('x, ')}x.

===============================================================================
HOSPITALS - ${hospitalFile.meta.hospitalCount} included, ${hospitalFile.meta.traumaCapableCount} modelled trauma-capable
===============================================================================

${hospitalRows}

Curation rule: ${hospitalFile.meta.curationRule}

IMPORTANT: OpenStreetMap does not record trauma capability, and in this study
area its emergency=yes tag is actively misleading (the large teaching hospitals
carry no such tag while a maternity nursing home does). Trauma capability is
therefore MODELLED from building footprint area and labelled simulated. A human
replaces any field with a verified fact in data/hospital-overrides.json.

===============================================================================
DATA FILES (fetch directly)
===============================================================================

${base}/data/graph.json
  Parallel arrays. An edge's array index IS its edgeId, stable across rebuilds.
  nodes: { lat[], lng[], osmId[] }
  edges: { from[], to[], lengthM[], classIdx[], osmWayId[], oneway[], nameIdx[],
           geom[] }   geom is flat [lat,lng,...] interior points, or 0 if straight.
  classes[] is the OSM highway tag; speedClasses[] is our speed class.
  ${graph.meta.nodeCount.toLocaleString()} nodes, ${graph.meta.edgeCount.toLocaleString()} edges, ${graph.meta.component}.

${base}/data/hospitals.json
  { meta, hospitals[] } with per-field provenance on every hospital.

${base}/data/scenario-parel.json
  The demo scenario: casualty waves, fleet, and scripted events.

${base}/data/sample-state.json
  A frozen WorldState in the exact shape the UI renders each tick.

===============================================================================
APPENDED PROJECT DOCUMENTATION
===============================================================================

--- README.md ---

${readDoc('README.md')}

--- docs/ASSUMPTIONS.md ---

${readDoc('docs/ASSUMPTIONS.md')}

--- docs/DECISIONS.md ---

${readDoc('docs/DECISIONS.md')}

--- docs/DATA.md ---

${readDoc('docs/DATA.md')}

--- NOTICE.md ---

${readDoc('NOTICE.md')}
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
};
