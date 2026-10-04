import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { runComparison } from '../src/sim/compare';
import { Engine } from '../src/sim/engine';
import { RoadGraph } from '../src/sim/graph';
import type { Scenario } from '../src/sim/scenario';
import type { EngineOptions } from '../src/sim/engine';
import type { GraphFile, Hospital, WorldState } from '../src/sim/types';

const root = process.cwd();

let graphFile: GraphFile;
let hospitals: Hospital[];
let scenario: Scenario;

function newGraph(): RoadGraph {
  return new RoadGraph(graphFile);
}

function newEngine(overrides: Partial<EngineOptions> = {}) {
  return new Engine({
    graph: newGraph(),
    hospitals,
    scenario,
    withLedger: false,
    ...overrides,
  });
}

beforeAll(() => {
  graphFile = JSON.parse(
    readFileSync(join(root, 'public', 'data', 'graph.json'), 'utf8'),
  ) as GraphFile;
  hospitals = (
    JSON.parse(readFileSync(join(root, 'public', 'data', 'hospitals.json'), 'utf8')) as {
      hospitals: Hospital[];
    }
  ).hospitals;
  scenario = JSON.parse(
    readFileSync(join(root, 'public', 'data', 'scenario-parel.json'), 'utf8'),
  ) as Scenario;
});

/** Strip things that legitimately differ between runs (nothing should). */
function comparable(state: WorldState) {
  return JSON.stringify({
    tick: state.tick,
    simMin: state.simMin,
    casualties: state.casualties,
    ambulances: state.ambulances,
    hospitals: state.hospitals.map((h) => ({ id: h.id, beds: h.beds, supplies: h.supplies, edQueue: h.edQueue })),
    decisions: state.decisions.map((d) => ({ ...d, id: d.id })),
    escalations: state.escalations,
    metrics: state.metrics,
  });
}

describe('Engine setup', () => {
  it('spawns the fleet from the scenario', () => {
    const engine = newEngine();
    const state = engine.snapshot();
    expect(state.ambulances).toHaveLength(scenario.fleet.als + scenario.fleet.bls);
    expect(state.ambulances.filter((a) => a.kind === 'ALS')).toHaveLength(scenario.fleet.als);
    expect(state.ambulances.filter((a) => a.kind === 'BLS')).toHaveLength(scenario.fleet.bls);
  });

  it('seeds hospital occupancy between 25% and 45%', () => {
    const engine = newEngine();
    for (const hospital of engine.snapshot().hospitals) {
      const occupancy = 1 - hospital.beds.available / hospital.beds.total;
      expect(occupancy).toBeGreaterThanOrEqual(0.24);
      expect(occupancy).toBeLessThanOrEqual(0.46);
    }
  });

  it('starts every ambulance idle at a hospital', () => {
    const engine = newEngine();
    const state = engine.snapshot();
    expect(state.ambulances.every((a) => a.status === 'idle')).toBe(true);
  });
});

describe('determinism (M3 acceptance)', () => {
  it('produces identical state after N ticks for the same seed', async () => {
    const a = newEngine({ seed: 4242 });
    const b = newEngine({ seed: 4242 });

    for (let i = 0; i < 25; i++) {
      await a.step();
      await b.step();
    }

    expect(comparable(a.snapshot())).toBe(comparable(b.snapshot()));
  });

  it('produces different state for a different seed', async () => {
    const a = newEngine({ seed: 1 });
    const b = newEngine({ seed: 2 });
    for (let i = 0; i < 20; i++) {
      await a.step();
      await b.step();
    }
    expect(comparable(a.snapshot())).not.toBe(comparable(b.snapshot()));
  });

  it('reset returns the engine to a reproducible start', async () => {
    const engine = newEngine({ seed: 7 });
    const before = comparable(engine.snapshot());
    for (let i = 0; i < 10; i++) await engine.step();
    engine.reset(7);
    expect(comparable(engine.snapshot())).toBe(before);
  });
});

