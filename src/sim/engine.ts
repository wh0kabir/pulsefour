/**
 * The simulation engine (CLAUDE.md section 7).
 *
 * Pure TypeScript. No DOM, no React, no browser globals beyond Web Crypto
 * (used by the ledger) and postMessage (used by the worker that wraps this).
 * Runs in Node tests.
 *
 * Determinism: all randomness comes from the seeded RNG, and iteration order
 * is fixed, so the same seed produces byte-identical state after N ticks.
 * That is what makes the three-strategy comparison honest.
 */

import {
  CONGESTION,
  FLEET,
  START_OCCUPANCY,
  SUPPLY_USE,
  TREATMENT_TIME_MIN,
} from '../config/assumptions';
import { AStar } from './astar';
import { DijkstraSolver, HospitalTreeCache, UNREACHABLE, type CostTree } from './dijkstra';
import { RoadGraph } from './graph';
import { Ledger } from './ledger';
import { computeMetrics, emptyAccumulator, emptyMetrics, type MetricAccumulator } from './metrics';
import { makeRng, type Rng } from './rng';
import { assertValidScenario, spawnCasualties, type Scenario } from './scenario';
import { STRATEGIES } from './strategies';
import type { AllocAmbulance, AllocHospital, Plan } from './allocator';
import type {
  Ambulance,
  Casualty,
  Decision,
  Hospital,
  LedgerRecord,
  OperatorAction,
  ScenarioEvent,
  Severity,
  Speed,
  Strategy,
  WorldState,
} from './types';

/** Internal per-ambulance state the UI never sees. */
interface AmbulanceState extends Ambulance {
  /** Index into routeEdgeIds of the edge currently being traversed. */
  routeIndex: number;
  /** Minutes already spent on the current edge. */
  edgeElapsedMin: number;
  /** Node the ambulance is at, or heading away from. */
  anchorNode: number;
  destNode: number;
  /** Cost of the plan that produced the current assignment. */
  currentPlanCost?: number;
}

interface Treatment {
  casualtyId: string;
  severity: Severity;
  freeAtMin: number;
}

export interface EngineOptions {
  graph: RoadGraph;
  hospitals: Hospital[];
  scenario: Scenario;
  strategy?: Strategy;
  seed?: number;
  systemVersion?: string;
  configHash?: string;
  /** Skip ledger writes. The headless comparison does not need them. */
  withLedger?: boolean;
}

const DECISION_WINDOW = 40;

export class Engine {
  readonly graph: RoadGraph;
  readonly scenario: Scenario;
  readonly ledger: Ledger;

  private rng: Rng;
  private seed: number;
  private strategy: Strategy;
  private readonly withLedger: boolean;

  private tick = 0;
  private simMin = 0;
  private running = false;
  private speed: Speed = 1;
  private autoAccept = true;

  private casualties: Casualty[] = [];
  private ambulances: AmbulanceState[] = [];
  private hospitals: Hospital[] = [];
  private treatments: Treatment[] = [];

  private decisions: Decision[] = [];
  private pending: string[] = [];
  private escalations: string[] = [];

  private acc: MetricAccumulator = emptyAccumulator();
  /** Per-casualty metric bookkeeping. */
  private responseMin = new Map<string, number>();
  private admissionMin = new Map<string, number>();
  private deliveredToTrauma = new Map<string, boolean>();

  private casualtyCounter = 0;
  private decisionCounter = 0;
  private firedEvents = new Set<number>();

  private readonly astar: AStar;
  private readonly dijkstra: DijkstraSolver;
  private readonly hospitalTrees: HospitalTreeCache;
  private ambulanceTrees = new Map<string, CostTree>();

  private readonly baseHospitals: Hospital[];

