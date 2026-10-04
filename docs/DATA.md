# Data

How the committed data files were produced, and how to regenerate them.

All data jobs run once, offline. Their outputs are committed so nobody has to
re-run them. Overpass is a shared public resource: the scripts cache results and
should not be hammered.

## Study area

The bounding box is defined once, in `src/config/area.ts`, and **read** from there
by every script and by the map. The Python scripts parse that file rather than
retyping the numbers, so there is exactly one source of truth.

```
min_lat = 18.930000     max_lat = 19.008228
min_lon = 72.820000     max_lon = 72.850000
```

OSMnx 2.1.1 takes a single bbox tuple in `(left, bottom, right, top)` order, i.e.
`(west, south, east, north)`. This was confirmed against the installed version's
own signature and docstring, not from memory.

## Road network

Produced by `scripts/extract-roads.py` (OSMnx 2.1.1, `network_type="drive"`), then
compacted by `scripts/build-graph.ts`.

### Size report

| Stage | Nodes | Edges | Size |
| --- | --- | --- | --- |
| Raw OSM extract | 3,182 | 7,113 | — |
| Largest strongly connected component | 3,110 | 7,013 | 2.9 MB (`roads.graphml`) |
| Verbatim JSON sidecar | 3,110 | 7,013 | 2.0 MB (`roads.json`) |
| **Committed `public/data/graph.json`** | **3,110** | **7,013** | **479 KB raw, 129 KB gzipped** |

129 KB gzipped is comfortably under the "well under a couple of megabytes" target,
so no minor service roads were dropped and no alternate routes were lost.

### Connected component

OSMnx's `retain_all=False` keeps the largest **weakly** connected component. The
spec requires the largest **strongly** connected one, so that no ambulance is ever
stranded somewhere it cannot drive out of. The script therefore passes
`retain_all=True` and calls `ox.truncate.largest_component(G, strongly=True)`
itself. That dropped **72 nodes (2.3%) and 100 edges**.

### Edges by class

| Class | Edges |
| --- | --- |
| residential | 4,058 |
| tertiary | 1,113 |
| secondary | 1,026 |
| primary | 332 |
| living_street | 152 |
| secondary_link | 102 |
| primary_link | 89 |
| trunk | 84 |
| tertiary_link | 41 |
| trunk_link | 10 |
| unclassified | 6 |

One-way edges: 1,899 of 7,013. Named edges: 4,398 of 7,013.

### Flyovers and bridges

69 edges are tagged `bridge` and 115 carry a `layer` tag. A road passing under a
flyover must not be joined to it. The extraction script tests for this by looking
for any **node shared by edges with differing `layer` values**, which is the
signature of a false junction.

**Result: no such node exists in the extracted network.** No false flyover
junctions were detected by that test.

Note the limit of the test: it catches a junction created between ways that OSM
has explicitly tagged at different layers. It cannot catch a crossing where the
mapper omitted the `layer` tag entirely.

### One-way spot checks

**Outstanding.** A human should still spot-check a handful of one-way streets
against a real map and record the result here.

### `public/data/graph.json` schema

Parallel arrays. **An edge's array index is its `edgeId`**, and those ids are
stable across rebuilds: the builder sorts nodes by OSM id and edges by
`(fromOsmId, toOsmId, osmWayId)` before assigning them. Verified by rebuilding and
comparing a hash of the output with `meta.generated` removed — identical.

```jsonc
{
  "meta": { "generated", "source", "osmnxVersion", "component",
            "nodeCount", "edgeCount", "coordDecimalPlaces",
            "attribution", "licence" },

  "classes":      ["residential", ...],  // OSM highway tag, for map colouring
  "speedClasses": ["residential", ...],  // our speed class, for routing
  "names":        ["Ambalal Doshi Road", ...],  // 619 entries

  "nodes": {
    "lat":   [18.93014, ...],   // 5 dp, about 1 metre
    "lng":   [72.83207, ...],
    "osmId": [245653965, ...]   // original OSM node id, for reference
  },

  "edges": {
    "from":     [0, ...],       // dense node index, NOT an OSM id
    "to":       [1, ...],
    "lengthM":  [126.6, ...],   // 1 dp
    "classIdx": [0, ...],       // index into classes / speedClasses
    "osmWayId": [22845714, ...],// closing "a road" closes every edge sharing this
    "oneway":   [0, ...],       // 0 or 1
    "nameIdx":  [3, ...],       // index into names, -1 when unnamed
    "geom":     [[18.93021, 72.83270, ...], 0, ...]
                                // flat [lat, lng, ...] INTERIOR points only,
                                // or 0 when the edge is a straight line.
                                // 2,988 of 7,013 edges are curved.
  }
}
```

Speeds are deliberately **not** baked into the file. OSMnx's guessed speeds assume
free-flowing traffic, which Mumbai is not. Travel time is computed at runtime from
the congestion-aware table in `src/config/assumptions.ts`, so changing an
assumption never requires regenerating the data.

### A\* heuristic distance check

**Outstanding (M2).** The flat-map (equirectangular) approximation must be tested
against haversine on sample pairs, and the difference recorded here.

## Hospitals

Produced by `scripts/fetch-hospitals.py`, querying Overpass for `amenity=hospital`
or `healthcare=hospital`.