describe('the simulation actually simulates', () => {
  it('casualties appear on schedule', async () => {
    const engine = newEngine();
    await engine.step(); // minute 1 -> wave at minute 0
    const firstWave = scenario.casualtySchedule[0]!.count;
    expect(engine.snapshot().casualties.length).toBe(firstWave);
  });

  it('ambulances leave their stations and reach patients', async () => {
    const engine = newEngine();
    for (let i = 0; i < 20; i++) await engine.step();
    const state = engine.snapshot();
    expect(state.ambulances.some((a) => a.status !== 'idle')).toBe(true);
    // Someone should have been picked up or delivered by now.
    expect(
      state.casualties.some(
        (c) => c.status === 'transporting' || c.status === 'admitted' || c.status === 'queued_at_ed',
      ),
    ).toBe(true);
  });

  it('beds are consumed as patients are admitted, and freed after treatment', async () => {
    const engine = newEngine();
    const before = engine.snapshot().hospitals.reduce((s, h) => s + h.beds.available, 0);
    for (let i = 0; i < 30; i++) await engine.step();
    const mid = engine.snapshot();
    const after = mid.hospitals.reduce((s, h) => s + h.beds.available, 0);
    expect(mid.casualties.some((c) => c.status === 'admitted')).toBe(true);
    expect(after).toBeLessThan(before);
  });

  it('supplies are consumed on handover', async () => {
    const engine = newEngine();
    const before = engine.snapshot().hospitals.reduce((s, h) => s + h.supplies.oxygenUnits, 0);
    for (let i = 0; i < 30; i++) await engine.step();
    const after = engine.snapshot().hospitals.reduce((s, h) => s + h.supplies.oxygenUnits, 0);
    expect(after).toBeLessThan(before);
  });

  it('black casualties are never dispatched', async () => {
    const engine = newEngine();
    for (let i = 0; i < 30; i++) await engine.step();
    const state = engine.snapshot();
    const blacks = state.casualties.filter((c) => c.severity === 'black');
    expect(blacks.length).toBeGreaterThan(0);
    for (const casualty of blacks) {
      expect(casualty.ambulanceId).toBeUndefined();
      expect(casualty.status).toBe('unserved');
    }
  });

  it('casualty waiting time rises while they wait', async () => {
    const engine = newEngine();
    await engine.step();
    const first = engine.snapshot().casualties.find((c) => c.status === 'waiting');
    if (!first) return;
    for (let i = 0; i < 5; i++) await engine.step();
    const later = engine.snapshot().casualties.find((c) => c.id === first.id);
    expect(later!.waitedMin).toBeGreaterThan(first.waitedMin);
  });

  it('scripted events fire and close a road', async () => {
    const engine = newEngine();
    for (let i = 0; i < 14; i++) await engine.step();
    // The scenario closes a road at minute 12.
    expect(engine.snapshot().closedEdgeIds.length).toBeGreaterThan(0);
  });
});

describe('decisions carry their reasoning (section 9.7)', () => {
  it('every assignment has factors and a plain-English reason', async () => {
    const engine = newEngine();
    for (let i = 0; i < 12; i++) await engine.step();
    const decisions = engine.snapshot().decisions.filter((d) => d.kind !== 'escalation');
    expect(decisions.length).toBeGreaterThan(0);

    for (const decision of decisions) {
      expect(decision.reason.length).toBeGreaterThan(10);
      expect(decision.factors.travelToCasualtyMin).toBeGreaterThanOrEqual(0);
      expect(decision.factors.travelToHospitalMin).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(decision.factors.totalCost)).toBe(true);
      expect(decision.ambulanceId).toBeTruthy();
      expect(decision.hospitalId).toBeTruthy();
    }
  });

  it('red casualties are only sent to trauma-capable hospitals', async () => {
    const engine = newEngine();
    for (let i = 0; i < 25; i++) await engine.step();
    const state = engine.snapshot();
    const traumaIds = new Set(state.hospitals.filter((h) => h.traumaCapable).map((h) => h.id));

    for (const casualty of state.casualties) {
      if (casualty.severity !== 'red') continue;
      if (!casualty.hospitalId) continue;
      expect(traumaIds.has(casualty.hospitalId)).toBe(true);
    }
  });
});

