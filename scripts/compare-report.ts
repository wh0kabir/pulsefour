/**
 * Run the three-strategy comparison headlessly and print the result.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/compare-report.ts [minutes]
 *
 * Section 0 rule 5: the numbers are reported exactly as they come out. If
 * Pulse loses on a metric, that is the finding.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runComparison } from '../src/sim/compare.ts';
import { RoadGraph } from '../src/sim/graph.ts';
import type { Scenario } from '../src/sim/scenario.ts';
import type { GraphFile, Hospital, Metrics } from '../src/sim/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const graph = new RoadGraph(read('public/data/graph.json') as GraphFile);
const hospitals = (read('public/data/hospitals.json') as { hospitals: Hospital[] }).hospitals;
const scenario = read('public/data/scenario-parel.json') as Scenario;

const minutes = Number(process.argv[2] ?? scenario.durationMin);
const results = await runComparison({ graph, hospitals, scenario, minutes });

const pad = (s: string, n: number) => s.padEnd(n);

console.log(`\nParel crowd crush, seed ${scenario.seed}, ${minutes} simulated minutes`);
console.log('Same scenario, same fleet, same seed for all three.\n');
console.log(pad('metric', 44) + ['pulse', 'nearest', 'fcfs'].map((s) => s.padStart(10)).join(''));
console.log('-'.repeat(74));

const rows: [string, (m: Metrics) => string, boolean][] = [
  ['Mean time to ambulance on scene (min)', (m) => m.meanResponseMin.toFixed(1), true],
  ['Share on scene within 20 min', (m) => `${(m.shareWithinTarget * 100).toFixed(0)}%`, false],
  ['Red casualties to a trauma hospital', (m) => `${(m.redToTraumaShare * 100).toFixed(0)}%`, false],
  ['Hospital overload events', (m) => String(m.overloadEvents), true],
  ['Peak hospital load', (m) => `${(m.peakHospitalLoad * 100).toFixed(0)}%`, true],
  ['Waited past their limit', (m) => String(m.pastLimitCount), true],
  ['Unserved at the end', (m) => String(m.unservedCount), true],
  ['Spread of load across hospitals', (m) => m.loadSpread.toFixed(3), true],
];

for (const [label, value] of rows) {
  console.log(pad(label, 44) + results.map((r) => value(r.metrics).padStart(10)).join(''));
}

console.log('');
for (const r of results) {
  const admitted = r.metrics.meanAdmissionMinBySeverity;
  const parts = (['red', 'yellow', 'green'] as const)
    .map((s) => (admitted[s] === undefined ? null : `${s} ${admitted[s]!.toFixed(1)}`))
    .filter(Boolean)
    .join(', ');
  console.log(`${pad(r.strategy, 10)} mean admission by severity: ${parts || 'none admitted'}`);
}
console.log('');
