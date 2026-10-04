/**
 * The allocator (CLAUDE.md section 9). This is the heart of the project.
 *
 * Every tick it reconsiders the whole picture from scratch, with the stability
 * rules in 9.5 stopping it flip-flopping. It does NOT greedily hand out the
 * nearest ambulance: it builds an ambulance x casualty cost matrix and solves
 * the whole board at once with the Hungarian method, which is what lets a
 * distant red casualty outrank a nearby yellow one.
 */

import {
  ALS_PREFERENCE_PENALTY_MIN,
  ICU_SHORTAGE_PENALTY_MIN,
  LAMBDA,
  REASSIGNMENT_MARGIN,
  SEVERITY_WEIGHT,
  SUPPLY_USE,
  loadPenaltyMin,
  waitingFactor,
} from '../config/assumptions';
import { UNREACHABLE } from './dijkstra';
import { hungarian } from './hungarian';
import type {
  Casualty,
  DecisionAlternative,
  DecisionFactors,
  Severity,
} from './types';

/** The large finite value used for an infeasible pairing (section 9.2). */
export const INFEASIBLE = 1e9;

export interface AllocAmbulance {
  id: string;
  kind: 'BLS' | 'ALS';
  /** Node the ambulance is routing from this tick. */
  anchorNode: number;
  /** Casualty it is currently heading to, if any. */
  currentCasualtyId?: string;
  /** Cost of its current plan, for the hysteresis rule. */
  currentPlanCost?: number;
}

export interface AllocHospital {
  id: string;
  name: string;
  nodeId: number;
  traumaCapable: boolean;
  hasIcu: boolean;
  bedsAvailable: number;
  icuAvailable: number;
  bloodUnits: number;
  oxygenUnits: number;
  loadFraction: number;
}

export interface AllocationContext {
  simMin: number;
  casualties: Casualty[];
  ambulances: AllocAmbulance[];
  hospitals: AllocHospital[];
  /** Travel minutes from an ambulance to a node. UNREACHABLE when no route. */
  travelFromAmbulance: (ambulanceId: string, node: number) => number;
  /** Travel minutes from a node into a hospital. UNREACHABLE when no route. */
  travelToHospital: (hospitalId: string, node: number) => number;
}

export interface Plan {
  casualtyId: string;
  ambulanceId: string;
  hospitalId: string;
  factors: DecisionFactors;
  alternatives: DecisionAlternative[];
  reason: string;
  /** True when this replaces an existing assignment for that ambulance. */
  isReassignment: boolean;
}

export interface Escalation {
  casualtyId: string;
  reason: string;
}

export interface AllocationResult {
  plans: Plan[];
  escalations: Escalation[];
}

interface HospitalChoice {
  hospital: AllocHospital;
  travelToHospitalMin: number;
  loadPenalty: number;
  icuPenalty: number;
  total: number;
}

/** Why a hospital was ruled out, in words the operator can read. */
function hospitalRejection(
  hospital: AllocHospital,
  casualty: Casualty,
  reserved: Map<string, number>,
  travelMin: number,
): string | null {
  const taken = reserved.get(hospital.id) ?? 0;
  if (hospital.bedsAvailable - taken <= 0) return `${hospital.name}: no beds`;
  if (casualty.severity === 'red' && !hospital.traumaCapable) {
    return `${hospital.name}: not trauma-capable`;
  }
  const need = SUPPLY_USE[casualty.severity as Exclude<Severity, 'black'>];
  if (need) {
    if (hospital.bloodUnits < need.bloodUnits) return `${hospital.name}: no blood units`;
    if (hospital.oxygenUnits < need.oxygenUnits) return `${hospital.name}: no oxygen`;
  }
  if (travelMin === UNREACHABLE || !Number.isFinite(travelMin)) {
    return `${hospital.name}: route blocked`;
  }
  return null;
}

/**
 * Best feasible hospital for a casualty, plus the runners-up and why each
 * rejected option was rejected (section 9.7).
 */
