# Pulse: build specification for Claude Code

Put this file in the repository root as `CLAUDE.md`. It is the single source of truth for what to build, why, and how to work. Read all of it before writing code.

---

## 0. How to work on this project

These rules apply for the whole build.

1. **This file wins.** If the code and this spec disagree, say so and ask the human which is right. If you change a locked decision (section 3), edit section 3 and add a line to `docs/DECISIONS.md`.
2. **Work milestone by milestone** (section 17). For each milestone: state a short plan, write the tests first or alongside, build it, run the quality gates, commit, push.
3. **Never invent real-world facts.** Do not type hospital coordinates, bed counts, ICU counts, trauma capability, road names or incident details from memory. Fetch them from OpenStreetMap or mark them as simulated. The only coordinates in this file are the study area box, and a sanity-check point for CST.
4. **Every invented number is an assumption.** Put it in a config file (never a magic number in code) and add a row to `docs/ASSUMPTIONS.md`. Section 7 seeds that table.
5. **Do not rig the demo.** All three strategies (Pulse and the two baselines) run on the same seed, the same fleet and the same scenario. If Pulse does not beat the baselines on a metric, report that honestly and investigate. Do not quietly tune the scenario until it wins.
6. **Ask before you:** create the GitHub repo, pick a licence, push to `main`, add a dependency not listed here, or change a locked decision. Ask the human to confirm the hospital list after it is fetched and the incident location after it is resolved.
7. **No secrets exist in this project.** No API keys, no backend, no accounts. If you find yourself needing one, stop and ask.
8. **Keep the simulation engine pure.** `src/sim/` has no DOM, no React, no browser globals other than Web Crypto and `postMessage`. It must be testable in Node.
9. **Boring and small beats clever.** No speculative abstractions. Plain TypeScript, strict mode on.
10. **Keep the honesty banner honest.** Section 15 lists exactly what the interface must say about real versus simulated data. Never weaken it.

---

## 1. What Pulse is

**Pulse is a decision-support console for a disaster control room.** It watches a simulated mass-casualty event on a real map of South Mumbai and recommends which ambulance goes to which casualty, and which hospital each casualty goes to. It re-decides every simulated minute as roads close, hospitals fill and new casualties appear. Every recommendation is explained, every decision is written to a tamper-evident log, and a human operator approves or overrides.

**One-line pitch:** A control-room tool that stops mass-casualty patients all going to the nearest hospital, shows its reasoning, and keeps a record nobody can quietly edit.

### The real-world problem (from team research, qualitative)

- Emergency medical response in Mumbai is split across several bodies: the 108 ambulance service (MEMS), BMC disaster-management control rooms, public and private hospitals, and police and fire.
- Research found no formal, central process for matching patients to hospitals in a mass-casualty event. The choice is made by proximity and informal knowledge. This is inferred from incident studies and news reports, not from an official document.
- Live hospital bed counts are not known to be published in real time to ambulances. Government dashboards exist, but an open, documented API for our hospitals has **not** been proved.
- Past incidents (the 2008 attacks, the 2017 Elphinstone Road footbridge stampede, the 2019 CSMT footbridge collapse) show casualties going to the nearest hospitals while others stayed underused.

Do not put casualty counts or per-hospital numbers from the research notes on the public site until a human has verified them. Keep public copy qualitative. One known error in the notes: KEM is a BMC municipal hospital, not a private one.

### Who it is for

Control-room coordinators (BMC disaster management cell, ward control rooms), 108 dispatch supervisors, medical incident commanders at a scene, and hospital emergency staff or nodal officers who need advance notice. It is not for the general public.

### What it is not

Not a diagnostic tool or medical device (it is screening and dispatch decision support). Not connected to any real BMC, 108 or hospital system. Not a blockchain. Not a game, even though the demo has buttons that break things; those buttons stand in for real-world data feeds.

---

## 2. Origin and context

Pulse began as a pitch for **Elevate 1.0 (DJ Sanghvi College of Engineering), problem statement EL-02: "Intelligent and Transparent Disaster Relief Resource Allocation."** It is now a standalone public side project and portfolio piece. The Elevate offline round uses different problem statements, so nothing here depends on Elevate.

The EL-02 brief is still a useful checklist. Map it like this:

| EL-02 asks for | Where Pulse delivers it |
| --- | --- |
| Dynamic allocation that adapts, not nearest-hospital or first-come-first-served | Section 9 (re-planning allocator) and the comparison screen |
| Model severity, hospital capacity, resources, road access, travel time | Sections 7, 8, 9 |
| Show decisions changing as demand, infrastructure or resources change | Scenario panel plus the decision feed (section 13) |
| Transparent, verifiable tracking of resources from allocation to distribution | Section 11 (hash-chained ledger) |
| Architecture, working prototype, visualisation, tracking demo | Sections 5 to 13 |

---

## 3. Locked decisions

These were decided by the project owner. Do not change them without asking.

| # | Decision | Value |
| --- | --- | --- |
| 1 | Study area | Extended box, section 4 |
| 2 | Main demo scenario | Crowd crush at Parel (in the style of the 2017 Elphinstone Road footbridge stampede). Road closure and a full hospital are the follow-up twists |
| 3 | Allocation method | Hungarian method over ambulance-by-casualty costs, with capacity checks (section 9) |
| 4 | Audit trail | SHA-256 hash chain, tamper-evidence only, verified against a separately pinned checkpoint (section 11) |
| 5 | Triage standard | START colours: red, yellow, green, black. No invented severity scale |
| 6 | Human in the loop | System suggests, operator confirms, with an auto-accept toggle |
| 7 | Two control surfaces | An **Operator** panel (real actions) and a **Scenario** panel (simulated world events), always separate |
| 8 | Time | 1 real second = 1 simulated minute. Pause, 1x, 2x, 4x |
| 9 | Supplies | In scope: blood units and oxygen units |
| 10 | Funds | Out of v1. The ledger is built so money can be added later as another record type |
| 11 | Architecture | Browser only. No backend. Static deploy |
| 12 | Stack | Astro, Tailwind 4, one React island, TypeScript simulation in a Web Worker |
| 13 | Map | Real Mumbai streets from OpenStreetMap, our own saved road network, our own routing |
| 14 | Repo | Public GitHub repo, committed to by Claude Code (section 16) |
| 15 | Design | Matte black, animated icy blue gradients (section 14) |

