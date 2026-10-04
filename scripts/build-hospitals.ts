/**
 * Build the curated hospital file.
 *
 * CLAUDE.md section 6.2:
 *   data/hospitals.raw.json + curation + human overrides
 *     -> public/data/hospitals.json
 *
 *     node scripts/build-hospitals.ts
 *
 * ---------------------------------------------------------------------------
 * HONESTY CONTRACT (section 15). Read before changing anything here.
 *
 * OpenStreetMap gives us LOCATION and nothing else we can trust. It does not
 * record trauma capability, and 80 of 81 results in this area carry no bed
 * count. Therefore:
 *
 *   * `location`   provenance is 'osm'        -- real.
 *   * `capacity`   provenance is 'simulated'  -- unless a human verified it.
 *   * `capability` provenance is 'simulated'  -- unless a human verified it.
 *
 * Every simulated field is badged in the interface. Nothing in this file may
 * be presented as a real-world fact.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `emergency=yes`?
 *
 * Section 6.2 suggests defaulting traumaCapable to hospitals tagged
 * `emergency=yes`. In this study area that tag is actively misleading: the
 * large teaching hospitals (J. J., Nair, St George, Bombay Hospital) carry NO
 * emergency tag, while a maternity nursing home does. Using it would send red
 * casualties past the real trauma centres and quietly rig the comparison
 * against the baselines.
 *
 * Instead we tier by OSM BUILDING FOOTPRINT AREA, which is data-derived rather
 * than recalled: a mapped hospital campus is bigger than a one-room clinic.
 * This is a MODELLING ASSUMPTION, not a fact, and it is labelled as such.
 * A human replaces it with verified facts in data/hospital-overrides.json.
 * See docs/DECISIONS.md.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ICU_SHARE_OF_BEDS } from '../src/config/assumptions.ts';
import type { GraphFile, Hospital } from '../src/sim/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN_RAW = join(ROOT, 'data', 'hospitals.raw.json');
const IN_OVERRIDES = join(ROOT, 'data', 'hospital-overrides.json');
const IN_GRAPH = join(ROOT, 'public', 'data', 'graph.json');
const OUT_JSON = join(ROOT, 'public', 'data', 'hospitals.json');
const OUT_REPORT = join(ROOT, 'docs', 'HOSPITAL_CURATION.md');

/** Below this footprint, and with no emergency tag, we treat it as a clinic. */
const MIN_FOOTPRINT_M2 = 3000;

/** At or above this footprint, the simulation treats it as trauma-capable. */
const TRAUMA_FOOTPRINT_M2 = 15000;

/**
 * Names indicating a single-speciality facility that would not receive mixed
 * trauma casualties. Matched case-insensitively as substrings.
 */
const SPECIALIST_PATTERNS = [
  'eye', 'ophthalmic', 'e.n.t', 'ent hospital', 'dental', 'cancer', 'oncology',
  'maternity', 'blood bank', 'ambulance', 'veterinary', 'ayurvedic', 'polyclinic',
  'diagnostic', 'physio', 'pediatric', 'paediatric', 'orthopaedic', 'orthopedic',
  'arthroscopy', 'sports medicine', 'research & testing', 'institute for training',
  'infimary', 'infirmary', 'nursing home', 'clinic', 'health centre', 'health center',
  'laser', 'skin', 'transplant cen',
];

/** Tiered bed placeholders by footprint. All simulated. */
function placeholderBeds(footprintM2: number): number {
  if (footprintM2 >= 30000) return 600;
  if (footprintM2 >= TRAUMA_FOOTPRINT_M2) return 400;
  if (footprintM2 >= 8000) return 250;
  return 120;
}

interface RawHospital {
  osmType: string;
  osmId: number;
  name: string | null;
  lat: number;
  lng: number;
  geometryType: string;
  footprintM2: number;
  tags: Record<string, string>;
}

interface Override {
  include?: boolean;
  traumaCapable?: boolean;
  icu?: boolean;
  beds?: { total?: number; icu?: number };
  sourceUrl?: string;
  verifiedOn?: string;
  notes?: string;
}

/** Equirectangular metres. Accurate enough at this scale for nearest-node. */
function approxMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const meanLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const x = (bLng - aLng) * Math.cos(meanLat) * 111_320;
  const y = (bLat - aLat) * 110_540;
  return Math.hypot(x, y);
}

