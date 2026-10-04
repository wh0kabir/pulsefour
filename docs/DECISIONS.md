# Decisions

Where the code departs from `CLAUDE.md`, or settles something the spec left
open. One entry per decision, with the reason. Not a build log.

## Data

**Trauma capability is modelled from building footprint, not `emergency=yes`.**
Section 6.2 suggests defaulting `traumaCapable` to hospitals tagged
`emergency=yes`. In this study area that tag is misleading: J. J., Nair, St
George and Bombay Hospital carry no emergency tag, while a maternity nursing
home does. Using it would route critical casualties away from the large
hospitals. Footprint area is data-derived and agrees with the one bed count OSM
does carry (J. J., the largest footprint, is tagged `beds=2844`). Thresholds:
include at 3,000 m2, trauma-capable at 15,000 m2. Result: 10 hospitals, 6
trauma-capable. **All of it is labelled `simulated`**; `data/hospital-overrides.json`
replaces any field with a verified fact and always wins. Audit:
`docs/HOSPITAL_CURATION.md`.

**`build-graph.ts` reads a JSON sidecar, not `roads.graphml`.** Section 5's
layout has the TypeScript stage parse GraphML, which in Node needs either an XML
dependency or a hand-rolled parser. `extract-roads.py` writes
`data/raw/roads.json` verbatim alongside the GraphML, which stays as the
canonical OSMnx artifact.

**The largest *strongly* connected component is taken explicitly.** OSMnx's
`retain_all=False` keeps the largest *weakly* connected component, which is not
what section 6.1 asks for. Cost: 72 nodes (2.3%).

**edgeIds are stable across rebuilds.** Nodes are sorted by OSM id and edges by
`(fromOsmId, toOsmId, osmWayId)` before indices are assigned, so a saved
scenario cannot silently point at a different road.

**The incident sits at the northern edge of the study area.** Parel station is
about 140 m *outside* the bounding box; section 4 assumed it was inside. The
incident anchors to the resolved Prabhadevi-Parel footbridge midpoint, whose
nearest road node is 123 m away and inside the area. `scenario-parel.json`
carries `"confirmedByHuman": false` until a human signs it off.

## Simulation

**The A\* heuristic is deflated by 2% (`HEURISTIC_SAFETY`).** The
equirectangular distance approximation can slightly *overestimate* true distance
(measured worst case 0.589% across 400 random pairs), and an overestimating
heuristic costs A\* its optimality guarantee. Latitude constants are evaluated
for 18.97 N rather than the equator.

**Hysteresis compares against the current plan recomputed this tick**, not the
cost recorded when the assignment was made. Costs drift as waiting factors grow,
so a stale baseline makes almost any alternative look like a >20% improvement,
and ambulances get re-routed every minute without ever arriving.

**An escalation means "cannot be served", not "the fleet is busy."** Waiting for
a free ambulance is the normal state in a mass-casualty event; escalating it
would bury the real problems. Escalations fire only for no feasible hospital, no
open route, or past the deterioration limit.

**The allocator does not re-emit a plan already in force**, and an ambulance
awaiting operator approval holds exactly one live suggestion. The allocator
re-decides from scratch every tick, so without these the decision feed, the
ledger and the pending queue fill with duplicates of one decision.

**Ledger appends are serialised through an internal queue.** Hashing is async and
the engine appends from synchronous call sites, so overlapping appends would read
the same `prevHash` and produce a chain that fails its own verification.

**Constructor parameter properties are avoided in `src/sim`.** Node's strip-only
TypeScript mode rejects them, and avoiding them lets `scripts/` run engine code
directly through `scripts/ts-resolve.mjs` without a bundler.

## Interface

**Markers are three distinct silhouettes**, not three circles: casualties are
lettered circles (R/Y/G/B), ambulances are chevrons aimed along their bearing,
hospitals are a cross in a rounded square. Section 7.5 requires that colour never
carries meaning alone; section 13 specifies chevrons.

**Sprites are drawn on a canvas at runtime** (`src/ui/map/icons.ts`) rather than
using MapLibre `text-field`, which needs font glyph files fetched over the
network. The demo has to work offline, so the letters are baked into the images.

**The map fills the panel by default rather than fitting the whole study area.**
The area is 8.7 km by 3.2 km and the console panel is wide, so fitting the whole
box leaves roughly 70% of the width empty. The view is framed by the data's
width and clamped so it never extends past the extracted area. "Whole area" and
"Follow" sit alongside it; Follow fits the bounding box of everything in play
rather than chasing their average position, which sits in the empty space
between the incident and the hospitals.

**The ice border animation is not named `spin`.** Tailwind ships
`@keyframes spin { to { transform: rotate(360deg) } }` and wins the collision,
which made the selected decision card physically rotate. Section 14's CSS uses
that name; this renames it to `ice-border-spin`.

**The auto-accept switch is a plain button, not a button inside a `<label>`.** A
label treats a nested button as its control and re-dispatches the click, so every
press fired twice and the switch appeared stuck.

## Project

**TypeScript is pinned to 6.x.** `astro check` refuses TypeScript 7 and
`typescript-eslint` declares `typescript <6.1.0`.

**ESLint is used although section 5 does not list it**, because section 16
mandates an `npm run lint` gate.

**MIT licence**, suggested in section 16. OpenStreetMap-derived data in
`public/data/` stays under the ODbL with attribution regardless; see `NOTICE.md`.

**`npm audit` reports 2 high-severity advisories with no non-breaking fix.** Both
come from `http-cache-semantics`, a transitive dependency of Astro itself, whose
only offered remedy is downgrading Astro to 2.10.9. Build-time only, never
shipped to the browser.

## Outstanding for a human

- Confirm the resolved incident location (`scenario-parel.json`).
- Review `docs/HOSPITAL_REVIEW.md` and record verified facts in
  `data/hospital-overrides.json`.
- Verify the 20-minute response target against a primary source, or drop the
  claim from public copy.
- Spot-check one-way streets against a real map.