---

## 4. Study area

South Mumbai's eastern spine, from the Fort and CST area in the south up to Parel and Chinchpokli in the north. The southern edge was extended from the original box so that CST, Fort, St George, GT and Cama fall inside it, and so the Parel scenario sits among a cluster of hospitals.

```
Bounding box (WGS84 / EPSG:4326)
min_lat = 18.930000     max_lat = 19.008228
min_lon = 72.820000     max_lon = 72.850000

Overpass order (S,W,N,E):  18.930000,72.820000,19.008228,72.850000
OSMnx 2.x bbox tuple (W,S,E,N): (72.820, 18.930, 72.850, 19.008228)
Leaflet/MapLibre bounds (W,S,E,N): [[72.820, 18.930], [72.850, 19.008228]]
Approx size: 8.7 km north-south by 3.2 km east-west. Centre: 18.969114, 72.835000
```

Sanity check only (do not use as data): CST is at roughly 18.9398 N, 72.8355 E per the team research and should fall inside the box.

Put the box in one config file (`src/config/area.ts`) and read it everywhere. First data task: run the hospital query for both this box and the original northern box (south edge 18.961517), and record both counts in `docs/DATA.md`. Use this extended box regardless, but the numbers are useful to the README.

---

## 5. Architecture

### Stack

- **Astro** (static output) with **Tailwind CSS 4**. The human is initialising the Astro project. Set up Tailwind 4 using the current official Astro and Tailwind docs, not memory (it uses the Vite plugin).
- **One React island** (`@astrojs/react`) for the console.
- **MapLibre GL JS** for the map. Base map is **our own data on a plain matte black background**, no raster tiles required. An optional dark-tile toggle is allowed but off by default, so the demo works with no network.
- **TypeScript, strict mode.**
- **Simulation, routing, allocation and ledger** run in a **Web Worker**.
- **Zustand** for UI state. **Vitest** for tests. A small chart approach for the comparison screen (hand-rolled SVG or a light library; no heavy dependencies).
- **Self-hosted fonts** via Fontsource so nothing loads from a CDN (verify package names when installing).
- Optional one-off Python scripts for data extraction (OSMnx). Python is a build-time tool, never a runtime dependency.

### Why browser only

It deploys anywhere static, costs nothing, has no cold starts or keys, and anyone who clones the repo gets a working thing. The only cost is keeping the road file small.

### Repository layout

```
pulse/
  CLAUDE.md                     this file
  README.md                     see section 16
  LICENSE                       ask the human which
  NOTICE.md                     OpenStreetMap / ODbL attribution
  package.json  astro.config.mjs  tsconfig.json
  .github/workflows/ci.yml      typecheck, lint, test, build
  scripts/
    extract-roads.py            OSMnx -> data/raw/roads.graphml
    build-graph.ts              graphml -> public/data/graph.json
    fetch-hospitals.py          Overpass -> data/hospitals.raw.json
    build-hospitals.ts          raw + overrides -> public/data/hospitals.json
    report-sizes.mjs            node/edge counts, raw and gzipped sizes
    requirements.txt            pinned Python deps (use a venv)
  data/
    raw/                        raw OSM extracts (see size note in section 16)
    hospital-overrides.json     human-verified facts, edited by hand
  public/data/
    graph.json  hospitals.json  scenario-parel.json  sample-state.json
  src/
    config/    area.ts  assumptions.ts  design-tokens.ts
    sim/       types.ts  rng.ts  graph.ts  astar.ts  dijkstra.ts  hungarian.ts
               allocator.ts  strategies/ (pulse.ts nearest.ts fcfs.ts)
               engine.ts  scenario.ts  metrics.ts  ledger.ts  worker.ts
    ui/        console/  map/  panels/  compare/  ledger/  landing/  about/
               state/    worker-client.ts
    pages/     index.astro  console.astro  about.astro
    styles/    global.css
  docs/        DECISIONS.md  ASSUMPTIONS.md  DATA.md  HOSPITAL_REVIEW.md
  tests/       (mirrors src/sim)
```

### Boundaries (the contract that keeps pieces independent)

- The **UI never imports simulation code**, only types from `src/sim/types.ts` and the `worker-client`. It renders whatever `WorldState` the worker sends.
- The **worker owns all mutable state.** The UI sends commands; the worker emits state.
- Build the UI first against `public/data/sample-state.json` (a frozen snapshot with fake data in the exact `WorldState` shape). The engine then replaces that file as the data source.

### Worker protocol

```ts
// UI -> worker
type WorkerCommand =
  | { type: 'init'; scenarioId: string; seed?: number }
  | { type: 'play' } | { type: 'pause' }
  | { type: 'setSpeed'; speed: 1 | 2 | 4 }
  | { type: 'inject'; event: ScenarioEvent }          // Scenario panel
  | { type: 'operator'; action: OperatorAction }      // Operator panel
  | { type: 'setAutoAccept'; value: boolean }
  | { type: 'reset'; seed?: number }
  | { type: 'runComparison' }
  | { type: 'pinCheckpoint' }
  | { type: 'verifyLedger' }
  | { type: 'demoTamper'; mode: 'edit-row' | 'rewrite-chain'; seq: number } // demo tools only

// worker -> UI
type WorkerEvent =
  | { type: 'state'; state: WorldState }
  | { type: 'ledger'; records: LedgerRecord[] }       // appended since last message
  | { type: 'comparison'; results: StrategyResult[] }
  | { type: 'verify'; result: VerifyResult }
  | { type: 'error'; message: string };
```

---

## 6. Data pipeline

All three data jobs run once, offline, and their outputs are committed so nobody has to re-run them. The Overpass service is a shared public resource: cache results, do not hammer it. If it is unreachable, stop and tell the human.

### 6.1 Road network

