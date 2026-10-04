"""
Extract the drivable road network for the study area from OpenStreetMap.

CLAUDE.md section 6.1. Run once, offline; the output is committed so nobody
has to re-run it. Python is a build-time tool, never a runtime dependency.

    .venv/Scripts/python.exe scripts/extract-roads.py

Writes data/raw/roads.graphml and prints an audit the human can paste into
docs/DATA.md.

Notes on choices made here:
  * The bounding box is READ FROM src/config/area.ts, never retyped. That file
    is the single source of truth (section 4).
  * OSMnx's retain_all=False keeps the largest WEAKLY connected component. The
    spec wants the largest STRONGLY connected one, so that no ambulance is ever
    stranded on an island it cannot drive out of. We do that step explicitly.
  * We deliberately do NOT use OSMnx's guessed speeds. They assume free-flowing
    traffic. Speeds come from the congestion-aware table in section 7.4,
    applied later in build-graph.ts.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import networkx as nx
import osmnx as ox

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
AREA_TS = ROOT / "src" / "config" / "area.ts"
OUT_GRAPHML = ROOT / "data" / "raw" / "roads.graphml"
OUT_JSON = ROOT / "data" / "raw" / "roads.json"


def read_area() -> dict[str, float]:
    """Parse the bounding box out of src/config/area.ts.

    Keeps a single source of truth for the study area across TypeScript and
    Python. If the shape of that file changes, this fails loudly rather than
    silently extracting the wrong city.
    """
    text = AREA_TS.read_text(encoding="utf-8")
    wanted = ("minLat", "maxLat", "minLon", "maxLon")
    area: dict[str, float] = {}
    for key in wanted:
        match = re.search(rf"\b{key}\s*:\s*(-?\d+(?:\.\d+)?)", text)
        if not match:
            sys.exit(f"Could not find {key} in {AREA_TS}. Has its shape changed?")
        area[key] = float(match.group(1))
    return area


def main() -> None:
    area = read_area()

    # OSMnx 2.x takes ONE tuple: (left, bottom, right, top) =
    # (west, south, east, north). Verified against the installed version's
    # own signature, not from memory.
    bbox = (area["minLon"], area["minLat"], area["maxLon"], area["maxLat"])

    print(f"osmnx {ox.__version__}")
    print(f"bbox (left, bottom, right, top) = {bbox}")

    # 'layer' is needed to tell a flyover apart from the road beneath it.
    if "layer" not in ox.settings.useful_tags_way:
        ox.settings.useful_tags_way = [*ox.settings.useful_tags_way, "layer"]

    ox.settings.log_console = False
    ox.settings.use_cache = True  # Overpass is a shared resource. Cache.

    print("querying Overpass for the drivable network...")
    graph = ox.graph_from_bbox(
        bbox,
        network_type="drive",
        simplify=True,
        retain_all=True,  # we pick the component ourselves, below
        truncate_by_edge=False,
    )
    print(f"  raw:      {graph.number_of_nodes():>6} nodes  {graph.number_of_edges():>6} edges")

    # Largest STRONGLY connected component: every node can reach every other.
    strong = ox.truncate.largest_component(graph, strongly=True)
    print(f"  strong:   {strong.number_of_nodes():>6} nodes  {strong.number_of_edges():>6} edges")

    dropped_n = graph.number_of_nodes() - strong.number_of_nodes()
    dropped_e = graph.number_of_edges() - strong.number_of_edges()
    share = dropped_n / graph.number_of_nodes() * 100 if graph.number_of_nodes() else 0
    print(f"  dropped:  {dropped_n} nodes ({share:.1f}%), {dropped_e} edges")

    audit(strong)

    OUT_GRAPHML.parent.mkdir(parents=True, exist_ok=True)
    ox.save_graphml(strong, OUT_GRAPHML)
    size_mb = OUT_GRAPHML.stat().st_size / 1_048_576
    print(f"\nwrote {OUT_GRAPHML.relative_to(ROOT)} ({size_mb:.1f} MB)")

    dump_json(strong)
    size_mb = OUT_JSON.stat().st_size / 1_048_576
    print(f"wrote {OUT_JSON.relative_to(ROOT)} ({size_mb:.1f} MB)")
    print("Both files are gitignored and regenerable; see docs/DATA.md.")


def dump_json(graph: nx.MultiDiGraph) -> None:
    """Dump the graph verbatim as JSON for the TypeScript build stage.

    The GraphML above is the canonical OSMnx artifact. This sidecar exists so
    build-graph.ts does not have to parse XML, which would mean either a new
    dependency or a hand-rolled parser. Nothing is rounded or dropped here --
    that is build-graph.ts's job. See docs/DECISIONS.md.
    """
    nodes = [
        {"osmId": int(n), "lat": float(d["y"]), "lng": float(d["x"])}
        for n, d in graph.nodes(data=True)
    ]

    def scalar(value: object) -> object:
        """OSM tags are sometimes lists when ways were merged. Take the first."""
        if isinstance(value, list):
            return value[0] if value else None
        return value

    edges = []
    for u, v, data in graph.edges(data=True):
        geometry = data.get("geometry")
        # Interior points only; the endpoints are the nodes themselves.
        coords = None
        if geometry is not None and hasattr(geometry, "coords"):
            points = list(geometry.coords)
            if len(points) > 2:
                coords = [[float(y), float(x)] for x, y in points[1:-1]]

        edges.append(
            {
                "fromOsmId": int(u),
                "toOsmId": int(v),
                "lengthM": float(data.get("length", 0.0)),
                "highway": scalar(data.get("highway")) or "unclassified",
                "osmWayId": scalar(data.get("osmid")),
                "oneway": bool(data.get("oneway", False)),
                "name": scalar(data.get("name")),
                "bridge": scalar(data.get("bridge")),
                "tunnel": scalar(data.get("tunnel")),
                "layer": scalar(data.get("layer")),
                "interior": coords,
            }
        )

    payload = {
        "meta": {
            "osmnxVersion": ox.__version__,
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "component": "largest strongly connected",
            "attribution": "Map data © OpenStreetMap contributors, ODbL",
        },
        "nodes": nodes,
        "edges": edges,
    }
    OUT_JSON.write_text(json.dumps(payload), encoding="utf-8")


def audit(graph: nx.MultiDiGraph) -> None:
    """Print the checks section 6.1 asks to be recorded in docs/DATA.md."""
    print("\n--- audit ---")

    by_class: dict[str, int] = {}
    oneway_count = 0
    bridge_count = 0
    layered_count = 0
    named = 0
    total = 0

    for _u, _v, data in graph.edges(data=True):
        total += 1
        highway = data.get("highway", "unknown")
        if isinstance(highway, list):
            highway = highway[0]
        by_class[highway] = by_class.get(highway, 0) + 1

        if data.get("oneway") is True:
            oneway_count += 1
        if data.get("bridge"):
            bridge_count += 1
        if data.get("layer"):
            layered_count += 1
        if data.get("name"):
            named += 1

    print("edges by highway class:")
    for klass, count in sorted(by_class.items(), key=lambda kv: -kv[1]):
        print(f"  {klass:<16} {count:>6}")

    print(f"\none-way edges:        {oneway_count} of {total}")
    print(f"edges tagged bridge:  {bridge_count}")
    print(f"edges tagged layer:   {layered_count}")
    print(f"edges with a name:    {named} of {total}")

    # A flyover and the road beneath it must not share a junction. OSM models
    # this with distinct ways at different `layer` values; a shared NODE
    # between two edges whose layers differ is the signature of a false
    # junction, so report any for human inspection.
    suspicious: list[tuple[int, set[str]]] = []
    for node in graph.nodes:
        layers: set[str] = set()
        for _u, _v, data in list(graph.in_edges(node, data=True)) + list(
            graph.out_edges(node, data=True)
        ):
            layer = data.get("layer")
            if layer:
                layers.add(str(layer))
        if len(layers) > 1:
            suspicious.append((node, layers))

    if suspicious:
        print(f"\nPOSSIBLE false junctions: {len(suspicious)} node(s) join edges")
        print("with differing `layer` values. Inspect these on a real map:")
        for node, layers in suspicious[:10]:
            print(f"  node {node}: layers {sorted(layers)}")
        if len(suspicious) > 10:
            print(f"  ... and {len(suspicious) - 10} more")
    else:
        print("\nNo node joins edges with differing `layer` values.")
        print("No false flyover junctions detected by that test.")


if __name__ == "__main__":
    main()