function main(): void {
  const raw = JSON.parse(readFileSync(IN_RAW, 'utf8')) as RawHospital[];
  const graph = JSON.parse(readFileSync(IN_GRAPH, 'utf8')) as GraphFile;

  const overridesFile = JSON.parse(readFileSync(IN_OVERRIDES, 'utf8')) as Record<string, unknown>;
  const overrides: Record<string, Override> = {};
  for (const [key, value] of Object.entries(overridesFile)) {
    if (key.startsWith('_')) continue; // the _README block
    overrides[key] = value as Override;
  }

  const decisions: {
    name: string;
    osm: string;
    footprintM2: number;
    included: boolean;
    reason: string;
    trauma?: boolean;
    source: 'curated' | 'human override';
  }[] = [];

  // --- de-duplicate by name, keeping the largest footprint -----------------
  const bestByName = new Map<string, RawHospital>();
  for (const h of raw) {
    if (!h.name) continue;
    const key = h.name.trim().toLowerCase();
    const existing = bestByName.get(key);
    if (!existing || h.footprintM2 > existing.footprintM2) bestByName.set(key, h);
  }

  const kept: Hospital[] = [];

  for (const h of raw) {
    const id = String(h.osmId);
    const override = overrides[id];
    const name = h.name?.trim() ?? '';
    const lower = name.toLowerCase();

    // A human's decision always wins.
    if (override?.include === false) {
      decisions.push({ name: name || '(unnamed)', osm: `${h.osmType}/${h.osmId}`, footprintM2: h.footprintM2, included: false, reason: 'human override: exclude', source: 'human override' });
      continue;
    }

    let include = true;
    let reason = '';

    if (!override?.include) {
      if (!name) {
        include = false;
        reason = 'unnamed';
      } else if (bestByName.get(lower)?.osmId !== h.osmId) {
        include = false;
        reason = 'duplicate name, smaller footprint';
      } else {
        const specialist = SPECIALIST_PATTERNS.find((p) => lower.includes(p));
        if (specialist) {
          include = false;
          reason = `single-speciality facility (matched "${specialist}")`;
        } else if (h.footprintM2 < MIN_FOOTPRINT_M2) {
          include = false;
          reason =
            h.footprintM2 === 0
              ? 'mapped as a point, no building footprint'
              : `footprint ${Math.round(h.footprintM2)} m² below ${MIN_FOOTPRINT_M2} m²`;
        } else {
          reason = `general hospital, footprint ${Math.round(h.footprintM2)} m²`;
        }
      }
    } else {
      reason = 'human override: include';
    }

    if (!include) {
      decisions.push({ name: name || '(unnamed)', osm: `${h.osmType}/${h.osmId}`, footprintM2: h.footprintM2, included: false, reason, source: 'curated' });
      continue;
    }

    // --- capacity and capability ------------------------------------------
    const osmBeds = Number(h.tags['beds'] ?? h.tags['capacity:beds']);
    const bedsVerified = override?.beds?.total !== undefined;
    const totalBeds = override?.beds?.total
      ?? (Number.isFinite(osmBeds) && osmBeds > 0 ? osmBeds : placeholderBeds(h.footprintM2));

    const icuTotal = override?.beds?.icu ?? Math.max(4, Math.round(totalBeds * ICU_SHARE_OF_BEDS));

    const traumaVerified = override?.traumaCapable !== undefined;
    const traumaCapable = override?.traumaCapable ?? h.footprintM2 >= TRAUMA_FOOTPRINT_M2;
    const hasIcu = override?.icu ?? true;

    // --- snap to the nearest graph node -----------------------------------
    // Every node in graph.json belongs to the largest strongly connected
    // component, so a hospital can always be reached and left.
    let nodeId = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < graph.nodes.lat.length; i++) {
      const d = approxMetres(h.lat, h.lng, graph.nodes.lat[i]!, graph.nodes.lng[i]!);
      if (d < bestDistance) {
        bestDistance = d;
        nodeId = i;
      }
    }

    kept.push({
      id: `H${h.osmId}`,
      name,
      position: { lat: h.lat, lng: h.lng },
      nodeId,
      traumaCapable,
      hasIcu,
      beds: {
        total: totalBeds,
        // The engine applies seeded start-of-run occupancy at init, so the
        // static file ships every bed free.
        available: totalBeds,
        icuTotal,
        icuAvailable: icuTotal,
      },
      supplies: { bloodUnits: 40, oxygenUnits: 60 },
      edQueue: [],
      provenance: {
        location: 'osm',
        capacity: bedsVerified ? 'verified' : 'simulated',
        capability: traumaVerified ? 'verified' : 'simulated',
      },
    });

    decisions.push({
      name,
      osm: `${h.osmType}/${h.osmId}`,
      footprintM2: h.footprintM2,
      included: true,
      reason,
      trauma: traumaCapable,
      source: override ? 'human override' : 'curated',
      });
  }

  kept.sort((a, b) => a.name.localeCompare(b.name));

  const traumaCount = kept.filter((h) => h.traumaCapable).length;
  if (traumaCount < 3) {
    console.error(`\nSTOP: only ${traumaCount} trauma-capable hospital(s).`);
    console.error('Section 6.2 says do not guess. Ask the human.');
    process.exit(1);
  }

  const payload = {
    meta: {
      generated: new Date().toISOString(),
      source: 'OpenStreetMap via Overpass',
      attribution: 'Map data © OpenStreetMap contributors, ODbL',
      hospitalCount: kept.length,
      traumaCapableCount: traumaCount,
      note:
        'Locations are real (OpenStreetMap). Bed counts, ICU counts, trauma ' +
        'capability and supplies are SIMULATED unless a field is marked ' +
        'verified. OpenStreetMap does not record trauma capability.',
      curationRule:
        `Included when named, not a duplicate, not single-speciality, and ` +
        `footprint >= ${MIN_FOOTPRINT_M2} m². Trauma-capable in the ` +
        `simulation when footprint >= ${TRAUMA_FOOTPRINT_M2} m².`,
    },
    hospitals: kept,
  };

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 1), 'utf8');

  writeReport(decisions, kept.length, traumaCount);

  console.log(`included ${kept.length} of ${raw.length} OSM results`);
  console.log(`trauma-capable (simulated): ${traumaCount}\n`);
  for (const h of kept) {
    console.log(
      `  ${h.traumaCapable ? 'TRAUMA' : '      '}  ${h.name.padEnd(46).slice(0, 46)} ` +
        `beds ${String(h.beds.total).padStart(4)}  icu ${String(h.beds.icuTotal).padStart(3)}  node ${h.nodeId}`,
    );
  }
  console.log(`\nwrote public/data/hospitals.json`);
  console.log(`wrote docs/HOSPITAL_CURATION.md`);
}

