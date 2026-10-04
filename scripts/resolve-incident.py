"""
Resolve the Parel incident location from OpenStreetMap.

CLAUDE.md section 6.3. The main demo scenario is a crowd crush at the
footbridge between Elphinstone Road (now Prabhadevi) and Parel stations, in
the style of the 2017 stampede.

    .venv/Scripts/python.exe scripts/resolve-incident.py

This script does NOT invent a coordinate. It queries OSM for the stations and
for nearby footbridges, prints the candidates, and writes the chosen point to
data/incident-candidates.json for a HUMAN TO CONFIRM (section 0, rule 6).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import osmnx as ox

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
AREA_TS = ROOT / "src" / "config" / "area.ts"
OUT = ROOT / "data" / "incident-candidates.json"


def read_area() -> dict[str, float]:
    text = AREA_TS.read_text(encoding="utf-8")
    area: dict[str, float] = {}
    for key in ("minLat", "maxLat", "minLon", "maxLon"):
        m = re.search(rf"\b{key}\s*:\s*(-?\d+(?:\.\d+)?)", text)
        if not m:
            sys.exit(f"Could not find {key} in {AREA_TS}")
        area[key] = float(m.group(1))
    return area


def centroid(row, metric_row):
    pt = metric_row.geometry.centroid
    return pt


def main() -> None:
    area = read_area()
    bbox = (area["minLon"], area["minLat"], area["maxLon"], area["maxLat"])
    ox.settings.use_cache = True

    print(f"osmnx {ox.__version__}")
    print(f"bbox = {bbox}\n")

    results: dict[str, list[dict]] = {"stations": [], "footbridges": []}

    # --- railway stations --------------------------------------------------
    print("querying railway stations...")
    try:
        stations = ox.features.features_from_bbox(
            bbox, tags={"railway": ["station", "halt"]}
        )
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Overpass query failed: {exc}")

    if not stations.empty:
        metric = stations.to_crs(stations.estimate_utm_crs())
        cents = metric.geometry.centroid.to_crs("EPSG:4326")
        for (etype, oid), row in stations.iterrows():
            name = row.get("name")
            if not isinstance(name, str):
                continue
            pt = cents.loc[(etype, oid)]
            results["stations"].append(
                {
                    "name": name,
                    "osm": f"{etype}/{oid}",
                    "lat": round(float(pt.y), 6),
                    "lng": round(float(pt.x), 6),
                }
            )

    results["stations"].sort(key=lambda r: r["name"])
    print(f"  {len(results['stations'])} named station(s)")
    for s in results["stations"]:
        print(f"    {s['name']:<32} {s['lat']}, {s['lng']}  {s['osm']}")

    # --- footbridges -------------------------------------------------------
    print("\nquerying footbridges (highway=footway + bridge)...")
    try:
        bridges = ox.features.features_from_bbox(bbox, tags={"bridge": True})
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Overpass query failed: {exc}")

    if not bridges.empty:
        metric = bridges.to_crs(bridges.estimate_utm_crs())
        cents = metric.geometry.centroid.to_crs("EPSG:4326")
        for (etype, oid), row in bridges.iterrows():
            highway = row.get("highway")
            if highway not in ("footway", "steps", "pedestrian"):
                continue
            pt = cents.loc[(etype, oid)]
            results["footbridges"].append(
                {
                    "name": row.get("name") if isinstance(row.get("name"), str) else None,
                    "osm": f"{etype}/{oid}",
                    "highway": str(highway),
                    "lat": round(float(pt.y), 6),
                    "lng": round(float(pt.x), 6),
                }
            )

    print(f"  {len(results['footbridges'])} pedestrian bridge(s)")

    # --- the station pair the scenario is about ----------------------------
    def find(*needles: str):
        for s in results["stations"]:
            low = s["name"].lower()
            if any(n in low for n in needles):
                return s
        return None

    parel = find("parel")
    elphinstone = find("prabhadevi", "elphinstone")

    print("\n--- scenario anchor ---")
    if parel:
        print(f"  Parel station:      {parel['lat']}, {parel['lng']}  ({parel['osm']})")
    else:
        print("  Parel station:      NOT FOUND in the study area")
    if elphinstone:
        print(f"  Prabhadevi station: {elphinstone['lat']}, {elphinstone['lng']}  ({elphinstone['osm']})")
    else:
        print("  Prabhadevi (Elphinstone Road) station: NOT FOUND in the study area")
        print("  (It sits on the Western line, west of this bounding box.)")

    chosen = None
    if parel and elphinstone:
        chosen = {
            "lat": round((parel["lat"] + elphinstone["lat"]) / 2, 6),
            "lng": round((parel["lng"] + elphinstone["lng"]) / 2, 6),
            "basis": "midpoint between the two resolved stations",
        }
    elif parel:
        # Nearest pedestrian bridge to Parel station is the best OSM-derived
        # anchor available inside the box.
        best = None
        best_d = 1e18
        for b in results["footbridges"]:
            d = (b["lat"] - parel["lat"]) ** 2 + (b["lng"] - parel["lng"]) ** 2
            if d < best_d:
                best_d, best = d, b
        if best:
            chosen = {
                "lat": best["lat"],
                "lng": best["lng"],
                "basis": f"nearest pedestrian bridge to Parel station ({best['osm']})",
            }
        else:
            chosen = {
                "lat": parel["lat"],
                "lng": parel["lng"],
                "basis": f"Parel station itself ({parel['osm']}); no pedestrian bridge found nearby",
            }

    results["chosen"] = chosen
    results["_README"] = (
        "Resolved from OpenStreetMap by scripts/resolve-incident.py. "
        "A HUMAN MUST CONFIRM 'chosen' before it is treated as the incident "
        "location (CLAUDE.md section 6.3). Nothing here was typed from memory."
    )

    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\n--- chosen ---")
    if chosen:
        print(f"  {chosen['lat']}, {chosen['lng']}")
        print(f"  basis: {chosen['basis']}")
    else:
        print("  NONE. Ask the human.")
    print(f"\nwrote {OUT.relative_to(ROOT)}")
    print("CONFIRM THIS POINT WITH A HUMAN before the scenario is finalised.")


if __name__ == "__main__":
    main()