| Box | Results |
| --- | --- |
| Extended box, in use (south edge 18.930000) | **81** |
| Original northern box (south edge 18.961517) | **50** |

The extended box is used regardless (locked decision 1); the comparison is for the
README.

### Tag coverage, and why capacity is simulated

| Tag | Present |
| --- | --- |
| `emergency` | 12 of 81 |
| `beds` | **1 of 81** |
| `operator` | 4 of 81 |
| unnamed | 5 of 81 |

**One hospital out of 81 carries a bed count.** This is the concrete reason bed
counts, ICU counts and supplies are simulated and labelled as such throughout the
interface. OpenStreetMap also does not record trauma capability at all. Any such
claim must come from a human-verified override or stay labelled simulated.

The 81 raw results include clinics, eye-care centres, maternity homes, a dental
college and at least one ambulance service, plus apparent duplicates. They are
**not** a hospital list until a human has reviewed them.

### Curation: 10 hospitals from 81 results

`scripts/build-hospitals.ts` produces `public/data/hospitals.json`. Full
include/exclude audit with reasons: `docs/HOSPITAL_CURATION.md`.

**`emergency=yes` was rejected as the trauma signal.** Section 6.2 suggests it,
but in this area it is actively misleading: J. J., Nair, St George and Bombay
Hospital carry **no** emergency tag, while a maternity nursing home and an entry
named only "siddiqui" do. Using it would route red casualties away from the large
hospitals and rig the comparison against the baselines.

Instead, tiering uses **OSM building footprint area**, which is data-derived rather
than recalled. A mapped hospital campus is larger than a one-room clinic, and the
proxy agrees with the one bed count OSM does carry (J. J., the largest footprint at
160,461 m², is tagged `beds=2844`).

The rule, applied in that order:

1. Drop unnamed results (5) and duplicate names, keeping the largest footprint.
2. Drop single-speciality facilities by name: eye, ENT, dental, cancer, maternity,
   blood bank, ambulance, ayurvedic, nursing home, clinic, research institute, etc.
3. Drop anything with a footprint under **3,000 m²**, including all 54 results
   mapped as bare points with no building outline.
4. Mark trauma-capable in the simulation at **15,000 m²** or above.

Result: **10 hospitals, 6 trauma-capable** (above the "fewer than 3, stop and ask"
floor in section 6.2). Each is snapped to its nearest node in the strongly
connected road component, so every hospital can be reached and left.

| Hospital | Footprint | Trauma (sim) | Beds (sim) |
| --- | --- | --- | --- |
| J. J. Hospital | 160,461 m² | yes | 2,844 (from OSM `beds` tag) |
| St George Hospital | 74,644 m² | yes | 600 |
| Mahatma Gandhi Memorial Hospital | 36,529 m² | yes | 600 |
| Masina Hospital | 28,877 m² | yes | 400 |
| गोकुळदास तेजपाल रुग्णालय (G.T.) | 21,786 m² | yes | 400 |
| Dr. Babasaheb Ambedkar Memorial Central Railway Hospital | 17,945 m² | yes | 400 |
| Bombay Hospital | 11,962 m² | no | 250 |
| Jagjivan Ram Hospital | 10,232 m² | no | 250 |
| Cama Hospital | 9,400 m² | no | 250 |
| Wockhardt Hospitals, South Mumbai | 3,674 m² | no | 120 |

**All of this is a modelling assumption, not a fact**, and is labelled `simulated`
in `provenance` and badged in the interface. A human replaces any of it with
verified facts in `data/hospital-overrides.json`, keyed by OSM id; overrides always
win over the rule above.

Note J. J.'s 2,844 beds comes from the OSM tag as section 6.2 directs. It is large
enough that bed scarcity will not bind there — scenario tension comes from the
fleet (14 ambulances for ~36 casualties) and the scripted "fill a hospital" event.

Start-of-run occupancy is **not** baked into the file: it ships every bed free, and
the engine applies the seeded 25-45% occupancy at init.

### Still outstanding for a human

- Review `docs/HOSPITAL_REVIEW.md` against BMC or each hospital's own site.
- Record any verified trauma, ICU and bed facts in `data/hospital-overrides.json`.
- Confirm the 10 included and 71 excluded in `docs/HOSPITAL_CURATION.md` look right.

## Scenario

**Outstanding.** The Parel incident location (the footbridge between Elphinstone
Road and Parel stations) must be resolved through OpenStreetMap and then
**confirmed by a human** before `public/data/scenario-parel.json` is saved.

## Regenerating

Python is a build-time tool only, never a runtime dependency.

```bash
py -3.13 -m venv .venv
./.venv/Scripts/python.exe -m pip install osmnx      # 2.1.1
./.venv/Scripts/python.exe scripts/extract-roads.py  # -> data/raw/
./.venv/Scripts/python.exe scripts/fetch-hospitals.py
node scripts/build-graph.ts                          # -> public/data/graph.json
```

Python 3.13 was chosen because 3.14 has no wheels yet for parts of the geospatial
stack. Overpass rejects requests without a User-Agent with HTTP 406; OSMnx sets one
itself, so the scripts are unaffected.

`data/raw/` is gitignored: those files are large and fully regenerable. The built
`public/data/*.json` files **are** committed and must stay committed.