  constructor(options: EngineOptions) {
    assertValidScenario(options.scenario);

    this.graph = options.graph;
    this.scenario = options.scenario;
    this.strategy = options.strategy ?? 'pulse';
    this.withLedger = options.withLedger ?? true;
    this.seed = options.seed ?? options.scenario.seed;
    this.rng = makeRng(this.seed);

    this.baseHospitals = options.hospitals.map((h) => structuredCloneLike(h));

    this.astar = new AStar(this.graph);
    this.dijkstra = new DijkstraSolver(this.graph);
    this.hospitalTrees = new HospitalTreeCache(this.graph);

    this.ledger = new Ledger(
      options.systemVersion ?? 'dev',
      options.configHash ?? 'dev',
    );

    this.reset(this.seed);
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  reset(seed?: number): void {
    this.seed = seed ?? this.seed;
    this.rng = makeRng(this.seed);
    this.tick = 0;
    this.simMin = 0;
    this.running = false;
    this.casualties = [];
    this.treatments = [];
    this.decisions = [];
    this.pending = [];
    this.escalations = [];
    this.acc = emptyAccumulator();
    this.responseMin.clear();
    this.admissionMin.clear();
    this.deliveredToTrauma.clear();
    this.casualtyCounter = 0;
    this.decisionCounter = 0;
    this.firedEvents.clear();
    this.ambulanceTrees.clear();
    this.hospitalTrees.invalidate();
    this.graph.openEdges(this.graph.closedEdgeIds);
    this.graph.setCongestion(CONGESTION.default);

    // Hospitals: fresh copy, then seeded start-of-run occupancy.
    this.hospitals = this.baseHospitals.map((h) => {
      const copy = structuredCloneLike(h);
      const occupancy = this.rng.float(START_OCCUPANCY.min, START_OCCUPANCY.max);
      copy.beds.available = Math.max(
        0,
        copy.beds.total - Math.round(copy.beds.total * occupancy),
      );
      copy.beds.icuAvailable = Math.max(
        0,
        copy.beds.icuTotal - Math.round(copy.beds.icuTotal * occupancy),
      );
      copy.edQueue = [];
      return copy;
    });

    this.spawnFleet();
  }

  private spawnFleet(): void {
    const { als, bls } = this.scenario.fleet.als !== undefined
      ? this.scenario.fleet
      : { als: FLEET.als, bls: FLEET.bls };

    const startNodes: number[] = [];
    if (this.scenario.fleet.startPositions === 'hospitals') {
      // Spread the fleet round-robin across hospitals so they do not all
      // start in one place.
      for (let i = 0; i < als + bls; i++) {
        const hospital = this.hospitals[i % this.hospitals.length];
        startNodes.push(hospital ? hospital.nodeId : 0);
      }
    } else {
      for (let i = 0; i < als + bls; i++) {
        startNodes.push(this.scenario.fleet.startPositions[i % this.scenario.fleet.startPositions.length] ?? 0);
      }
    }

    this.ambulances = [];
    for (let i = 0; i < als + bls; i++) {
      const kind: 'ALS' | 'BLS' = i < als ? 'ALS' : 'BLS';
      const node = startNodes[i]!;
      const outgoing = this.graph.outEdges(node);
      const edgeId = outgoing.length > 0 ? outgoing[0]! : 0;
      this.ambulances.push({
        id: `${kind === 'ALS' ? 'A' : 'B'}${String(i + 1).padStart(2, '0')}`,
        kind,
        position: this.graph.position(node),
        edgePos: { edgeId, fraction: 0 },
        status: 'idle',
        routeEdgeIds: [],
        routeIndex: 0,
        edgeElapsedMin: 0,
        anchorNode: node,
        destNode: node,
      });
    }
  }

  play(): void {
    this.running = true;
  }

  pause(): void {
    this.running = false;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  setAutoAccept(value: boolean): void {
    this.autoAccept = value;
  }

  setStrategy(strategy: Strategy): void {
    this.strategy = strategy;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentMin(): number {
    return this.simMin;
  }

  /* ------------------------------------------------------------------ */
  /* The tick (section 7.3)                                             */
  /* ------------------------------------------------------------------ */

  async step(): Promise<void> {
    this.tick++;
    this.simMin++;

    this.advanceAmbulances();      // 1
    this.ageCasualties();          // 2
    this.completeTreatments();     // 3
    this.drainEdQueues();          // 4
    await this.spawnScheduled();   // 5
    await this.fireScriptedEvents(); // 6
    await this.runAllocation();    // 7
    this.updateMetrics();          // 8

    // Some appends are fire-and-forget (handover happens deep inside a
    // synchronous walk). Wait for them so the chain is complete and
    // verifiable before the state goes out.
    if (this.withLedger) await this.ledger.drain();
  }

  /** 1. Ambulances advance along their routes. */
  private advanceAmbulances(): void {
    for (const ambulance of this.ambulances) {
      if (ambulance.status === 'idle' || ambulance.status === 'offline') continue;
      if (ambulance.routeEdgeIds.length === 0) {
        this.onArrival(ambulance);
        continue;
      }

      let remaining = 1; // one simulated minute per tick
      while (remaining > 0 && ambulance.routeIndex < ambulance.routeEdgeIds.length) {
        const edgeId = ambulance.routeEdgeIds[ambulance.routeIndex]!;
        const edgeMinutes = this.graph.edgeMinutes(edgeId);
        const left = edgeMinutes - ambulance.edgeElapsedMin;

        if (left > remaining) {
          ambulance.edgeElapsedMin += remaining;
          remaining = 0;
        } else {
          remaining -= left;
          ambulance.routeIndex++;
          ambulance.edgeElapsedMin = 0;
          ambulance.anchorNode = this.graph.edgeTo[edgeId]!;

          // A road can close under an ambulance. It finishes the edge it is
          // on, then re-routes from the next junction (section 8).
          const nextEdge = ambulance.routeEdgeIds[ambulance.routeIndex];
          if (nextEdge !== undefined && this.graph.isClosed(nextEdge)) {
            const rerouted = this.astar.search(ambulance.anchorNode, ambulance.destNode);
            if (rerouted) {
              ambulance.routeEdgeIds = rerouted.edgeIds;
              ambulance.routeIndex = 0;
              ambulance.edgeElapsedMin = 0;
            } else {
              // Nowhere to go. Stop and let the allocator escalate.
              ambulance.routeEdgeIds = [];
              break;
            }
          }
        }
      }

      // Update the visible position.
      const edgeId = ambulance.routeEdgeIds[ambulance.routeIndex];
      if (edgeId !== undefined) {
        const edgeMinutes = this.graph.edgeMinutes(edgeId);
        const fraction = edgeMinutes > 0 ? ambulance.edgeElapsedMin / edgeMinutes : 0;
        ambulance.edgePos = { edgeId, fraction: Math.min(1, Math.max(0, fraction)) };
        ambulance.position = this.graph.positionOnEdge(edgeId, fraction);
      } else {
        ambulance.position = this.graph.position(ambulance.anchorNode);
      }

      if (ambulance.routeIndex >= ambulance.routeEdgeIds.length) {
        this.onArrival(ambulance);
      }
    }
  }

  private onArrival(ambulance: AmbulanceState): void {
    if (ambulance.status === 'to_patient') {
      const casualty = this.casualties.find((c) => c.id === ambulance.casualtyId);
      if (!casualty) {
        this.makeIdle(ambulance);
        return;
      }
      // On scene: record the response time once.
      if (!this.responseMin.has(casualty.id)) {
        this.responseMin.set(casualty.id, this.simMin - casualty.appearedAtMin);
      }
      casualty.status = 'transporting';
      ambulance.status = 'to_hospital';

      const hospital = this.hospitals.find((h) => h.id === ambulance.hospitalId);
      const target = hospital ? hospital.nodeId : ambulance.anchorNode;
      const route = this.astar.search(ambulance.anchorNode, target);
      ambulance.routeEdgeIds = route ? route.edgeIds : [];
      ambulance.routeIndex = 0;
      ambulance.edgeElapsedMin = 0;
      ambulance.destNode = target;
      if (ambulance.routeEdgeIds.length === 0) this.handover(ambulance);
      return;
    }

    if (ambulance.status === 'to_hospital') {
      this.handover(ambulance);
    }
  }

  /** Deliver the patient, or queue at the ED when the hospital is full. */
  private handover(ambulance: AmbulanceState): void {
    const casualty = this.casualties.find((c) => c.id === ambulance.casualtyId);
    const hospital = this.hospitals.find((h) => h.id === ambulance.hospitalId);
    if (!casualty || !hospital) {
      this.makeIdle(ambulance);
      return;
    }

    if (hospital.beds.available <= 0) {
      // Arriving at a full hospital is an overload event; the patient waits.
      this.acc.overloadEvents++;
      if (!hospital.edQueue.includes(casualty.id)) hospital.edQueue.push(casualty.id);
      casualty.status = 'queued_at_ed';
      casualty.hospitalId = hospital.id;
      this.makeIdle(ambulance);
      return;
    }

    this.admit(casualty, hospital);
    this.makeIdle(ambulance);
  }

  private admit(casualty: Casualty, hospital: Hospital): void {
    hospital.beds.available--;
    if (casualty.severity === 'red' && hospital.beds.icuAvailable > 0) {
      hospital.beds.icuAvailable--;
    }

    const need = SUPPLY_USE[casualty.severity as Exclude<Severity, 'black'>];
    if (need) {
      hospital.supplies.bloodUnits = Math.max(0, hospital.supplies.bloodUnits - need.bloodUnits);
      hospital.supplies.oxygenUnits = Math.max(0, hospital.supplies.oxygenUnits - need.oxygenUnits);
    }

    casualty.status = 'admitted';
    casualty.hospitalId = hospital.id;
    this.admissionMin.set(casualty.id, this.simMin - casualty.appearedAtMin);
    if (casualty.severity === 'red') {
      this.deliveredToTrauma.set(casualty.id, hospital.traumaCapable);
    }

    const treatMin = TREATMENT_TIME_MIN[casualty.severity as Exclude<Severity, 'black'>] ?? 60;
    this.treatments.push({
      casualtyId: casualty.id,
      severity: casualty.severity,
      freeAtMin: this.simMin + treatMin,
    });

    if (this.withLedger) {
      void this.ledger.append({
        simMin: this.simMin,
        type: 'handover',
        actor: 'system',
        payload: { casualtyId: casualty.id, hospitalId: hospital.id, severity: casualty.severity },
      });
    }
  }

  private makeIdle(ambulance: AmbulanceState): void {
    ambulance.status = 'idle';
    ambulance.casualtyId = undefined;
    ambulance.hospitalId = undefined;
    ambulance.routeEdgeIds = [];
    ambulance.routeIndex = 0;
    ambulance.edgeElapsedMin = 0;
    ambulance.currentPlanCost = undefined;
    ambulance.position = this.graph.position(ambulance.anchorNode);
  }

  /** 2. Waiting casualties age; past their limit is an adverse outcome. */
  private ageCasualties(): void {
    for (const casualty of this.casualties) {
      if (
        casualty.status === 'waiting' ||
        casualty.status === 'assigned' ||
        casualty.status === 'pickup' ||
        casualty.status === 'queued_at_ed'
      ) {
        casualty.waitedMin++;
        if (casualty.waitedMin > casualty.limitMin && casualty.status !== 'queued_at_ed') {
          // "Waited past limit", never "died" (section 7.4).
          casualty.status = 'adverse';
        }
      }
    }
  }

  /** 3. Treatment completes and frees a bed. */
  private completeTreatments(): void {
    const stillTreating: Treatment[] = [];
    for (const treatment of this.treatments) {
      if (treatment.freeAtMin <= this.simMin) {
        const casualty = this.casualties.find((c) => c.id === treatment.casualtyId);
        const hospital = this.hospitals.find((h) => h.id === casualty?.hospitalId);
        if (hospital) {
          hospital.beds.available = Math.min(hospital.beds.total, hospital.beds.available + 1);
          if (treatment.severity === 'red') {
            hospital.beds.icuAvailable = Math.min(
              hospital.beds.icuTotal,
              hospital.beds.icuAvailable + 1,
            );
          }
        }
      } else {
        stillTreating.push(treatment);
      }
    }
    this.treatments = stillTreating;
  }

  /** 4. Queued handovers complete when a bed frees. */
  private drainEdQueues(): void {
    for (const hospital of this.hospitals) {
      while (hospital.edQueue.length > 0 && hospital.beds.available > 0) {
        const casualtyId = hospital.edQueue.shift()!;
        const casualty = this.casualties.find((c) => c.id === casualtyId);
        if (!casualty) continue;
        this.admit(casualty, hospital);
      }
    }
  }

  /** 5. Scheduled casualties appear. */
  private async spawnScheduled(): Promise<void> {
    for (const wave of this.scenario.casualtySchedule) {
      if (wave.atMin !== this.simMin - 1 && !(this.simMin === 1 && wave.atMin === 0)) continue;
      await this.spawnWave(
        { lat: this.scenario.incident.lat, lng: this.scenario.incident.lng },
        wave.count,
        wave.severityMix,
        wave.spreadM,
      );
    }
  }

  private async spawnWave(
    center: { lat: number; lng: number },
    count: number,
    severityMix: Partial<Record<Severity, number>>,
    spreadM: number,
  ): Promise<void> {
    const fresh = spawnCasualties({
      graph: this.graph,
      rng: this.rng,
      center,
      count,
      severityMix,
      spreadM,
      simMin: this.simMin,
      nextId: () => `C${String(++this.casualtyCounter).padStart(3, '0')}`,
    });
    this.casualties.push(...fresh);

    if (this.withLedger) {
      for (const casualty of fresh) {
        await this.ledger.append({
          simMin: this.simMin,
          type: 'casualty_registered',
          actor: 'system',
          payload: { id: casualty.id, severity: casualty.severity, nodeId: casualty.nodeId },
        });
      }
    }
  }

  /** 6. Scripted guided-demo events. */
  private async fireScriptedEvents(): Promise<void> {
    const scripted = this.scenario.scriptedEvents ?? [];
    for (let i = 0; i < scripted.length; i++) {
      const entry = scripted[i]!;
      if (this.firedEvents.has(i) || entry.atMin > this.simMin) continue;
      this.firedEvents.add(i);
      await this.inject(entry.event, 'scenario');
    }
  }

  /** 7. Allocate. */
  private async runAllocation(): Promise<void> {
    const allocatable = this.casualties.filter(
      (c) =>
        c.severity !== 'black' &&
        (c.status === 'waiting' || c.status === 'assigned' || c.status === 'adverse'),
    );

    const available = this.ambulances.filter(
      (a) => a.status === 'idle' || a.status === 'to_patient',
    );

    if (allocatable.length === 0 || available.length === 0) {
      this.escalations = [];
      return;
    }

    // Forward trees for ambulances, reverse trees for hospitals (section 8).
    this.ambulanceTrees.clear();
    for (const ambulance of available) {
      this.ambulanceTrees.set(ambulance.id, this.dijkstra.forward(ambulance.anchorNode));
    }

    const allocAmbulances: AllocAmbulance[] = available.map((a) => ({
      id: a.id,
      kind: a.kind,
      anchorNode: a.anchorNode,
      currentCasualtyId: a.casualtyId,
      currentPlanCost: a.currentPlanCost,
    }));

    const allocHospitals: AllocHospital[] = this.hospitals.map((h) => ({
      id: h.id,
      name: h.name,
      nodeId: h.nodeId,
      traumaCapable: h.traumaCapable,
      hasIcu: h.hasIcu,
      bedsAvailable: h.beds.available,
      icuAvailable: h.beds.icuAvailable,
      bloodUnits: h.supplies.bloodUnits,
      oxygenUnits: h.supplies.oxygenUnits,
      loadFraction: h.beds.total > 0 ? 1 - h.beds.available / h.beds.total : 0,
    }));

    const hospitalNodeById = new Map(this.hospitals.map((h) => [h.id, h.nodeId]));

    const result = STRATEGIES[this.strategy]({
      simMin: this.simMin,
      casualties: allocatable,
      ambulances: allocAmbulances,
      hospitals: allocHospitals,
      travelFromAmbulance: (ambulanceId, node) => {
        const tree = this.ambulanceTrees.get(ambulanceId);
        return tree ? (tree[node] ?? UNREACHABLE) : UNREACHABLE;
      },
      travelToHospital: (hospitalId, node) => {
        const hospitalNode = hospitalNodeById.get(hospitalId);
        if (hospitalNode === undefined) return UNREACHABLE;
        const tree = this.hospitalTrees.treeFor(hospitalNode);
        return tree[node] ?? UNREACHABLE;
      },
    });

    for (const plan of result.plans) await this.applyPlan(plan);

    this.escalations = result.escalations.map((e) => e.casualtyId);
    if (this.withLedger) {
      for (const escalation of result.escalations) {
        // Only log an escalation the first time it appears for a casualty.
        if (this.decisions.some((d) => d.kind === 'escalation' && d.casualtyId === escalation.casualtyId)) {
          continue;
        }
        const decision = this.makeDecision('escalation', escalation.casualtyId, undefined, undefined, escalation.reason);
        this.decisions.push(decision);
        await this.ledger.append({
          simMin: this.simMin,
          type: 'escalation',
          actor: 'system',
          payload: { casualtyId: escalation.casualtyId, reason: escalation.reason },
        });
      }
    }

    this.trimDecisions();
  }

  private makeDecision(
    kind: Decision['kind'],
    casualtyId: string,
    ambulanceId: string | undefined,
    hospitalId: string | undefined,
    reason: string,
    factors?: Decision['factors'],
    alternatives: Decision['alternatives'] = [],
  ): Decision {
    return {
      id: `D${String(++this.decisionCounter).padStart(4, '0')}`,
      simMin: this.simMin,
      kind,
      status: 'suggested',
      casualtyId,
      ambulanceId,
      hospitalId,
      factors: factors ?? {
        travelToCasualtyMin: 0,
        travelToHospitalMin: 0,
        loadPenaltyMin: 0,
        severityWeight: 0,
        waitingFactor: 1,
        totalCost: 0,
      },
      alternatives,
      reason,
    };
  }

  private async applyPlan(plan: Plan): Promise<void> {
    const ambulance = this.ambulances.find((a) => a.id === plan.ambulanceId);
    const casualty = this.casualties.find((c) => c.id === plan.casualtyId);
    if (!ambulance || !casualty) return;

    // The allocator re-decides from scratch every tick, so it keeps proposing
    // the plan already in force. Nothing has changed, so there is nothing to
    // record: emitting it would flood the feed and the ledger with identical
    // rows and bury the decisions that did change.
    if (
      ambulance.casualtyId === plan.casualtyId &&
      ambulance.hospitalId === plan.hospitalId
    ) {
      return;
    }

    // An ambulance awaiting approval holds exactly ONE live suggestion.
    //
    // With auto-accept off the ambulance never becomes assigned, so the
    // allocator keeps proposing for it every tick. Without this the queue
    // grows by a row per ambulance per minute and the operator cannot tell
    // which suggestion is current. If the new plan is identical there is
    // nothing to show; if it differs it SUPERSEDES the old one, which stays
    // in the feed as history but leaves the queue.
    const existingPendingId = this.pending.find((id) => {
      const existing = this.decisions.find((d) => d.id === id);
      return existing?.ambulanceId === plan.ambulanceId;
    });

    if (existingPendingId) {
      const existing = this.decisions.find((d) => d.id === existingPendingId);
      if (
        existing?.casualtyId === plan.casualtyId &&
        existing?.hospitalId === plan.hospitalId
      ) {
        return;
      }
      this.pending = this.pending.filter((id) => id !== existingPendingId);
    }

    const decision = this.makeDecision(
      plan.isReassignment ? 'reassignment' : 'assignment',
      plan.casualtyId,
      plan.ambulanceId,
      plan.hospitalId,
      plan.reason,
      plan.factors,
      plan.alternatives,
    );

    this.decisions.push(decision);

    if (this.withLedger) {
      await this.ledger.append({
        simMin: this.simMin,
        type: plan.isReassignment ? 'reassignment' : 'assignment_suggested',
        actor: 'system',
        payload: {
          decisionId: decision.id,
          casualtyId: plan.casualtyId,
          ambulanceId: plan.ambulanceId,
          hospitalId: plan.hospitalId,
          factors: plan.factors,
        },
      });
    }

    if (this.autoAccept) {
      await this.commitDecision(decision, 'system-auto');
    } else {
      this.pending.push(decision.id);
    }
  }

  /** Turn a suggestion into movement. */
  private async commitDecision(
    decision: Decision,
    actor: 'system-auto' | 'operator',
  ): Promise<void> {
    const ambulance = this.ambulances.find((a) => a.id === decision.ambulanceId);
    const casualty = this.casualties.find((c) => c.id === decision.casualtyId);
    if (!ambulance || !casualty) return;

    // Free whoever this ambulance was going to before.
    if (ambulance.casualtyId && ambulance.casualtyId !== casualty.id) {
      const previous = this.casualties.find((c) => c.id === ambulance.casualtyId);
      if (previous && previous.status === 'assigned') {
        previous.status = 'waiting';
        previous.ambulanceId = undefined;
        previous.hospitalId = undefined;
      }
    }

    ambulance.casualtyId = casualty.id;
    ambulance.hospitalId = decision.hospitalId;
    ambulance.status = 'to_patient';
    ambulance.currentPlanCost = decision.factors.totalCost;
    ambulance.destNode = casualty.nodeId;

    const route = this.astar.search(ambulance.anchorNode, casualty.nodeId);
    ambulance.routeEdgeIds = route ? route.edgeIds : [];
    ambulance.routeIndex = 0;
    ambulance.edgeElapsedMin = 0;

    casualty.status = 'assigned';
    casualty.ambulanceId = ambulance.id;
    casualty.hospitalId = decision.hospitalId;

    decision.status = actor === 'operator' ? 'confirmed' : 'confirmed';

    if (this.withLedger) {
      await this.ledger.append({
        simMin: this.simMin,
        type: 'assignment_confirmed',
        actor,
        payload: { decisionId: decision.id, casualtyId: casualty.id, ambulanceId: ambulance.id },
      });
    }

    // Arriving on an already-reached node completes immediately.
    if (ambulance.routeEdgeIds.length === 0) this.onArrival(ambulance);
  }

  private trimDecisions(): void {
    if (this.decisions.length > DECISION_WINDOW) {
      this.decisions = this.decisions.slice(-DECISION_WINDOW);
      this.pending = this.pending.filter((id) => this.decisions.some((d) => d.id === id));
    }
  }

  /** 8. Metrics. */
  private updateMetrics(): void {
    let peak = this.acc.peakHospitalLoad;
    for (const hospital of this.hospitals) {
      if (hospital.beds.total === 0) continue;
      const load = 1 - hospital.beds.available / hospital.beds.total;
      if (load > peak) peak = load;
    }
    this.acc.peakHospitalLoad = peak;
  }

  private buildSamples(): MetricAccumulator {
    const samples = this.casualties.map((casualty) => ({
      severity: casualty.severity,
      responseMin: this.responseMin.get(casualty.id),
      admissionMin: this.admissionMin.get(casualty.id),
      deliveredToTrauma: this.deliveredToTrauma.get(casualty.id),
      pastLimit: casualty.status === 'adverse' || casualty.waitedMin > casualty.limitMin,
      unserved:
        casualty.status === 'waiting' ||
        casualty.status === 'unserved' ||
        casualty.status === 'adverse',
    }));
    return { ...this.acc, samples };
  }

  /* ------------------------------------------------------------------ */
  /* Scenario and operator surfaces (section 10)                        */
  /* ------------------------------------------------------------------ */

  async inject(event: ScenarioEvent, actor: 'scenario' | 'operator' = 'scenario'): Promise<void> {
    switch (event.type) {
      case 'closeRoad': {
        const ids = this.edgeIdsForEvent(event.osmid, event.edgeIds);
        this.graph.closeEdges(ids);
        this.hospitalTrees.invalidate();
        this.rerouteAll();
        break;
      }
      case 'openRoad': {
        const ids = this.edgeIdsForEvent(event.osmid, event.edgeIds);
        this.graph.openEdges(ids);
        this.hospitalTrees.invalidate();
        this.rerouteAll();
        break;
      }
      case 'fillHospital': {
        const hospital = this.hospitals.find((h) => h.id === event.hospitalId);
        if (hospital) {
          hospital.beds.available = Math.max(0, Math.min(hospital.beds.total, event.availableBeds));
        }
        break;
      }
      case 'surge': {
        await this.spawnWave(
          event.center,
          event.count,
          event.severityMix ?? { red: 0, yellow: 0, green: 0 },
          event.spreadM,
        );
        break;
      }
      case 'ambulanceOffline': {
        const ambulance = this.ambulances.find((a) => a.id === event.ambulanceId);
        if (ambulance) {
          // Its patient returns to the pool.
          const casualty = this.casualties.find((c) => c.id === ambulance.casualtyId);
          if (casualty && casualty.status !== 'admitted') {
            casualty.status = 'waiting';
            casualty.ambulanceId = undefined;
          }
          this.makeIdle(ambulance);
          ambulance.status = 'offline';
        }
        break;
      }
      case 'ambulanceOnline': {
        const ambulance = this.ambulances.find((a) => a.id === event.ambulanceId);
        if (ambulance && ambulance.status === 'offline') ambulance.status = 'idle';
        break;
      }
      case 'resupply': {
        const hospital = this.hospitals.find((h) => h.id === event.hospitalId);
        if (hospital) {
          hospital.supplies.bloodUnits += event.bloodUnits;
          hospital.supplies.oxygenUnits += event.oxygenUnits;
        }
        break;
      }
      case 'setCongestion': {
        this.graph.setCongestion(event.multiplier);
        this.hospitalTrees.invalidate();
        break;
      }
    }

    if (this.withLedger) {
      await this.ledger.append({
        simMin: this.simMin,
        type: 'event_injected',
        actor,
        payload: event as unknown,
      });
    }
  }

  private edgeIdsForEvent(osmid?: string, edgeIds?: number[]): number[] {
    if (edgeIds && edgeIds.length > 0) return edgeIds;
    if (osmid) return this.graph.edgeIdsForWay(Number(osmid));
    return [];
  }

  /** After the network changes, anyone en route needs a fresh path. */
  private rerouteAll(): void {
    for (const ambulance of this.ambulances) {
      if (ambulance.status !== 'to_patient' && ambulance.status !== 'to_hospital') continue;
      const route = this.astar.search(ambulance.anchorNode, ambulance.destNode);
      ambulance.routeEdgeIds = route ? route.edgeIds : [];
      ambulance.routeIndex = 0;
      ambulance.edgeElapsedMin = 0;
    }
  }

  async operator(action: OperatorAction): Promise<void> {
    switch (action.type) {
      case 'confirm': {
        const decision = this.decisions.find((d) => d.id === action.decisionId);
        if (decision) {
          this.pending = this.pending.filter((id) => id !== decision.id);
          await this.commitDecision(decision, 'operator');
        }
        break;
      }
      case 'override': {
        const decision = this.decisions.find((d) => d.id === action.decisionId);
        if (decision) {
          if (action.ambulanceId) decision.ambulanceId = action.ambulanceId;
          if (action.hospitalId) decision.hospitalId = action.hospitalId;
          decision.status = 'overridden';
          decision.reason = `Operator override. ${decision.reason}`;
          this.pending = this.pending.filter((id) => id !== decision.id);
          await this.commitDecision(decision, 'operator');
          if (this.withLedger) {
            await this.ledger.append({
              simMin: this.simMin,
              type: 'assignment_overridden',
              actor: 'operator',
              payload: { decisionId: decision.id, ambulanceId: decision.ambulanceId, hospitalId: decision.hospitalId },
            });
          }
        }
        break;
      }
      case 'reject': {
        const decision = this.decisions.find((d) => d.id === action.decisionId);
        if (decision) {
          decision.status = 'rejected';
          this.pending = this.pending.filter((id) => id !== decision.id);
          const casualty = this.casualties.find((c) => c.id === decision.casualtyId);
          if (casualty && casualty.status === 'assigned') casualty.status = 'waiting';
          if (this.withLedger) {
            await this.ledger.append({
              simMin: this.simMin,
              type: 'operator_action',
              actor: 'operator',
              payload: { action: 'reject', decisionId: decision.id },
            });
          }
        }
        break;
      }
      case 'resolveEscalation': {
        const casualty = this.casualties.find((c) => c.id === action.casualtyId);
        if (casualty) {
          if (action.resolution === 'markHandled') {
            casualty.status = 'unserved';
          } else if (action.resolution === 'forceDispatch' && action.hospitalId) {
            const free = this.ambulances.find((a) => a.status === 'idle');
            if (free) {
              const decision = this.makeDecision(
                'assignment',
                casualty.id,
                free.id,
                action.hospitalId,
                'Operator force-dispatched this casualty.',
              );
              this.decisions.push(decision);
              await this.commitDecision(decision, 'operator');
            }
          }
          this.escalations = this.escalations.filter((id) => id !== casualty.id);
          if (this.withLedger) {
            await this.ledger.append({
              simMin: this.simMin,
              type: 'operator_action',
              actor: 'operator',
              payload: { action: 'resolveEscalation', ...action },
            });
          }
        }
        break;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* State out                                                          */
  /* ------------------------------------------------------------------ */

  snapshot(): WorldState {
    return {
      tick: this.tick,
      simMin: this.simMin,
      running: this.running,
      speed: this.speed,
      strategy: this.strategy,
      autoAccept: this.autoAccept,
      congestion: this.graph.getCongestion(),
      casualties: this.casualties.map((c) => ({ ...c })),
      ambulances: this.ambulances.map((a) => ({
        id: a.id,
        kind: a.kind,
        position: { ...a.position },
        edgePos: { ...a.edgePos },
        status: a.status,
        routeEdgeIds: a.routeEdgeIds.slice(a.routeIndex),
        casualtyId: a.casualtyId,
        hospitalId: a.hospitalId,
      })),
      hospitals: this.hospitals.map((h) => structuredCloneLike(h)),
      closedEdgeIds: this.graph.closedEdgeIds,
      decisions: this.decisions.slice(-DECISION_WINDOW).map((d) => ({ ...d })),
      pending: [...this.pending],
      escalations: [...this.escalations],
      metrics: computeMetrics(this.buildSamples(), this.hospitals),
      ledgerHead: this.ledger.head,
      checkpoint: this.ledger.pinnedCheckpoint,
    };
  }

  newLedgerRecords(fromSeq: number): LedgerRecord[] {
    return this.ledger.slice(fromSeq);
  }

  metricsNow() {
    return computeMetrics(this.buildSamples(), this.hospitals);
  }
}

export function emptyWorldState(): WorldState {
  return {
    tick: 0,
    simMin: 0,
    running: false,
    speed: 1,
    strategy: 'pulse',
    autoAccept: true,
    congestion: 1,
    casualties: [],
    ambulances: [],
    hospitals: [],
    closedEdgeIds: [],
    decisions: [],
    pending: [],
    escalations: [],
    metrics: emptyMetrics(),
    ledgerHead: { seq: -1, hash: '0'.repeat(64) },
  };
}

/** Structured clone without needing the global, so this stays Node-safe. */
function structuredCloneLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