function bestHospitalFor(
  casualty: Casualty,
  context: AllocationContext,
  reserved: Map<string, number>,
): { best: HospitalChoice | null; alternatives: DecisionAlternative[] } {
  const scored: HospitalChoice[] = [];
  const alternatives: DecisionAlternative[] = [];

  for (const hospital of context.hospitals) {
    const travel = context.travelToHospital(hospital.id, casualty.nodeId);
    const rejection = hospitalRejection(hospital, casualty, reserved, travel);
    if (rejection) {
      alternatives.push({ hospitalId: hospital.id, rejectedBecause: rejection });
      continue;
    }

    const loadPenalty = loadPenaltyMin(hospital.loadFraction);
    // A casualty needing intensive care sent somewhere with no free ICU bed
    // is allowed, but it costs.
    const icuPenalty =
      casualty.severity === 'red' && hospital.icuAvailable <= 0
        ? ICU_SHORTAGE_PENALTY_MIN
        : 0;

    scored.push({
      hospital,
      travelToHospitalMin: travel,
      loadPenalty,
      icuPenalty,
      total: travel + loadPenalty + icuPenalty,
    });
  }

  scored.sort((a, b) => a.total - b.total);
  // Keep the next two best as named alternatives with their real costs.
  for (const choice of scored.slice(1, 3)) {
    alternatives.push({
      hospitalId: choice.hospital.id,
      cost: round1(choice.total),
      rejectedBecause: 'higher total cost',
    });
  }

  return { best: scored[0] ?? null, alternatives };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function severityWeightOf(severity: Severity): number {
  if (severity === 'black') return 0;
  return SEVERITY_WEIGHT[severity];
}

/**
 * Run one allocation pass.
 *
 * Capacity conflicts are resolved by re-solving with reservations applied, up
 * to three times (section 9.4), then falling back to sequential resolution.
 */
export function allocate(context: AllocationContext): AllocationResult {
  const { casualties, ambulances } = context;

  if (ambulances.length === 0 || casualties.length === 0) {
    return { plans: [], escalations: raiseEscalations(context, new Set()) };
  }

  let reserved = new Map<string, number>();
  let plans: Plan[] = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = solveOnce(context, reserved);
    plans = result.plans;

    // Count how many plans want a bed at each hospital.
    const wanted = new Map<string, number>();
    for (const plan of plans) {
      wanted.set(plan.hospitalId, (wanted.get(plan.hospitalId) ?? 0) + 1);
    }

    const overbooked = [...wanted.entries()].filter(([hospitalId, count]) => {
      const hospital = context.hospitals.find((h) => h.id === hospitalId);
      return hospital ? count > hospital.bedsAvailable : false;
    });

    if (overbooked.length === 0) break;

    // Reserve beds for the highest-benefit pairs and re-solve so the losers
    // pick their next best hospital.
    reserved = new Map();
    const byBenefit = [...plans].sort(
      (a, b) => b.factors.severityWeight * b.factors.waitingFactor
              - a.factors.severityWeight * a.factors.waitingFactor,
    );
    for (const plan of byBenefit) {
      const hospital = context.hospitals.find((h) => h.id === plan.hospitalId);
      if (!hospital) continue;
      const taken = reserved.get(plan.hospitalId) ?? 0;
      if (taken < hospital.bedsAvailable) {
        reserved.set(plan.hospitalId, taken + 1);
      }
    }
  }

  // Final sequential pass: never hand out more beds than exist.
  const issued = new Map<string, number>();
  const accepted: Plan[] = [];
  const byBenefit = [...plans].sort(
    (a, b) => b.factors.severityWeight * b.factors.waitingFactor
            - a.factors.severityWeight * a.factors.waitingFactor,
  );
  for (const plan of byBenefit) {
    const hospital = context.hospitals.find((h) => h.id === plan.hospitalId);
    if (!hospital) continue;
    const taken = issued.get(plan.hospitalId) ?? 0;
    if (taken >= hospital.bedsAvailable) continue; // bed went to a higher-benefit pair
    issued.set(plan.hospitalId, taken + 1);
    accepted.push(plan);
  }

  const served = new Set(accepted.map((p) => p.casualtyId));
  return { plans: accepted, escalations: raiseEscalations(context, served) };
}