describe('operator surface (section 10)', () => {
  it('with auto-accept off, assignments wait in the pending queue', async () => {
    const engine = newEngine();
    engine.setAutoAccept(false);
    for (let i = 0; i < 4; i++) await engine.step();
    const state = engine.snapshot();
    expect(state.pending.length).toBeGreaterThan(0);
    expect(state.ambulances.every((a) => a.status === 'idle')).toBe(true);
  });

  it('confirming a pending decision dispatches the ambulance', async () => {
    const engine = newEngine();
    engine.setAutoAccept(false);
    for (let i = 0; i < 3; i++) await engine.step();

    const pendingId = engine.snapshot().pending[0]!;
    await engine.operator({ type: 'confirm', decisionId: pendingId });

    const after = engine.snapshot();
    expect(after.pending).not.toContain(pendingId);
    expect(after.ambulances.some((a) => a.status !== 'idle')).toBe(true);
  });

  it('rejecting a decision returns the casualty to waiting', async () => {
    const engine = newEngine();
    engine.setAutoAccept(false);
    for (let i = 0; i < 3; i++) await engine.step();

    const decision = engine.snapshot().decisions.find((d) => d.kind === 'assignment')!;
    await engine.operator({ type: 'reject', decisionId: decision.id });

    const after = engine.snapshot();
    const casualty = after.casualties.find((c) => c.id === decision.casualtyId)!;
    expect(['waiting', 'adverse', 'unserved']).toContain(casualty.status);
  });

  it('taking an ambulance offline returns its patient to the pool', async () => {
    const engine = newEngine();
    for (let i = 0; i < 6; i++) await engine.step();
    const busy = engine.snapshot().ambulances.find((a) => a.status === 'to_patient');
    if (!busy) return;

    await engine.inject({ type: 'ambulanceOffline', ambulanceId: busy.id });
    const after = engine.snapshot();
    const ambulance = after.ambulances.find((a) => a.id === busy.id)!;
    expect(ambulance.status).toBe('offline');
    expect(ambulance.casualtyId).toBeUndefined();
  });
});

describe('scenario events (section 10)', () => {
  it('filling a hospital drops its available beds', async () => {
    const engine = newEngine();
    await engine.step();
    const target = engine.snapshot().hospitals[0]!;
    await engine.inject({ type: 'fillHospital', hospitalId: target.id, availableBeds: 0 });
    const after = engine.snapshot().hospitals.find((h) => h.id === target.id)!;
    expect(after.beds.available).toBe(0);
  });

  it('a surge adds casualties', async () => {
    const engine = newEngine();
    await engine.step();
    const before = engine.snapshot().casualties.length;
    await engine.inject({
      type: 'surge',
      center: { lat: scenario.incident.lat, lng: scenario.incident.lng },
      count: 5,
      spreadM: 200,
      severityMix: { red: 1, yellow: 2, green: 2 },
    });
    expect(engine.snapshot().casualties.length).toBe(before + 5);
  });

  it('congestion slows the world down', async () => {
    const engine = newEngine();
    await engine.inject({ type: 'setCongestion', multiplier: 0.7 });
    expect(engine.snapshot().congestion).toBeCloseTo(0.7, 6);
  });

  it('resupply raises a hospital stock', async () => {
    const engine = newEngine();
    const target = engine.snapshot().hospitals[0]!;
    const before = target.supplies.bloodUnits;
    await engine.inject({ type: 'resupply', hospitalId: target.id, bloodUnits: 10, oxygenUnits: 5 });
    const after = engine.snapshot().hospitals.find((h) => h.id === target.id)!;
    expect(after.supplies.bloodUnits).toBe(before + 10);
  });
});

describe('three strategies on one seed (M5 acceptance)', () => {
  it('runs all three and reports metrics for each', async () => {
    const results = await runComparison({
      graph: newGraph(),
      hospitals,
      scenario,
      seed: 20171029,
      minutes: 45,
    });

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.strategy)).toEqual(['pulse', 'nearest', 'fcfs']);

    // Identical seed for all three: that is the whole point.
    expect(new Set(results.map((r) => r.seed)).size).toBe(1);

    for (const result of results) {
      expect(result.metrics.meanResponseMin).toBeGreaterThanOrEqual(0);
      expect(result.metrics.shareWithinTarget).toBeGreaterThanOrEqual(0);
      expect(result.metrics.shareWithinTarget).toBeLessThanOrEqual(1);
      expect(result.metrics.redToTraumaShare).toBeGreaterThanOrEqual(0);
      expect(result.metrics.redToTraumaShare).toBeLessThanOrEqual(1);
    }

    // Report honestly, whatever the numbers say (section 0, rule 5).
    const line = (r: (typeof results)[number]) =>
      `${r.strategy.padEnd(8)} response ${r.metrics.meanResponseMin.toFixed(1)} min` +
      `  within target ${(r.metrics.shareWithinTarget * 100).toFixed(0)}%` +
      `  red->trauma ${(r.metrics.redToTraumaShare * 100).toFixed(0)}%` +
      `  overloads ${r.metrics.overloadEvents}` +
      `  past limit ${r.metrics.pastLimitCount}` +
      `  unserved ${r.metrics.unservedCount}`;
    for (const r of results) console.log('  ' + line(r));
  }, 120_000);

  it('is reproducible: the same comparison twice gives the same numbers', async () => {
    const once = await runComparison({ graph: newGraph(), hospitals, scenario, seed: 99, minutes: 20 });
    const twice = await runComparison({ graph: newGraph(), hospitals, scenario, seed: 99, minutes: 20 });
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  }, 120_000);
});