- Pull the drivable network for the box with OSMnx (`network_type="drive"`). The bbox argument format changed between OSMnx versions (2.x takes one tuple, west, south, east, north). Check the installed version's docs.
- Keep only the **largest strongly connected component**, so no ambulance is ever stranded on an island.
- Keep the OSM way id (`osmid`) on every edge. Closing "a road" later means closing every edge that shares an osmid.
- Check flyovers and bridges (`bridge`, `layer` tags). A road under a flyover must not be joined to it. Verify the extracted network does not create false junctions and note what you found in `docs/DATA.md`.
- Spot-check one-way streets against a real map.
- **Speeds:** do not use OSMnx's guessed speeds (they assume free-flowing traffic). Apply the congestion-aware table in section 7.4 by road type.
- Write the compact browser file `public/data/graph.json`: node positions, and per edge: from, to, length in metres, road class, osmid, one-way flag, name, and enough geometry to draw curves. Round coordinates to 5 decimal places. Document the exact schema in `docs/DATA.md`.
- **Size:** measure node count, edge count, raw size and gzipped size at each stage with `scripts/report-sizes.mjs`. Aim for well under a couple of megabytes gzipped (a target, not a rule). Shrink in this order: drop unused fields, round coordinates, compact arrays. Only if still too large, drop minor service roads, and warn that this reduces alternate routes.
- Every edge gets a stable integer `edgeId`.

### 6.2 Hospitals

- Query Overpass for `amenity=hospital` (and `healthcare=hospital`) inside the box. Use the centroid for areas. Record OSM id, name, coordinates and any tags present (`emergency`, `beds`, `operator`, `healthcare:speciality`).
- Write `data/hospitals.raw.json` and generate `docs/HOSPITAL_REVIEW.md`: a checklist table of every result with a verify column. **Stop and ask the human to review it** before building the curated file. Some results will be clinics or closed facilities.
- `data/hospital-overrides.json` holds what humans verify:

```json
{
  "<osmId>": {
    "include": true,
    "traumaCapable": true,
    "icu": true,
    "beds": { "total": 0, "icu": 0 },
    "sourceUrl": "",
    "verifiedOn": "",
    "notes": ""
  }
}
```

- `build-hospitals.ts` merges raw plus overrides into `public/data/hospitals.json`, snaps each hospital to its nearest graph node (in the connected component), and tags every field's provenance: `location: 'osm'`, and each capacity or capability field as `'verified'` or `'simulated'`.
- **Defaults when nothing is verified (all labelled simulated):** total beds from the OSM `beds` tag if present, otherwise a tiered placeholder; ICU beds around 8 percent of total; `traumaCapable` true only for hospitals tagged `emergency=yes`. Start-of-run occupancy is seeded random between 25 and 45 percent.
- **If fewer than 3 hospitals qualify as trauma-capable, stop and ask the human.** Do not guess names.
- Capacity fields are kept separate and never merged: total beds, available beds, ICU beds, trauma capability, supplies.

### 6.3 Scenario file

`public/data/scenario-parel.json`:

```ts
interface Scenario {
  id: string; name: string; seed: number; durationMin: number;
  incident: { name: string; query?: string; nodeId?: number; lat?: number; lng?: number };
  casualtySchedule: { atMin: number; count: number;
                      severityMix: { red: number; yellow: number; green: number; black: number };
                      spreadM: number }[];
  fleet: { als: number; bls: number; startPositions: 'hospitals' | number[] };
  scriptedEvents?: { atMin: number; caption: string; event: ScenarioEvent }[]; // guided demo
}
```

- Resolve the incident location (the footbridge between Elphinstone Road and Parel stations) through OpenStreetMap, then **show the human the resolved point and ask them to confirm** before saving it.
- Starting values (all assumptions): about 36 casualties over about 15 simulated minutes in 3 waves, mixed roughly 7 red, 14 yellow, 13 green and 2 black; a fleet of 14 (5 ALS, 9 BLS) starting at hospitals. The fleet is deliberately smaller than the casualty load. Scarcity is the point.
- Scripted guided-demo twists (optional but recommended): a main approach road closes around minute 12, the nearest large hospital fills around minute 20, a second surge around minute 28.

---

## 7. Simulation model

### 7.1 Clock

One tick every 1000 ms of real time at 1x equals one simulated minute. At 2x or 4x the real interval shrinks. Pause freezes everything. All randomness comes from a seeded generator (`mulberry32` or similar) so a run with the same seed is exactly reproducible. The UI interpolates ambulance positions between ticks so motion looks smooth at 60 fps.

### 7.2 Entities

| Entity | What it carries |
| --- | --- |
| Casualty | id, severity (START colour), position and nearest node, time appeared, status, assigned ambulance and hospital, minutes waited, deterioration limit |
| Ambulance | id, kind (BLS or ALS), status, position as (edge, fraction along edge), current route, patient, destination hospital |
| Hospital | id, name, position and node, trauma flag, ICU flag, beds (total, available, ICU total, ICU available), supplies (blood units, oxygen units), per-field provenance, ED queue |
| Road edge | id, from, to, length, class, osmid, one-way, base speed, closed flag |
| Supply | blood units and oxygen units held per hospital |

### 7.3 What happens every tick

1. Ambulances advance along their routes at the current effective speed.
2. Every waiting casualty's `waitedMin` increases. A casualty past their limit is marked `adverse`.
3. Patients in hospital finish treatment after their treatment time, freeing a bed.
4. Handovers that were queued because a hospital was full complete when a bed frees.
5. Scheduled casualties from the scenario appear.
6. Scripted events fire (guided demo only).
7. The active strategy allocates (section 9). Decisions go to the ledger.
8. Metrics update. State is posted to the UI.

### 7.4 Assumptions seed (copy into `docs/ASSUMPTIONS.md` and `src/config/assumptions.ts`)

Every row below is an invented simulation parameter, not a fact. The UI labels them as assumptions.

