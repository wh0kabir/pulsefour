/**
 * Freeze a WorldState snapshot for public/data/sample-state.json.
 *
 * CLAUDE.md section 5 uses this as the fixture the UI can render without a
 * worker. It is produced by the real engine so it is always in the exact
 * shape the UI will receive at runtime.
 *
 *     node scripts/build-sample-state.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine } from '../src/sim/engine.ts';
import { RoadGraph } from '../src/sim/graph.ts';
import type { GraphFile, Hospital } from '../src/sim/types.ts';
import type { Scenario } from '../src/sim/scenario.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const graph = new RoadGraph(read('public/data/graph.json') as GraphFile);
const hospitals = (read('public/data/hospitals.json') as { hospitals: Hospital[] }).hospitals;
const scenario = read('public/data/scenario-parel.json') as Scenario;

const engine = new Engine({ graph, hospitals, scenario, withLedger: false });
for (let i = 0; i < 14; i++) await engine.step();

const state = engine.snapshot();
const out = join(ROOT, 'public', 'data', 'sample-state.json');
writeFileSync(out, JSON.stringify(state, null, 1), 'utf8');

console.log(`wrote public/data/sample-state.json at sim minute ${state.simMin}`);
console.log(`  ${state.casualties.length} casualties, ${state.ambulances.length} ambulances,`);
console.log(`  ${state.hospitals.length} hospitals, ${state.decisions.length} decisions`);
