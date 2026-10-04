/**
 * The three allocation strategies (CLAUDE.md sections 9.8, 0 rule 5).
 *
 * All three run on the SAME seed, the SAME fleet and the SAME scenario. The
 * only thing that differs is how they choose. If Pulse does not beat the
 * baselines on a metric, that is reported honestly rather than tuned away.
 */

import { UNREACHABLE } from '../dijkstra';
import { allocate, type AllocationContext, type AllocationResult, type Plan } from '../allocator';
import type { DecisionFactors } from '../types';

export type { AllocationContext, AllocationResult };

export type StrategyFn = (context: AllocationContext) => AllocationResult;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function blankFactors(overrides: Partial<DecisionFactors> = {}): DecisionFactors {
  return {
    travelToCasualtyMin: 0,
    travelToHospitalMin: 0,
    loadPenaltyMin: 0,
    severityWeight: 0,
    waitingFactor: 1,
    totalCost: 0,
    ...overrides,
  };
}

/**
 * Pulse: the real allocator. Hungarian over the whole board, severity as a
 * benefit, capacity and trauma capability respected, explanations attached.
 */
export const pulseStrategy: StrategyFn = (context) => allocate(context);

/**
 * Nearest (baseline). Repeatedly takes the closest ambulance-casualty pair.
 * Destination is the nearest hospital by travel time, IGNORING capacity, so
 * overload shows up as delay in the ED queue rather than being avoided.
 *
 * Ignores severity and trauma capability by design: this is what the research
 * describes as current practice.
 */
export const nearestStrategy: StrategyFn = (context) => {
  const plans: Plan[] = [];
  const usedAmbulances = new Set<string>();
  const usedCasualties = new Set<string>();

  const pairs: { ambulanceId: string; casualtyId: string; minutes: number }[] = [];
  for (const ambulance of context.ambulances) {
    for (const casualty of context.casualties) {
      if (casualty.severity === 'black') continue;
      const minutes = context.travelFromAmbulance(ambulance.id, casualty.nodeId);
      if (minutes === UNREACHABLE || !Number.isFinite(minutes)) continue;
      pairs.push({ ambulanceId: ambulance.id, casualtyId: casualty.id, minutes });
    }
  }
  // Tie-break on ids so the result is deterministic.
  pairs.sort(
    (a, b) =>
      a.minutes - b.minutes ||
      a.ambulanceId.localeCompare(b.ambulanceId) ||
      a.casualtyId.localeCompare(b.casualtyId),
  );

  for (const pair of pairs) {
    if (usedAmbulances.has(pair.ambulanceId) || usedCasualties.has(pair.casualtyId)) continue;
    const casualty = context.casualties.find((c) => c.id === pair.casualtyId)!;

    // Nearest hospital by travel time. Capacity is NOT considered.
    let bestHospitalId: string | undefined;
    let bestMinutes = Infinity;
    for (const hospital of context.hospitals) {
      const minutes = context.travelToHospital(hospital.id, casualty.nodeId);
      if (minutes === UNREACHABLE || !Number.isFinite(minutes)) continue;
      if (minutes < bestMinutes) {
        bestMinutes = minutes;
        bestHospitalId = hospital.id;
      }
    }
    if (!bestHospitalId) continue;

    usedAmbulances.add(pair.ambulanceId);
    usedCasualties.add(pair.casualtyId);

    plans.push({
      casualtyId: pair.casualtyId,
      ambulanceId: pair.ambulanceId,
      hospitalId: bestHospitalId,
      factors: blankFactors({
        travelToCasualtyMin: round1(pair.minutes),
        travelToHospitalMin: round1(bestMinutes),
        totalCost: round1(pair.minutes + bestMinutes),
      }),
      alternatives: [],
      reason: 'Nearest ambulance to the nearest hospital. Capacity not considered.',
      isReassignment: false,
    });
  }

  return { plans, escalations: [] };
};

/**
 * First come, first served (baseline). Casualties in arrival order; each gets
 * the nearest free ambulance; destination is the nearest hospital THAT HAS A
 * FREE BED. Still ignores severity and trauma capability.
 */
export const fcfsStrategy: StrategyFn = (context) => {
  const plans: Plan[] = [];
  const usedAmbulances = new Set<string>();
  const reserved = new Map<string, number>();

  const queue = [...context.casualties]
    .filter((c) => c.severity !== 'black')
    .sort((a, b) => a.appearedAtMin - b.appearedAtMin || a.id.localeCompare(b.id));

  for (const casualty of queue) {
    let bestAmbulanceId: string | undefined;
    let bestMinutes = Infinity;
    for (const ambulance of context.ambulances) {
      if (usedAmbulances.has(ambulance.id)) continue;
      const minutes = context.travelFromAmbulance(ambulance.id, casualty.nodeId);
      if (minutes === UNREACHABLE || !Number.isFinite(minutes)) continue;
      if (minutes < bestMinutes) {
        bestMinutes = minutes;
        bestAmbulanceId = ambulance.id;
      }
    }
    if (!bestAmbulanceId) continue;

    // Nearest hospital that still has a bed.
    let bestHospitalId: string | undefined;
    let bestHospitalMinutes = Infinity;
    for (const hospital of context.hospitals) {
      const taken = reserved.get(hospital.id) ?? 0;
      if (hospital.bedsAvailable - taken <= 0) continue;
      const minutes = context.travelToHospital(hospital.id, casualty.nodeId);
      if (minutes === UNREACHABLE || !Number.isFinite(minutes)) continue;
      if (minutes < bestHospitalMinutes) {
        bestHospitalMinutes = minutes;
        bestHospitalId = hospital.id;
      }
    }
    if (!bestHospitalId) continue;

    usedAmbulances.add(bestAmbulanceId);
    reserved.set(bestHospitalId, (reserved.get(bestHospitalId) ?? 0) + 1);

    plans.push({
      casualtyId: casualty.id,
      ambulanceId: bestAmbulanceId,
      hospitalId: bestHospitalId,
      factors: blankFactors({
        travelToCasualtyMin: round1(bestMinutes),
        travelToHospitalMin: round1(bestHospitalMinutes),
        totalCost: round1(bestMinutes + bestHospitalMinutes),
      }),
      alternatives: [],
      reason: 'Arrival order. Nearest free ambulance, nearest hospital with a bed.',
      isReassignment: false,
    });
  }

  return { plans, escalations: [] };
};

export const STRATEGIES = {
  pulse: pulseStrategy,
  nearest: nearestStrategy,
  fcfs: fcfsStrategy,
} as const;