| Parameter | Starting value | Notes |
| --- | --- | --- |
| Effective ambulance speed by road class under congestion (km/h) | motorway/trunk 45, primary 35, secondary 28, tertiary 22, residential 18, other 12 | Conservative; Mumbai traffic is not free-flowing |
| Scenario congestion multiplier | 1.0 default, 0.7 for a rain scenario | Applies to all speeds |
| Severity weights (priority) | red 100, yellow 40, green 10 | Black is never allocated |
| Deterioration limit before an adverse outcome (min) | red 45, yellow 90, green 240 | **Not a medical claim.** Research found no sound hard golden-hour threshold. Say "waited past limit", never "died" |
| Treatment time occupying a bed (min) | red 180, yellow 90, green 30 | |
| Supplies consumed on handover | red: 2 blood, 2 oxygen; yellow: 1 oxygen; green: none | |
| Hospital load penalty | 0 minutes up to 60% full, rising quadratically to 20 minutes at 100% | A cost that steers patients away from nearly-full hospitals |
| Waiting factor | `1 + waitedMin / 30`, capped at 3 | Stops low-severity patients being ignored forever |
| ALS preference | A BLS ambulance carrying a red patient adds a 5-minute equivalent penalty | Soft, not a hard rule |
| Reassignment margin | 20 percent | Section 9.5 |
| Fleet | 14 (5 ALS, 9 BLS) | |
| Casualty mix | 7 red, 14 yellow, 13 green, 2 black | |
| Start-of-run hospital occupancy | 25 to 45 percent, seeded | |
| Response target line | 20 minutes (the 108 service's stated urban average per team research) | Verify before claiming publicly |

### 7.5 Triage (START)

Use START colours as the severity scale so responders and judges recognise it. Red (immediate): needs rapid transport to a trauma-capable hospital. Yellow (delayed): moderate injury, stable. Green (minor): walking wounded. Black (deceased or expectant): shown on the map, counted separately, **never dispatched**, excluded from response-time metrics.

Never rely on colour alone: each marker also carries a letter (R, Y, G, B) and a distinct shape.

---

## 8. Routing

### Algorithms

- **A\*** for single point-to-point routes (the path an ambulance actually follows). Cost is travel minutes. The heuristic is straight-line distance to the goal divided by the fastest speed in the table, which never overestimates the true remaining time. Use a flat-map (equirectangular) distance approximation, which is accurate enough at this scale. Test it against haversine on sample pairs and note the difference in `docs/DATA.md`.
- **Dijkstra trees for batch costs.** The allocator needs travel times from every ambulance to every casualty, and from every casualty to every hospital. Do not run hundreds of A\* queries per tick. Run one forward Dijkstra from each ambulance and one reverse Dijkstra into each hospital, then read costs from those trees. Cache the hospital trees and invalidate them only when a road opens or closes or congestion changes. Use typed arrays and a binary heap.

### Closing roads

- Never edit the graph. Keep a `closedEdgeIds` set; the search skips any edge in it. Opening a road removes it from the set. Nothing is rebuilt.
- The operator picks a road by clicking a segment. **Default:** close the whole road (every edge sharing that osmid, both directions). A toggle offers "this segment only".
- **Unreachable is a normal answer.** Routing returns `null` for no route, never throws or loops. The allocator uses that to disqualify an option.
- **Ambulance already on a closing road:** it may finish its current edge and is re-routed from the next junction. If the edge is two-way it may also turn back from its current position, whichever is quicker. Document the rule you implement.

---

## 9. Allocation

This is the heart of the project. The allocator runs every tick on the current world state and decides again from scratch, with stability rules in 9.5.

### 9.1 Inputs and eligibility

Candidates: every casualty that is not black and has no confirmed ambulance, every ambulance that is idle or only heading to a pickup, every hospital. A pairing of ambulance `a`, casualty `c` and hospital `h` is **infeasible** if any of these is true:

- `h` has no available bed, or lacks the supplies the casualty needs (section 7.4).
- `c` is red and `h` is not trauma-capable.
- No open route exists from `a` to `c`, or from `c` to `h`.
- The casualty's remaining margin before their deterioration limit is already negative for any route. In that case do not silently drop them: raise an **escalation** (9.6).

### 9.2 Cost matrix

For each ambulance `a` and casualty `c`, find the best feasible hospital `h*` by lowest

```
trip(a, c, h) = travel(a -> c) + travel(c -> h) + loadPenalty(h) + alsPenalty(a, c) + icuShortagePenalty(c, h)
```

Then fill the matrix cell with a net-cost value:

```
benefit(c) = severityWeight(c) * waitingFactor(c)
cost[a][c] = lambda * trip(a, c, h*) - benefit(c)        // lambda = 1 to start
```

Infeasible cells get a large finite value `M`. Subtracting benefit is what makes a distant red casualty beat a nearby yellow one, which dividing by priority would not.

### 9.3 Solve

Run the **Hungarian algorithm** on the rectangular matrix (pad with dummy rows or columns). Write it yourself (about 60 lines), no dependency. Any assignment with cost at or above `M` is not a real assignment: that casualty is unservable (9.6).

### 9.4 Capacity conflicts

Several chosen pairs may pick the same last bed. Resolve in descending `benefit` order: reserve a bed for the highest-benefit pair, and for any pair whose hospital is now full, recompute that pair's best remaining hospital. Repeat the solve up to 3 times with updated capacities, then fall back to sequential resolution. Reservations are released if a decision is rejected.

### 9.5 Stability rules (stops flip-flopping)

1. A casualty already on board stays with their ambulance. The destination hospital may change.
2. An ambulance heading to a pickup is only reassigned if the new plan's cost is at least 20 percent better than its current plan.
3. Every reassignment records a plain-English reason, for example "Ambulance 3 rerouted: Link Road closed, new route adds 9 minutes; Ambulance 5 is now 11 minutes closer."

### 9.6 Escalations

When a casualty cannot be served, they go to the top of the feed as an escalation with the reason (no route, no feasible hospital, will pass their limit). The operator chooses: hold, force-dispatch to a chosen hospital, or mark handled. Never drop a casualty silently.

### 9.7 Explanations

Every decision stores a `factors` object: travel to casualty, travel to hospital, load penalty, severity weight, waiting factor, total cost, the best two alternatives, and why each was rejected ("St George: no beds", "route blocked at X"). The UI renders this as a "why" card. Every number shown is a number the allocator actually used.

### 9.8 Baselines (for the comparison screen)

Both baselines ignore severity and trauma capability by design, as the research describes current practice. Same seed, fleet and scenario as Pulse.

- **Nearest:** repeatedly take the closest ambulance-casualty pair; destination is the nearest hospital by travel time, **ignoring capacity**. A casualty arriving at a full hospital waits in its ED queue until a bed frees, so overload shows up as delay.
- **First come, first served:** casualties in arrival order; each gets the nearest free ambulance; destination is the nearest hospital **that has a free bed**.

### 9.9 Metrics (computed for all three strategies)

- Mean time from casualty appearing to ambulance on scene, plus the share within the 20-minute target line.
- Share of red casualties delivered to a trauma-capable hospital.
- Mean time to hospital admission, by severity.
- Hospital overload events (arrivals at a hospital with no free bed) and peak hospital load.
- Casualties who waited past their limit; casualties unserved at the end.
- Spread of load across hospitals (standard deviation of load fractions).

---

## 10. Operator panel versus Scenario panel

Keep these two surfaces visibly and structurally separate. It answers the judge's first question before they ask it: what would be real, and what is simulated?

### Operator (real actions a dispatcher takes)

- Confirm a suggested assignment.
- Override it (choose a different ambulance or hospital).
- Reject it.
- Resolve an escalation (hold, force-dispatch, mark handled).
- Toggle **auto-accept**. Default **on** for the demo, with a prominent toggle. When off, ambulances wait for confirmation and the pending queue shows a count.

Decision lifecycle: `suggested -> confirmed | overridden | rejected -> en route -> on scene -> transporting -> handed over`. In auto-accept, the confirmation is still logged, with actor `system-auto`.

### Scenario (simulated world events, labelled "Inject event")

| Event | Effect |
| --- | --- |
| Close or open a road | Edges added to or removed from the closed set |
| Fill a hospital | Available beds drop to a chosen number, often zero |
| Surge | A batch of new casualties appears in an area |
| Take an ambulance offline or back online | Its patient returns to the pool |
| Resupply a hospital | Blood and oxygen units increase |
| Set congestion | Applies the speed multiplier |

In a real deployment these would arrive from traffic data, hospital systems and emergency calls. The panel's footer says so.

---

## 11. Ledger

A hash-chained, append-only log of every meaningful event. It gives **tamper-evidence**, not tamper-proofing, and it does not prove the inputs were true.

### Record

```ts
interface LedgerRecord {
  seq: number;                 // starts at 0
  simMin: number;
  type: 'casualty_registered' | 'assignment_suggested' | 'assignment_confirmed'
      | 'assignment_overridden' | 'reassignment' | 'escalation' | 'handover'
      | 'supply_transfer' | 'event_injected' | 'operator_action';
  actor: 'system' | 'system-auto' | 'operator' | 'scenario';
  payload: unknown;            // includes the decision factors for allocation records
  systemVersion: string;       // package version plus git short sha, injected at build time
  configHash: string;          // SHA-256 of the canonical assumptions/config in force
  prevHash: string;            // genesis uses 64 zeros
  hash: string;                // SHA-256 of canonical JSON of all fields above except hash
}
```

Use Web Crypto (`crypto.subtle.digest('SHA-256', ...)`), which is available in workers. Canonical JSON means stable key order and no whitespace variation; test that the same record always hashes the same.

### How tamper-evidence works

Each hash depends on the previous hash, so editing row 12 breaks row 12 and every row after it.

### Why a checkpoint is needed (important)

A ledger held in the browser can be rebuilt end to end by whoever controls the browser. So verification compares the recomputed chain against a **checkpoint**: a `{ seq, hash }` pair pinned earlier and stored **separately** from the ledger (shown in its own panel, copyable, exportable as text, and in the README it can be committed or posted publicly).

### Verify result states

1. **Intact:** chain recomputes correctly and matches the checkpoint.
2. **Broken at seq N:** a row was edited. Show the first bad row and highlight everything after it.
3. **Rewritten:** the chain is internally consistent but its head no longer matches the checkpoint. This catches an attacker who recomputed everything.

### Demo tools (behind a visible "Demo tools" drawer)

- "Edit a past record" produces state 2.
- "Rewrite the whole chain" produces state 3.
- The tamper functions exist only in demo mode, are clearly labelled, and are never reachable from normal operation.

### Honest wording for the About page

"This gives the tamper-evidence property of a blockchain without the cost and latency. It does not prove the original data was truthful. A blockchain is mainly useful when independent parties need a shared ledger; if one trusted organisation controls the log, a hash chain does the job with less complexity. The natural production step is anchoring checkpoints to an external ledger or trusted timestamp service."

Funds are out of scope for v1. Add them later as a new record type, not a new system.

---

## 12. State contract

Types live in `src/sim/types.ts`. The UI renders only these. `public/data/sample-state.json` is a frozen example in exactly this shape, written first.

```ts
type Severity = 'red' | 'yellow' | 'green' | 'black';
type LatLng = { lat: number; lng: number };
type EdgePos = { edgeId: number; fraction: number };

interface Casualty {
  id: string; severity: Severity; position: LatLng; nodeId: number;
  appearedAtMin: number; waitedMin: number; limitMin: number;
  status: 'waiting' | 'assigned' | 'pickup' | 'transporting' | 'queued_at_ed'
        | 'admitted' | 'adverse' | 'unserved';
  ambulanceId?: string; hospitalId?: string;
}

interface Ambulance {
  id: string; kind: 'BLS' | 'ALS'; position: LatLng; edgePos: EdgePos;
  status: 'idle' | 'to_patient' | 'to_hospital' | 'offline';
  routeEdgeIds: number[]; casualtyId?: string; hospitalId?: string;
}

interface Hospital {
  id: string; name: string; position: LatLng; nodeId: number;
  traumaCapable: boolean; hasIcu: boolean;
  beds: { total: number; available: number; icuTotal: number; icuAvailable: number };
  supplies: { bloodUnits: number; oxygenUnits: number };
  edQueue: string[];
  provenance: { location: 'osm'; capacity: 'verified' | 'simulated'; capability: 'verified' | 'simulated' };
}

interface Decision {
  id: string; simMin: number; kind: 'assignment' | 'reassignment' | 'escalation';
  status: 'suggested' | 'confirmed' | 'overridden' | 'rejected' | 'completed';
  casualtyId: string; ambulanceId?: string; hospitalId?: string;
  factors: { travelToCasualtyMin: number; travelToHospitalMin: number; loadPenaltyMin: number;
             severityWeight: number; waitingFactor: number; totalCost: number };
  alternatives: { hospitalId?: string; ambulanceId?: string; cost?: number; rejectedBecause?: string }[];
  reason: string;                    // plain English, shown in the "why" card
}

interface WorldState {
  tick: number; simMin: number; running: boolean; speed: 1 | 2 | 4;
  strategy: 'pulse' | 'nearest' | 'fcfs'; autoAccept: boolean; congestion: number;
  casualties: Casualty[]; ambulances: Ambulance[]; hospitals: Hospital[];
  closedEdgeIds: number[];
  decisions: Decision[];             // recent window
  pending: string[];                 // decision ids awaiting confirmation
  escalations: string[];
  metrics: Metrics;
  ledgerHead: { seq: number; hash: string };
  checkpoint?: { seq: number; hash: string };
}
```

---

## 13. User interface

### Pages

- `/` **Landing:** the pitch, the living Pulse hero (section 14), a short "what is real and what is simulated" block, one button into the console, one into About.
- `/console` **Console:** the product. A single React island with tabs: Map, Compare, Ledger.
- `/about` **About:** assumptions register, data sources and attribution, how the allocator works in plain words, the honest ledger wording, limits.

### Console layout (design for 1440 by 900, usable down to 1100 wide)

```
+--------------------------------------------------------------------------------+
| Pulse   Parel crowd crush v    [play] [1x 2x 4x]   Sim 00:14    Auto-accept [on] |
+--------------------------------------------------------------------------------+
| 9 waiting   9 of 14 ambulances busy   Beds 62% used   Avg response 11 min       |
+------------------+------------------------------------------+------------------+
| Scenario         |                                          | Decisions        |
|  Inject event    |                                          |  newest first    |
|  - Close a road  |                MAP                       |  each expands to |
|  - Fill hospital |        (dominant, matte black)           |  a "why" card    |
|  - Surge         |                                          |                  |
|  - ...           |                                          +------------------+
+------------------+                                          | Operator         |
| Operator         |                                          |  Pending (2)     |
|  Pending queue   |                                          |  Escalations (1) |
|  Escalations     |                                          |                  |
+------------------+------------------------------------------+------------------+
| Tabs: Map | Compare | Ledger                         Demo tools (drawer)        |
+--------------------------------------------------------------------------------+
```

The map is the dominant element. Side panels are narrow and quiet.

### Map layers

Roads from our graph, coloured by class and kept dim. Hospitals as nodes with a capacity ring (fill equals load) and a number. Casualties as START-coloured markers with letters. Ambulances as small chevrons with a short glowing trail. Active routes as animated dashed lines. Closed roads dashed red. Click any road, hospital, ambulance or casualty to inspect it. Attribution "© OpenStreetMap contributors" always visible on the map.

### Compare tab

Runs all three strategies headlessly on the same seed and shows the section 9.9 metrics side by side as bars and a small table, with a "response target" line at 20 minutes. Stretch: replay each strategy on a small map. Provide an honest note under it: "Same scenario, same fleet, same seed."

### Ledger tab

Table of records with sequence, time, type, actor, short hash and previous hash (monospace here is appropriate). Buttons: Pin checkpoint, Verify chain. Verify shows one of the three states in section 11. A checkpoint chip is always visible.

### Microcopy

Sentence case, plain verbs. A button says exactly what it does ("Close road", "Confirm assignment"), and the toast that follows uses the same verb ("Road closed"). Errors say what happened and what to do, and do not apologise. No ALL CAPS eyebrow labels, no arrows appended to button text.

---

## 14. Design system: matte black, living ice

### Direction

A matte black control room lit only by cold, moving ice-blue light. The finish is **matte**: flat fills, tonal layering, hairline borders, fine film grain. **No glass, no backdrop blur, no glossy specular highlights, no soft grey drop shadows.** The only luminous things on screen are the ice elements, and they move slowly.

**Spend the boldness in one place.** The memorable thing is the living pulse: the heartbeat line plus the drifting icy gradient. Everything else stays quiet and disciplined.

Avoid these generic tells: identical rounded cards everywhere with one radius, gradient washes as decoration, fade-and-slide-up on every section, hover animations on every card, a spaced eyebrow label above every heading. Use different radii by role (panels, chips, map frame), and let hairlines and tone do the structure.

### Palette

| Name | Hex | Role |
| --- | --- | --- |
| Matte | `#090A0C` | Page and map background |
| Slate | `#111317` | Panels |
| Graphite | `#181B20` | Raised surfaces, inputs |
| Hairline | `#262A31` | 1px borders and dividers |
| Frost | `#E8F2FA` | Primary text |
| Mist | `#98A3AF` | Secondary text |
| Ice 100 | `#E6F6FF` | Highlights, gradient start |
| Ice 300 | `#9FD8FF` | Light accents |
| Ice 500 | `#4DA8FF` | Primary accent, links, focus |
| Ice 600 | `#2B7BFF` | Strong accent, active states |
| Aurora | `#6FF0FF` | Sparing glints only |

Semantic colours (kept slightly desaturated so they sit on matte black): START red `#FF5468`, yellow `#FFC247`, green `#4ADE9A`, black marker `#6B7480` with a ring. Hospital load: ice when healthy, `#FF8A3D` at 80 percent or more, red when full. Closed roads `#FF5468`. Map road greys: minor `#1C2128`, main `#2B3440`, arterial `#3A4757`.

### Typography

- **Display:** Unbounded for the wordmark, landing hero and large numerals.
- **UI and body:** Instrument Sans.
- **Hashes and ledger only:** JetBrains Mono.
- Use tabular numerals for live figures so they do not jitter. Line length under 80 characters in prose. Self-host all fonts, with real fallback stacks.

### Tokens and effects (Tailwind 4, in `src/styles/global.css`)

```css
@import "tailwindcss";

@theme {
  --color-matte: #090A0C;
  --color-slate: #111317;
  --color-graphite: #181B20;
  --color-hairline: #262A31;
  --color-frost: #E8F2FA;
  --color-mist: #98A3AF;
  --color-ice-100: #E6F6FF;
  --color-ice-300: #9FD8FF;
  --color-ice-500: #4DA8FF;
  --color-ice-600: #2B7BFF;
  --color-aurora: #6FF0FF;
  --color-sev-red: #FF5468;
  --color-sev-yellow: #FFC247;
  --color-sev-green: #4ADE9A;
  --color-sev-black: #6B7480;
  --font-display: "Unbounded Variable", "Unbounded", system-ui, sans-serif;
  --font-sans: "Instrument Sans Variable", "Instrument Sans", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

html { background: var(--color-matte); color: var(--color-frost); font-family: var(--font-sans); }

/* 1. Film grain: this is what makes the black read as matte, not flat digital black */
body::after {
  content: ""; position: fixed; inset: 0; z-index: 100; pointer-events: none;
  opacity: .05; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}

/* 2. Drifting ice aurora: two big soft blobs on matte black. Black stays dominant. */
.aurora { position: fixed; inset: 0; z-index: -1; overflow: hidden; background: var(--color-matte); }
.aurora::before, .aurora::after {
  content: ""; position: absolute; width: 70vmax; height: 70vmax; border-radius: 50%;
  filter: blur(90px); opacity: .32; will-change: transform;
}
.aurora::before {
  top: -28vmax; left: -18vmax;
  background: radial-gradient(circle at 30% 30%, var(--color-ice-500), transparent 62%);
  animation: drift-a 30s ease-in-out infinite alternate;
}
.aurora::after {
  bottom: -34vmax; right: -22vmax;
  background: radial-gradient(circle at 70% 70%, var(--color-ice-600), transparent 62%);
  animation: drift-b 38s ease-in-out infinite alternate;
}
@keyframes drift-a { to { transform: translate3d(14vmax, 9vmax, 0) scale(1.15); } }
@keyframes drift-b { to { transform: translate3d(-12vmax, -8vmax, 0) scale(1.1); } }

/* 3. Moving icy gradient on text (wordmark, hero, big numbers) */
.ice-text {
  background: linear-gradient(100deg, #E6F6FF 0%, #9FD8FF 25%, #4DA8FF 50%, #9FD8FF 75%, #E6F6FF 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: sheen 9s linear infinite;
}
@keyframes sheen { to { background-position: -200% 0; } }

/* 4. Rotating ice hairline for the selected or focused element (one at a time) */
@property --angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
.ice-border {
  border: 1px solid transparent;
  background:
    linear-gradient(var(--color-slate), var(--color-slate)) padding-box,
    conic-gradient(from var(--angle), transparent 0 55%, var(--color-ice-300) 78%, var(--color-ice-600) 90%, transparent 100%) border-box;
  animation: spin 8s linear infinite;
}
@keyframes spin { to { --angle: 360deg; } }

/* 5. Heartbeat line: draws once, then beats */
.pulse-line path {
  stroke: url(#ice-stroke); stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 1; stroke-dashoffset: 1;               /* pathLength="1" on the path */
  animation: draw 2.4s ease-out forwards, beat 3.2s 2.4s ease-in-out infinite;
}
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes beat { 0%, 100% { filter: drop-shadow(0 0 0 transparent); } 50% { filter: drop-shadow(0 0 6px #4DA8FF); } }

:focus-visible { outline: 2px solid var(--color-ice-500); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .aurora::before, .aurora::after, .ice-text, .ice-border, .pulse-line path { animation: none !important; }
  .pulse-line path { stroke-dashoffset: 0; }
}
```

Heartbeat path for the logo and hero (use `pathLength="1"`, with a linear gradient `#ice-stroke` from Ice 100 to Ice 600):

```html
<svg class="pulse-line" viewBox="0 0 240 48" aria-hidden="true">
  <defs><linearGradient id="ice-stroke"><stop offset="0" stop-color="#E6F6FF"/><stop offset="1" stop-color="#2B7BFF"/></linearGradient></defs>
  <path pathLength="1" d="M0 24 H70 L82 24 L92 6 L104 42 L116 14 L124 24 H240"/>
</svg>
```

### Where the motion lives (the budget)

| Place | Motion |
| --- | --- |
| Landing hero | The one orchestrated moment: the heartbeat line draws across the page, then the wordmark's ice sheen begins. The aurora drifts behind |
| Console header | Heartbeat line in the logo, beating slowly |
| Selected decision card | Rotating ice hairline (one at a time) |
| Map routes | Dashes flow along the active route in ice blue |
| Ambulances | Short glowing trail |
| Overloaded hospital | A slow pulse ring |
| Blocked road | Red dash, slow opacity pulse |

Everything else is still. Animate only `transform`, `opacity` and `background-position`. Do not animate blur radius. Keep the aurora off the map area so the map stays crisp and fast; the console uses a much quieter version in the header only. Respect `prefers-reduced-motion` (static gradients).

### Quality floor

Text contrast at least 4.5:1. Visible keyboard focus everywhere. START colours always paired with letter and shape. Landing page fully responsive. Console is desktop-first; under about 900 px wide show a polite "best viewed on a larger screen" message instead of a broken layout. Target 60 fps with all three strategies computed in the worker; the main thread only renders. Update the map through MapLibre sources with batched `setData`, never by re-rendering React per ambulance per tick.

---

## 15. Honesty requirements (must be visible in the product)

A persistent footer on the console and the landing page, and a longer version on About, must state:

- "Simulation. Streets and hospital locations are real, from OpenStreetMap. Bed counts, ambulances, casualties and supplies are simulated."
- "Decision support for dispatchers. Not a medical device and not a diagnosis."
- "Not connected to BMC, the 108 service or any hospital system."
- Hospital capacity comes through a `HospitalFeed` interface. The prototype implements `SimulatedFeed`. A real feed would implement the same interface. Say "designed to consume a capacity feed", never "connected to one".
- A badge on any hospital field whose provenance is `simulated`.
- Attribution: "© OpenStreetMap contributors" (ODbL) on the map and in NOTICE.md.

Never claim a live API, real-time ICU data, or that OpenStreetMap tells us which hospitals can handle trauma. It does not; that comes from human-verified overrides or is labelled simulated.

---

## 16. GitHub workflow

The human wants the repository on GitHub with Claude Code making the commits. There is no special connection to configure: you work on the local files, use git directly, and use the GitHub CLI (`gh`) for repo and pull request operations. Changes appear on GitHub when you commit and push, so commit and push often.

### Setup (ask the human first)

1. Confirm `git` is installed and `gh auth status` shows a logged-in account. If not, ask the human to run `gh auth login`.
2. Ask the human to confirm: repo name (suggested `pulse`), visibility (planned **public**), and licence (suggested MIT for the code; OpenStreetMap data stays under ODbL with attribution regardless).
3. Then: `git init`, add `.gitignore` (Node, Astro, Python venv, `.env`, OS files), make the first commit, and `gh repo create <name> --public --source=. --push`.

### Standing rules

- **One branch per milestone**, named `feat/m3-sim-engine`, `feat/m5-ui-shell`, and so on. Never work directly on `main`.
- **Commit after every working step**, not just at the end of a milestone. Small commits with clear messages (conventional style: `feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- **Push after every commit**, so GitHub stays close behind your local work.
- **Open a pull request into `main` per milestone** with `gh pr create`, listing what changed and which acceptance checks passed. Merge only after the human agrees.
- **Never** force-push, rewrite published history, or commit secrets. This project needs none.
- Run the quality gates before every commit: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- Add `.github/workflows/ci.yml` that runs `npm ci`, typecheck, lint, test and build on every push and pull request. It needs no secrets.
- **File size:** GitHub warns on files over 50 MB and blocks files over 100 MB. Keep committed data small. If a raw extract is large, gitignore it and document how to regenerate it in `docs/DATA.md`. The built `public/data/*.json` files are what matter and must stay committed.
- Tag `v0.1.0` when milestone M10 is merged.
- Deployment target (GitHub Pages or a static host such as Vercel): ask the human. If GitHub Pages, set Astro's `site` and `base` correctly.

### README must contain

What Pulse is and why it exists, a screenshot or short GIF of the console, an honest scope section (section 15), how to run it, how the data was produced and how to regenerate it, an architecture diagram (Mermaid is fine), a link to `docs/ASSUMPTIONS.md`, the licence, and OpenStreetMap attribution.

---

## 17. Milestones

Each milestone ends with: tests green, quality gates pass, committed, pushed, pull request open. Do not start the next until the human has seen the result.

| # | Milestone | Done when |
| --- | --- | --- |
| M0 | Repo and tooling | Astro and Tailwind 4 and React island running; strict TypeScript; Vitest; CI green; GitHub repo created with the human's confirmation; this file committed |
| M1 | Data pipeline | `graph.json` and `hospitals.json` built and committed; size report in `docs/DATA.md`; hospital review checklist reviewed by the human; incident location confirmed by the human |
| M2 | Routing | A\* and Dijkstra trees tested on known pairs; closing a road changes a route; unreachable returns `null`; mid-edge handling documented |
| M3 | Simulation engine | Deterministic: same seed gives identical state after N ticks; casualties spawn, ambulances move, beds and supplies change; runs in Node tests with no browser |
| M4 | Allocator | Hungarian tested against a brute-force solver on small random matrices; capacity conflicts resolved; hysteresis stops flip-flopping; escalations raised; decisions carry factors and reasons |
| M5 | Strategies and metrics | Nearest and FCFS implemented; all three run headlessly on one seed; metrics computed; results reported honestly |
| M6 | UI shell and map | Console renders from `sample-state.json` first, then live from the worker; map layers, health strip, speed controls, 60 fps feel |
| M7 | Operator and Scenario panels | Every event and action in section 10 works and visibly changes the plan within about a second; pending queue and auto-accept behave |
| M8 | Ledger | Hash chain, pin checkpoint, verify with all three result states, demo tools; tests for canonical hashing and tamper detection |
| M9 | Compare and About | Compare tab, assumptions register rendered on About, honesty footer everywhere |
| M10 | Design and polish | Section 14 implemented fully: matte finish, grain, moving ice gradients, heartbeat line, motion budget, reduced-motion, focus states; landing page; guided demo; README with screenshots; tagged v0.1.0 |

You may build the visual shell earlier than M10 if it helps the human review progress, but the full polish pass belongs there.

### Tests that must exist

Deterministic replay; A\* optimality against Dijkstra on random pairs; closure rerouting; unreachable handling; Hungarian versus brute force; hysteresis (no reassignment under the margin); capacity conflict resolution; supply disqualification; ledger canonical hashing, tamper at row N, and checkpoint mismatch; strategies using identical seed and fleet.

---

## 18. Human tasks and open items

The human does these; Claude Code prompts for them at the right milestone.

- Review `docs/HOSPITAL_REVIEW.md` against BMC or each hospital's own site; drop clinics and closed sites.
- Provide verified trauma, ICU and bed facts in `data/hospital-overrides.json` where they exist; anything unverified stays labelled simulated.
- Confirm the resolved incident location.
- Sign off the speed table, scenario scale and fleet size after seeing them run.
- Choose licence, repo name, visibility and deploy target.
- Verify any real-world incident facts before they appear in public copy.

Defaults I chose where the human did not specify (change them if wrong): auto-accept on by default; road closing closes the whole road by osmid with a segment-only toggle; yellow deterioration limit of 90 minutes; fleet of 14; display font Unbounded with Instrument Sans for UI.

---

## 19. Appendix

### Glossary

- **START:** Simple Triage and Rapid Treatment, the standard red, yellow, green, black scheme.
- **Hungarian algorithm:** solves one-to-one assignment by minimising a cost matrix.
- **A\*:** shortest-route search that explores towards the goal using a never-overestimating guess (the heuristic).
- **Hash chain:** each record includes the previous record's hash, so editing an old record breaks the chain.
- **Checkpoint:** a head hash pinned separately so a fully rebuilt chain can still be caught.
- **Escalation:** a case the system cannot serve and hands to a human.
- **Provenance:** where a data field came from (OpenStreetMap, verified, or simulated).

### Sources and attribution

- Map and road data: © OpenStreetMap contributors, ODbL (<https://www.openstreetmap.org/copyright>).
- Triage scheme, response-time target and incident background: team research notes (Topics 2, 3 and 4). Treat as unverified until a human confirms each claim.
- OSMnx documentation (<https://osmnx.readthedocs.io>) and the OpenStreetMap wiki pages for Overpass and the `highway` tag.
- A\* explained visually: Red Blob Games, "Introduction to A\*".
- SHA-256: NIST FIPS 180-4.

---

## 20. Local development

Astro project conventions for this repo.

### Dev server

Start it in background mode:

```
astro dev --background
```

Manage it with `astro dev stop`, `astro dev status`, and `astro dev logs`.

### Quality gates

```
npm run typecheck    # astro check
npm run lint         # eslint
npm test             # vitest
npm run build        # astro build
```

### Astro documentation

Full documentation: https://docs.astro.build. Consult these before related work:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