function solveOnce(
  context: AllocationContext,
  reserved: Map<string, number>,
): { plans: Plan[] } {
  const { ambulances, casualties } = context;

  // Precompute the best hospital per casualty once per solve.
  const hospitalChoice = new Map<
    string,
    { best: HospitalChoice | null; alternatives: DecisionAlternative[] }
  >();
  for (const casualty of casualties) {
    hospitalChoice.set(casualty.id, bestHospitalFor(casualty, context, reserved));
  }

  // --- cost matrix (section 9.2) ---------------------------------------
  const matrix: number[][] = [];
  for (const ambulance of ambulances) {
    const row: number[] = [];
    for (const casualty of casualties) {
      const choice = hospitalChoice.get(casualty.id)!;
      const toCasualty = context.travelFromAmbulance(ambulance.id, casualty.nodeId);

      if (!choice.best || toCasualty === UNREACHABLE || !Number.isFinite(toCasualty)) {
        row.push(INFEASIBLE);
        continue;
      }

      const alsPenalty =
        casualty.severity === 'red' && ambulance.kind === 'BLS'
          ? ALS_PREFERENCE_PENALTY_MIN
          : 0;

      const trip =
        toCasualty +
        choice.best.travelToHospitalMin +
        choice.best.loadPenalty +
        alsPenalty +
        choice.best.icuPenalty;

      // Subtracting the benefit is what lets severity beat proximity.
      const benefit =
        severityWeightOf(casualty.severity) * waitingFactor(casualty.waitedMin);

      row.push(LAMBDA * trip - benefit);
    }
    matrix.push(row);
  }

  const { assignment } = hungarian(matrix);
  const plans: Plan[] = [];

  for (let a = 0; a < ambulances.length; a++) {
    const c = assignment[a]!;
    if (c < 0) continue;

    const cell = matrix[a]![c]!;
    // At or above M this is not a real assignment (section 9.3).
    if (cell >= INFEASIBLE) continue;

    const ambulance = ambulances[a]!;
    const casualty = casualties[c]!;
    const choice = hospitalChoice.get(casualty.id)!;
    if (!choice.best) continue;

    const toCasualty = context.travelFromAmbulance(ambulance.id, casualty.nodeId);
    const severityWeight = severityWeightOf(casualty.severity);
    const waiting = waitingFactor(casualty.waitedMin);

    const factors: DecisionFactors = {
      travelToCasualtyMin: round1(toCasualty),
      travelToHospitalMin: round1(choice.best.travelToHospitalMin),
      loadPenaltyMin: round1(choice.best.loadPenalty),
      severityWeight,
      waitingFactor: Math.round(waiting * 100) / 100,
      totalCost: round1(cell),
    };

    // --- stability rule 2: hysteresis (section 9.5) --------------------
    const isReassignment =
      ambulance.currentCasualtyId !== undefined &&
      ambulance.currentCasualtyId !== casualty.id;

    if (isReassignment) {
      // Compare against the cost of CONTINUING with the current casualty,
      // recomputed under this tick's conditions.
      //
      // Using the cost recorded when the assignment was made would be wrong:
      // every cost drifts as waiting factors grow, so a stale baseline makes
      // almost any alternative look like a large improvement. That produced
      // continuous churn, with ambulances re-routed every minute and never
      // arriving -- exactly the flip-flopping this rule exists to stop.
      const currentColumn = casualties.findIndex((x) => x.id === ambulance.currentCasualtyId);
      const continuingCost =
        currentColumn >= 0 ? matrix[a]![currentColumn]! : undefined;

      if (continuingCost !== undefined && continuingCost < INFEASIBLE) {
        const improvement = improvementFraction(continuingCost, cell);
        if (improvement < REASSIGNMENT_MARGIN) continue; // not worth the churn
      }
    }

    plans.push({
      casualtyId: casualty.id,
      ambulanceId: ambulance.id,
      hospitalId: choice.best.hospital.id,
      factors,
      alternatives: choice.alternatives.slice(0, 4),
      reason: buildReason(ambulance, casualty, choice.best, factors, isReassignment),
      isReassignment,
    });
  }

  return { plans };
}