describe('the audit trail survives a real run (M8 acceptance)', () => {
  it('verifies as intact after many ticks with the ledger on', async () => {
    const engine = new Engine({
      graph: newGraph(),
      hospitals,
      scenario,
      seed: 20171029,
      withLedger: true,
    });

    for (let i = 0; i < 30; i++) await engine.step();
    await engine.ledger.drain();

    expect(engine.ledger.length).toBeGreaterThan(20);

    // Sequence numbers must be dense and in order.
    const seqs = engine.ledger.all.map((r) => r.seq);
    expect(seqs).toEqual([...Array(seqs.length).keys()]);

    engine.ledger.pinCheckpoint();
    const result = await engine.ledger.verify();
    expect(result.state).toBe('intact');
  }, 60_000);

  it('records carry the system version and config hash', async () => {
    const engine = new Engine({
      graph: newGraph(),
      hospitals,
      scenario,
      systemVersion: '9.9.9+abcdef',
      configHash: 'deadbeef',
      withLedger: true,
    });
    await engine.step();
    await engine.ledger.drain();
    for (const record of engine.ledger.all) {
      expect(record.systemVersion).toBe('9.9.9+abcdef');
      expect(record.configHash).toBe('deadbeef');
    }
  });
});

describe('the pending queue does not fill with duplicates', () => {
  it('proposes each ambulance-casualty pairing once while awaiting approval', async () => {
    const engine = newEngine();
    engine.setAutoAccept(false);

    for (let i = 0; i < 12; i++) await engine.step();

    const state = engine.snapshot();
    const pairs = state.pending
      .map((id) => state.decisions.find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
      .map((d) => `${d.ambulanceId}->${d.casualtyId}`);

    expect(pairs.length).toBeGreaterThan(0);
    // Every queued suggestion is for a distinct pairing.
    expect(new Set(pairs).size).toBe(pairs.length);
    // And no more suggestions than there are ambulances to act on them.
    expect(pairs.length).toBeLessThanOrEqual(state.ambulances.length);
  });
});

describe('admission metrics are readable (regression)', () => {
  it('reports how many of each severity reached a bed, not just the mean', async () => {
    // A strategy that admits only its fastest few posts the best-looking mean
    // admission time while leaving the rest queued at a full hospital. The
    // counts are what make that visible.
    const results = await runComparison({
      graph: newGraph(),
      hospitals,
      scenario,
      seed: 20171029,
      minutes: scenario.durationMin,
    });

    for (const result of results) {
      const admitted = result.metrics.admittedBySeverity.red;
      const total = result.metrics.totalBySeverity.red;
      expect(total).toBeGreaterThan(0);
      expect(admitted).toBeGreaterThanOrEqual(0);
      expect(admitted!).toBeLessThanOrEqual(total!);

      // A mean is only reported when somebody was actually admitted.
      if (result.metrics.meanAdmissionMinBySeverity.red !== undefined) {
        expect(admitted).toBeGreaterThan(0);
      }
    }

    const nearest = results.find((r) => r.strategy === 'nearest')!;
    const pulse = results.find((r) => r.strategy === 'pulse')!;
    // The artifact this guards against: nearest looks faster on the mean
    // precisely because it admits fewer of them.
    if (
      (nearest.metrics.meanAdmissionMinBySeverity.red ?? Infinity) <
      (pulse.metrics.meanAdmissionMinBySeverity.red ?? Infinity)
    ) {
      expect(nearest.metrics.admittedBySeverity.red!).toBeLessThan(
        pulse.metrics.admittedBySeverity.red!,
      );
    }
  }, 180_000);
});
