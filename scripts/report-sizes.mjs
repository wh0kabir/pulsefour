/**
 * Report node and edge counts, raw and gzipped sizes for the committed data
 * files (CLAUDE.md section 6.1).
 *
 *     node scripts/report-sizes.mjs
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'data/raw/roads.graphml',
  'data/raw/roads.json',
  'public/data/graph.json',
  'public/data/hospitals.json',
  'public/data/scenario-parel.json',
];

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

console.log('file                              raw        gzipped');
console.log('-'.repeat(58));

for (const relative of FILES) {
  const path = join(ROOT, relative);
  if (!existsSync(path)) {
    console.log(`${relative.padEnd(32)} (not built)`);
    continue;
  }
  const raw = statSync(path).size;
  const gz = gzipSync(readFileSync(path)).length;
  console.log(`${relative.padEnd(32)} ${kb(raw).padStart(9)}  ${kb(gz).padStart(9)}`);
}

const graphPath = join(ROOT, 'public/data/graph.json');
if (existsSync(graphPath)) {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  console.log('');
  console.log(`nodes:          ${graph.meta.nodeCount.toLocaleString()}`);
  console.log(`edges:          ${graph.meta.edgeCount.toLocaleString()}`);
  console.log(`street names:   ${graph.names.length.toLocaleString()}`);
  console.log(`curved edges:   ${graph.edges.geom.filter((g) => g !== 0).length.toLocaleString()}`);
  console.log(`component:      ${graph.meta.component}`);
}

const hospitalPath = join(ROOT, 'public/data/hospitals.json');
if (existsSync(hospitalPath)) {
  const file = JSON.parse(readFileSync(hospitalPath, 'utf8'));
  console.log(`hospitals:      ${file.meta.hospitalCount} (${file.meta.traumaCapableCount} trauma-capable, simulated)`);
}
