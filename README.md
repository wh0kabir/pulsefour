# Pulse

**A control-room tool that stops mass-casualty patients all going to the nearest
hospital, shows its reasoning, and keeps a record nobody can quietly edit.**

Pulse is a decision-support console for a disaster control room. It watches a
simulated mass-casualty event on a real map of South Mumbai and recommends which
ambulance goes to which casualty, and which hospital each casualty goes to. It
re-decides every simulated minute as roads close, hospitals fill and new casualties
appear. Every recommendation is explained, every decision is written to a
tamper-evident log, and a human operator approves or overrides.

> **Status: working prototype.** The full pipeline runs end to end — real road
> network, allocator, three strategies, ledger, console. Two human sign-offs are
> still outstanding (see [Outstanding](#outstanding)).

## Scope, honestly

- **Simulation.** Streets and hospital locations are real, from OpenStreetMap. Bed
  counts, ambulances, casualties and supplies are simulated.
- **Decision support for dispatchers.** Not a medical device and not a diagnosis.
- **Not connected** to BMC, the 108 ambulance service or any hospital system.
- Hospital capacity is read through a `HospitalFeed` interface, of which the
  prototype implements a simulated version. Pulse is *designed to consume* a
  capacity feed; it is not connected to one.
- OpenStreetMap does not record trauma capability. In this study area its
  `emergency=yes` tag is actively misleading, so trauma capability is **modelled**
  from building footprint size and labelled `simulated`. See
  [docs/HOSPITAL_CURATION.md](docs/HOSPITAL_CURATION.md).
- Deterioration limits are modelling parameters, not clinical thresholds. Pulse
  reports that a casualty waited past their limit and makes no claim about outcome.
- Every invented number is in [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md).

## How it works

Every simulated minute the allocator reconsiders the whole picture from scratch. For
each ambulance and casualty it finds the best hospital that can actually take that
patient, then scores the pairing on travel time to the scene, travel onward to
hospital, how full that hospital is, and how long the casualty has already waited.
Severity enters as a *benefit subtracted from cost*, which is what lets a distant
critical patient outrank a nearby minor one.

It then solves the whole board at once with the Hungarian method rather than greedily
handing out the closest ambulance first. Pairings that would send a critical patient
to a hospital without trauma capability, or down a closed road, are ruled out before
scoring. A casualty who cannot be served is never dropped silently — it is raised to a
human as an escalation.

## Does it actually beat the baselines?

Partly, and the comparison screen says so rather than hiding it. Both baselines
ignore severity and trauma capability by design, as current practice is described in
the research. All three run on the same seed, the same fleet and the same scenario.

Parel crowd crush, seed 20171029, 60 simulated minutes:

| Metric | Pulse | Nearest | First come |
| --- | --- | --- | --- |
| Mean time to ambulance on scene | 19.6 min | 25.9 min | **16.0 min** |
| Share on scene within 20 min | 57% | 25% | **85%** |
| **Mean time to admission — red** | **14.9 min** | 9.7 min | 27.3 min |
| Mean time to admission — yellow | **20.4 min** | 22.0 min | 27.6 min |
| Mean time to admission — green | 38.5 min | **14.3 min** | 22.8 min |
| Hospital overload events | 9 | 26 | **5** |
| Waited past their limit | 1 | 3 | **0** |
| Unserved at the end | 0 | 0 | 0 |

**First-come-first-served wins on mean response time.** That is not a bug and it is
not tuned away. A strategy that ignores severity treats a walking-wounded casualty as
urgently as a critical one, and since green casualties are the most numerous, serving
them promptly flatters the average. Pulse deliberately makes greens wait (38.5 min) to
get reds admitted faster (14.9 min against first-come's 27.3). It also causes roughly
half the hospital overload of the nearest-hospital baseline, because it is the only
one of the three that prices in how full a hospital already is.

Reproduce it yourself:

```bash
node --import ./scripts/ts-resolve.mjs scripts/compare-report.ts
```

## Architecture

```
Browser only. No backend, no API keys, no accounts. Static deploy.

  Astro (static)  ──  one React island  ──  Zustand UI state
                            │
                            │  postMessage: commands down, WorldState up
                            ▼
                      Web Worker
                        ├─ engine.ts     1 real second = 1 sim minute
                        ├─ astar.ts      A* for the path an ambulance drives
                        ├─ dijkstra.ts   cached trees for the batch cost matrix
                        ├─ allocator.ts  Hungarian over ambulance × casualty
                        ├─ strategies/   pulse, nearest, fcfs
                        └─ ledger.ts     SHA-256 hash chain via Web Crypto

  public/data/graph.json       3,110 nodes / 7,013 edges, 129 KB gzipped
  public/data/hospitals.json   10 hospitals, locations real, capacity simulated
  public/data/scenario-parel.json
```

The UI never imports simulation code — only types from `src/sim/types.ts` and the
worker client. The worker owns all mutable state. `src/sim/` is pure TypeScript with
no DOM, fully tested in Node.

## Running it

Requires Node 22.12 or newer.

```bash
npm install
npm run dev        # then open http://localhost:4321
```

Quality gates, all of which must pass before a commit:

```bash
npm run typecheck  # astro check
npm run lint       # eslint
npm test           # vitest — 75 tests
npm run build      # astro build
```

## Data

The road network and hospital list are extracted offline from OpenStreetMap and
committed, so nobody has to re-run the pipeline. Full provenance, the size report and
the schema: [docs/DATA.md](docs/DATA.md).

```bash
py -3.13 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r scripts/requirements.txt
./.venv/Scripts/python.exe scripts/extract-roads.py
./.venv/Scripts/python.exe scripts/fetch-hospitals.py
./.venv/Scripts/python.exe scripts/resolve-incident.py
node scripts/build-graph.ts
node scripts/build-hospitals.ts
node scripts/report-sizes.mjs
```

Python is a build-time tool and never a runtime dependency.

## Milestones

| # | Milestone | Status |
| --- | --- | --- |
| M0 | Repo and tooling | done |
| M1 | Data pipeline | done (human sign-off outstanding) |
| M2 | Routing | done |
| M3 | Simulation engine | done |
| M4 | Allocator | done |
| M5 | Strategies and metrics | done |
| M6 | UI shell and map | done |
| M7 | Operator and Scenario panels | done |
| M8 | Ledger | done |
| M9 | Compare and About | done |
| M10 | Design and polish | done |

## Outstanding

Two items need a human and were deliberately not faked:

1. **Confirm the incident location.** Parel station lies about 140 m outside the
   study area's bounding box, which section 4 of the spec did not anticipate. The
   incident currently anchors to the resolved Prabhadevi–Parel footbridge midpoint
   and `scenario-parel.json` carries `"confirmedByHuman": false`.
2. **Review the hospital list.** `docs/HOSPITAL_REVIEW.md` lists all 81 raw OSM
   results; `docs/HOSPITAL_CURATION.md` shows which 10 were kept and why. Verified
   facts go in `data/hospital-overrides.json` and always win over the model.

Also unverified: the 20-minute response target line, which comes from team research
notes rather than a primary source.

The full specification is [CLAUDE.md](CLAUDE.md). Everything that departed from it, or
that it left open, is logged in [docs/DECISIONS.md](docs/DECISIONS.md).

## Origin

Pulse began as a pitch for Elevate 1.0 (DJ Sanghvi College of Engineering), problem
statement EL-02, "Intelligent and Transparent Disaster Relief Resource Allocation". It
is now a standalone side project.

## Licence

[MIT](LICENSE) for the code. The OpenStreetMap-derived data files in `public/data/`
remain under the ODbL with attribution regardless. See [NOTICE.md](NOTICE.md).
