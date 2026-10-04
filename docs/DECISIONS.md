# Decisions

A line per decision that was not already locked in `CLAUDE.md` section 3, or that
changes one. Newest last.

## M0 — repo and tooling (2026-10-04)

- **Spec moved to the repository root.** `CLAUDE.md` was sitting in `public/`, where
  Astro would have published it as a static asset and where it was not loaded as
  project instructions. It is now at the root, as its own first line instructs. The
  Astro scaffold notes it replaced survive in `AGENTS.md`.
- **TypeScript pinned to 6.x.** The latest is 7.0, but `astro check` refuses to run
  against TypeScript 7 and `typescript-eslint` declares `typescript <6.1.0`. Pinning
  to `~6.0` makes both the typecheck and the lint gate work. Revisit when Astro's
  type tooling supports 7 (it points at the experimental
  `@astrojs/ts-content-mapper`).
- **ESLint added, though section 5 does not list it.** Section 16 mandates an
  `npm run lint` quality gate, so a linter is implied by the spec rather than new
  scope. Packages: `eslint`, `typescript-eslint`, `eslint-plugin-astro`, `globals`,
  plus `@astrojs/check` for `astro check`. Flag if you would rather drop it.
- **`npm audit` reports 2 high-severity advisories with no non-breaking fix.** Both
  come from `http-cache-semantics`, a transitive dependency of Astro itself. The only
  offered remedy is downgrading Astro to 2.10.9, which is a hard no. It is a
  build-time dependency, not shipped to the browser. Left as-is, recorded here.
- **The assumptions register on `/about` is generated from `src/config/assumptions.ts`**
  rather than hand-written, so the published table cannot drift from the numbers the
  simulation actually reads.
- **Worker output format set to ES modules** (`vite.worker.format: 'es'`). See the M1
  entry: this is also what MapLibre's worker needs in the production build.

## M1 — data pipeline and map (2026-10-04)

- **Python 3.13 for the pipeline, not 3.14.** The newest interpreter on this
  machine has no wheels yet for parts of the geospatial stack. The venv is built
  with `py -3.13`. OSMnx resolved to 2.1.1.
- **Largest *strongly* connected component, done by hand.** OSMnx's
  `retain_all=False` keeps the largest *weakly* connected component, which is not
  what section 6.1 asks for. The script passes `retain_all=True` and calls
  `ox.truncate.largest_component(G, strongly=True)` itself. Cost: 72 nodes (2.3%).
- **A JSON sidecar sits between the two pipeline stages.** Section 5's layout says
  `build-graph.ts` reads `roads.graphml`. Parsing GraphML in Node would need either
  a new XML dependency or a hand-rolled parser, both worse than the alternative, so
  `extract-roads.py` also writes `data/raw/roads.json` verbatim and the TypeScript
  stage reads that. The GraphML is still written as the canonical OSMnx artifact.
  **Flag this if you would rather it parsed the XML.**
- **The Python scripts parse `src/config/area.ts`** to get the bounding box rather
  than redeclaring it, keeping one source of truth across both languages.
- **edgeIds are stable across rebuilds.** The builder sorts nodes by OSM id and
  edges by `(fromOsmId, toOsmId, osmWayId)` before assigning indices. Verified by
  rebuilding and comparing hashes. Scenario files can safely reference edgeIds.
- **Overpass needs a User-Agent**, else it answers HTTP 406. OSMnx sets one, so the
  scripts are fine; raw `curl` probes need `-H "User-Agent: ..."`.
- **`hospitals.json` is deliberately not built.** 81 raw OSM results are awaiting
  human review in `docs/HOSPITAL_REVIEW.md`. Building the curated file first would
  bake unverified facts into the product.

### MapLibre, three real traps (all fixed, all worth remembering)

- **The map container must be sized with `h-full`, not `absolute inset-0`.**
  MapLibre's own stylesheet sets `position: relative` on `.maplibregl-map`, which
  cancels absolute positioning and collapses the element to **zero height**. The
  canvas still exists, so it fails silently as a blank map.
- **No `maxBounds`.** It imposes a *minimum zoom* so the viewport can never show
  more than those bounds. The study area is tall and narrow inside a wide console
  panel, so that floor (about z14) silently overrode every attempt to fit the whole
  area. Replaced with `minZoom`/`maxZoom`, which protects the view without fighting
  the fit. `fitBounds` is also called after `resize()` on load, because the
  constructor fits against the element's pre-layout size.
- **The worker needs `?worker&url` plus `vite.worker.format: 'es'`.** MapLibre
  locates its worker at runtime via a template-string `new URL(...)` path, built
  from a variable, so Rollup cannot see it statically and never emits the file —
  the built site fails with "Worker failed to load" and a blank map while dev
  looks fine. Plain `?url` is *not* enough: it copies the file verbatim and the
  worker's `import './maplibre-gl-shared.mjs'` is then missing. `?worker&url` makes
  Vite bundle the worker and return its URL, which is handed to MapLibre's
  `setWorkerUrl()`. Dev additionally needs `optimizeDeps.exclude: ['maplibre-gl']`.
  Both dev and the production build were screenshot-verified.