function writeReport(
  decisions: { name: string; osm: string; footprintM2: number; included: boolean; reason: string; trauma?: boolean; source: string }[],
  keptCount: number,
  traumaCount: number,
): void {
  const lines: string[] = [];
  lines.push('# Hospital curation report');
  lines.push('');
  lines.push('Generated by `scripts/build-hospitals.ts`. **Not a statement of fact.**');
  lines.push('');
  lines.push(
    'OpenStreetMap gives reliable *locations* and almost nothing else: 80 of 81 ' +
      'results here carry no bed count, and OSM does not record trauma capability ' +
      'at all. Inclusion and trauma capability below are therefore MODELLING ' +
      'DECISIONS derived from building footprint area, labelled `simulated` ' +
      'throughout the interface.',
  );
  lines.push('');
  lines.push(
    'To replace any of this with a verified fact, add an entry to ' +
      '`data/hospital-overrides.json` keyed by OSM id. Human overrides always win.',
  );
  lines.push('');
  lines.push(`**Included: ${keptCount}. Trauma-capable in the simulation: ${traumaCount}.**`);
  lines.push('');
  lines.push('## Included');
  lines.push('');
  lines.push('| Hospital | OSM | Footprint | Trauma (simulated) | Basis |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const d of decisions.filter((x) => x.included).sort((a, b) => b.footprintM2 - a.footprintM2)) {
    lines.push(
      `| ${d.name} | ${d.osm} | ${Math.round(d.footprintM2).toLocaleString()} m² | ${d.trauma ? 'yes' : 'no'} | ${d.source} |`,
    );
  }
  lines.push('');
  lines.push('## Excluded');
  lines.push('');
  lines.push('| Name | OSM | Footprint | Why |');
  lines.push('| --- | --- | --- | --- |');
  for (const d of decisions.filter((x) => !x.included).sort((a, b) => b.footprintM2 - a.footprintM2)) {
    lines.push(`| ${d.name} | ${d.osm} | ${Math.round(d.footprintM2).toLocaleString()} m² | ${d.reason} |`);
  }
  lines.push('');
  writeFileSync(OUT_REPORT, lines.join('\n'), 'utf8');
}

main();
