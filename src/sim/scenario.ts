/**
 * Scenario loading and casualty spawning (CLAUDE.md section 6.3).
 *
 * Everything random here comes from the seeded generator, so a run with the
 * same seed produces exactly the same casualties in the same places.
 */

import { DETERIORATION_LIMIT_MIN } from '../config/assumptions';
import type { RoadGraph } from './graph';
import type { Rng } from './rng';
import type { Casualty, LatLng, ScenarioEvent, Severity } from './types';

export interface CasualtyWave {
  atMin: number;
  count: number;
  severityMix: Partial<Record<Severity, number>>;
  spreadM: number;
}

export interface Scenario {
  id: string;
  name: string;
  seed: number;
  durationMin: number;
  incident: {
    name: string;
    lat: number;
    lng: number;
    resolvedFrom?: string;
    confirmedByHuman?: boolean;
    note?: string;
  };
  casualtySchedule: CasualtyWave[];
  fleet: { als: number; bls: number; startPositions: 'hospitals' | number[] };
  scriptedEvents?: { atMin: number; caption: string; event: ScenarioEvent }[];
}

/** Expand a severity mix into a flat list, then shuffle it deterministically. */
export function expandSeverityMix(
  mix: Partial<Record<Severity, number>>,
  count: number,
  rng: Rng,
): Severity[] {
  const list: Severity[] = [];
  for (const severity of ['red', 'yellow', 'green', 'black'] as const) {
    const n = mix[severity] ?? 0;
    for (let i = 0; i < n; i++) list.push(severity);
  }

  // If the mix does not add up to count, top up with yellow (the middle case)
  // rather than silently spawning fewer casualties.
  while (list.length < count) list.push('yellow');
  const trimmed = list.slice(0, count);
  return rng.shuffle(trimmed);
}

/**
 * Scatter `count` casualties around a point, snapped to road nodes.
 *
 * Casualties are placed at graph nodes so an ambulance can actually reach
 * them. Offsets use a square-root radius so points spread evenly over the
 * disc rather than clustering in the middle.
 */
export function spawnCasualties(options: {
  graph: RoadGraph;
  rng: Rng;
  center: LatLng;
  count: number;
  severityMix: Partial<Record<Severity, number>>;
  spreadM: number;
  simMin: number;
  nextId: () => string;
}): Casualty[] {
  const { graph, rng, center, count, severityMix, spreadM, simMin, nextId } = options;
  const severities = expandSeverityMix(severityMix, count, rng);
  const casualties: Casualty[] = [];

  const metresPerDegLat = 110_692;
  const metresPerDegLng = 111_413 * Math.cos((center.lat * Math.PI) / 180);

  for (let i = 0; i < count; i++) {
    const angle = rng.float(0, Math.PI * 2);
    const radius = Math.sqrt(rng.next()) * spreadM;
    const lat = center.lat + (radius * Math.sin(angle)) / metresPerDegLat;
    const lng = center.lng + (radius * Math.cos(angle)) / metresPerDegLng;

    const nodeId = graph.nearestNode(lat, lng);
    const position = graph.position(nodeId);
    const severity = severities[i] ?? 'yellow';

    casualties.push({
      id: nextId(),
      severity,
      position,
      nodeId,
      appearedAtMin: simMin,
      waitedMin: 0,
      limitMin:
        severity === 'black' ? Infinity : DETERIORATION_LIMIT_MIN[severity],
      // Black casualties are shown and counted, never dispatched (section 7.5).
      status: severity === 'black' ? 'unserved' : 'waiting',
    });
  }

  return casualties;
}

/** Validate a scenario file enough to fail loudly rather than behave oddly. */
export function assertValidScenario(scenario: Scenario): void {
  if (!scenario.id) throw new Error('scenario is missing an id');
  if (!Number.isFinite(scenario.seed)) throw new Error('scenario seed must be a number');
  if (scenario.fleet.als + scenario.fleet.bls <= 0) {
    throw new Error('scenario has no ambulances');
  }
  for (const wave of scenario.casualtySchedule) {
    const total = Object.values(wave.severityMix).reduce((a, b) => a + b, 0);
    if (total !== wave.count) {
      throw new Error(
        `wave at minute ${wave.atMin}: severity mix sums to ${total} but count is ${wave.count}`,
      );
    }
  }
}