/**
 * How much better a new plan is than the current one, as a fraction.
 *
 * Costs can be negative (benefit is subtracted), so a plain ratio is
 * meaningless. Comparing against the magnitude of the current cost keeps the
 * margin well-defined on both sides of zero.
 */
export function improvementFraction(currentCost: number, newCost: number): number {
  const scale = Math.max(Math.abs(currentCost), 1);
  return (currentCost - newCost) / scale;
}

function buildReason(
  ambulance: AllocAmbulance,
  casualty: Casualty,
  choice: HospitalChoice,
  factors: DecisionFactors,
  isReassignment: boolean,
): string {
  const severity = casualty.severity.toUpperCase();
  const where = choice.hospital.name;
  const parts: string[] = [];

  if (isReassignment) {
    parts.push(`${ambulance.id} reassigned to ${casualty.id} (${severity})`);
  } else {
    parts.push(`${ambulance.id} to ${casualty.id} (${severity})`);
  }

  parts.push(
    `${factors.travelToCasualtyMin} min to scene, ` +
      `${factors.travelToHospitalMin} min on to ${where}`,
  );

  if (factors.loadPenaltyMin > 0) {
    parts.push(`${where} is filling up, so it costs ${factors.loadPenaltyMin} min extra`);
  }
  if (casualty.severity === 'red') {
    parts.push(`${where} is trauma-capable`);
  }
  if (factors.waitingFactor > 1.2) {
    parts.push(`waiting ${casualty.waitedMin} min, priority raised ${factors.waitingFactor}x`);
  }

  return `${parts.join('. ')}.`;
}

function reachableByAnyAmbulance(context: AllocationContext, node: number): boolean {
  for (const ambulance of context.ambulances) {
    const minutes = context.travelFromAmbulance(ambulance.id, node);
    if (minutes !== UNREACHABLE && Number.isFinite(minutes)) return true;
  }
  return false;
}

/** A casualty who cannot be served is raised to a human, never dropped (9.6). */
function raiseEscalations(
  context: AllocationContext,
  served: Set<string>,
): Escalation[] {
  const escalations: Escalation[] = [];
  const reserved = new Map<string, number>();

  for (const casualty of context.casualties) {
    if (served.has(casualty.id)) continue;
    if (casualty.severity === 'black') continue;

    const { best, alternatives } = bestHospitalFor(casualty, context, reserved);

    // An escalation means the casualty CANNOT be served, not merely that the
    // fleet is busy this minute. Simply waiting for a free ambulance is the
    // normal state in a mass-casualty event and is already visible in the
    // "waiting" count; raising it here would bury the real problems.
    let reason: string | null = null;

    if (!best) {
      const why = alternatives
        .map((a) => a.rejectedBecause)
        .filter(Boolean)
        .slice(0, 2)
        .join('; ');
      reason = why ? `No feasible hospital. ${why}.` : 'No feasible hospital.';
    } else if (casualty.waitedMin > casualty.limitMin) {
      reason = `Waited past their ${casualty.limitMin} min limit.`;
    } else if (!reachableByAnyAmbulance(context, casualty.nodeId)) {
      reason = 'No open route from any available ambulance.';
    }

    if (reason) escalations.push({ casualtyId: casualty.id, reason });
  }

  return escalations;
}
