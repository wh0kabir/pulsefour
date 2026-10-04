// @ts-check
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Ledger records carry the package version plus the git short sha, injected
// at build time (CLAUDE.md section 11).
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
let sha = 'nogit';
try {
  sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  // Not a git checkout, or git is unavailable. The version still identifies
  // the release; the sha is a nicety.
}
const PULSE_VERSION = `${pkg.version}+${sha}`;

// https://astro.build/config
export default defineConfig({
  // Locked decision 11: browser only, static deploy, no backend.
  output: 'static',
  integrations: [react()],
  vite: {
    // Tailwind 4 is wired through its Vite plugin, not a PostCSS config.
    plugins: [tailwindcss()],
    define: {
      __PULSE_VERSION__: JSON.stringify(PULSE_VERSION),
    },
    // MapLibre's worker is an ES module. Rollup bundles workers as IIFE by
    // default, which makes the built site fail with "Worker failed to load"
    // and render a blank map. This only affects `astro build`, not dev.
    worker: { format: 'es' },
    optimizeDeps: {
      // MapLibre spawns its worker via `new Worker(new URL(..., import.meta.url))`.
      // Vite's dependency pre-bundling rewrites that URL and the worker then
      // fails to load, leaving the map blank. Excluding it keeps the package
      // as real ES modules so the worker URL resolves.
      exclude: ['maplibre-gl'],
    },
  },
});
