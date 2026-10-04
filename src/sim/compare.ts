/**
 * Headless three-strategy comparison (CLAUDE.md sections 9.8, 13).
 *
 * Section 0 rule 5: all three run on the SAME seed, the SAME fleet and the
 * SAME scenario. Nothing else differs. If Pulse loses on a metric, the result
 * says so.
 */

import { Engine } from './engine';
import type { RoadGraph } from './graph';
import type { Scenario } from './scenario';
import type { Hospital, StrategyResult } from './types';

export interface ComparisonOptions {
  graph: RoadGraph;
  hospitals: Hospital[];
  scenario: Scenario;
  seed?: number;
  /** Simulated minutes to run. Defaults to the scenario duration. */
  minutes?: number;
}

export async function runComparison(
  options: ComparisonOptions,
): Promise<StrategyResult[]> {
  const seed = options.seed ?? options.scenario.seed;
  const minutes = options.minutes ?? options.scenario.durationMin;
  const results: StrategyResult[] = [];

  for (const strategy of ['pulse', 'nearest', 'fcfs'] as const) {
    const engine = new Engine({
      graph: options.graph,
      hospitals: options.hospitals,
      scenario: options.scenario,
      strategy,
      seed,
      // The comparison does not need an audit trail, and skipping it keeps
      // the run fast.
      withLedger: false,
    });

    for (let i = 0; i < minutes; i++) await engine.step();

    results.push({ strategy, seed, metrics: engine.metricsNow() });
  }

  return results;
}