### Hospital curation (decided with the project owner, 2026-10-04)

- **`emergency=yes` rejected as the trauma-capability signal**, overriding the
  default suggested in section 6.2. In this study area the tag is actively
  misleading: J. J., Nair, St George and Bombay Hospital carry no emergency tag,
  while a maternity nursing home and an entry named only "siddiqui" do. Applying
  the default would have sent red casualties past the large hospitals and rigged
  the comparison against the baselines — a direct breach of section 0 rule 5.
- **Tiering uses OSM building footprint area instead.** It is data-derived rather
  than recalled, which keeps rule 3 ("never invent real-world facts") intact, and
  it agrees with the single bed count OSM does carry: the largest footprint
  (J. J., 160,461 m²) is the hospital tagged `beds=2844`. Thresholds: include at
  3,000 m², trauma-capable at 15,000 m². Result: 10 included, 6 trauma-capable.
- **Everything curated is labelled `simulated`** in `provenance` and badged in the
  interface. `data/hospital-overrides.json` lets a human replace any field with a
  verified fact, and overrides always win. The full include/exclude audit with a
  reason per result is written to `docs/HOSPITAL_CURATION.md`.
- This unblocks M2-M5 without waiting on a full 81-row human review, which remains
  outstanding in `docs/HOSPITAL_REVIEW.md`.

## M2–M10 — engine, allocator, strategies, UI (2026-10-04)

- **A\* heuristic deflated by 2%** (`HEURISTIC_SAFETY`). The equirectangular
  distance approximation can slightly *overestimate* true distance on long
  diagonals (measured worst case 0.589% across 400 random pairs), and an
  overestimating heuristic costs A\* its optimality guarantee. Deflating the
  straight-line distance before dividing by the fastest speed makes it provably
  admissible. The latitude constants were also retuned for 18.97 N.
- **Ledger appends are serialised through an internal queue.** Hashing is async
  and the engine appends from synchronous call sites (`void ledger.append(...)`
  inside a handover). Overlapping appends both read the same `prevHash` and
  produced a chain that failed its own verification — the first live run showed
  "broken at sequence 209" with nobody having tampered. The queue makes that
  impossible regardless of how callers invoke it. Regression test added.
- **Hysteresis compares against the current plan recomputed this tick**, not the
  cost recorded when the assignment was made. Every cost drifts as waiting
  factors grow, so a stale baseline made almost any alternative look like a >20%
  improvement: ambulances were re-routed every minute and never arrived. Fixing
  it moved Pulse's mean response from 25.0 to 19.6 minutes and unserved from 5
  to 0 over the 60-minute scenario.
- **An escalation means "cannot be served", not "the fleet is busy".** The first
  version escalated every casualty waiting for a free ambulance, which in a
  mass-casualty event is most of them, burying the real problems. Now it fires
  only for no feasible hospital, no open route, or past the deterioration limit.
- **The allocator stops re-proposing the plan already in force.** It re-decides
  from scratch every tick by design, so it kept emitting an identical decision
  every minute. That flooded the feed and roughly doubled the ledger (689 rows
  down to 339 over the same run).
- **Constructor parameter properties removed from `src/sim`.** Node's strip-only
  TypeScript mode rejects them, and removing them lets `scripts/` run engine code
  directly through `scripts/ts-resolve.mjs` rather than needing a bundler.
- **MIT licence added** (suggested in section 16; the human had not yet chosen).
  Easy to change. OpenStreetMap-derived data in `public/data/` stays ODbL
  regardless — stated in both LICENSE and NOTICE.md.
- **The Parel incident sits at the northern edge of the study area.** Parel
  station is about 140 m OUTSIDE the bounding box; section 4 assumed it was
  inside. The incident anchors to the resolved Prabhadevi–Parel footbridge
  midpoint, whose nearest road node is 123 m away and inside the area. The
  scenario file carries `"confirmedByHuman": false` until a human signs it off.

### Map framing (2026-10-04)

- **The console map fills the panel by default instead of fitting the whole
  study area.** The area is about 8.7 km north-south by 3.2 km east-west, and the
  console map panel is wide, so fitting the whole box letterboxed it and left
  roughly 70% of the width empty and black. It read as a broken or unfinished
  map.
- The fix frames by the data's **width**, which fills the panel edge to edge,
  and clamps the centre so the viewport never extends past the extracted area.
  The incident sits at the very northern edge, so centring on it directly would
  have left the top half blank; `frameFullBleed` measures the visible latitude
  span after the width fit and clamps accordingly.
- A **"Whole area" / "Incident"** control keeps the full spine one click away.
- The alternative was widening the study area so the data filled the viewport,
  which would have changed locked decision 1, required re-running the pipeline
  and re-curating hospitals, and gained little: east of the box is Mumbai
  harbour, so there are no roads to add on that side. Say the word if you would
  rather have that.
