/**
 * Every number in this file is an INVENTED SIMULATION PARAMETER, not a fact.
 * Source of truth: CLAUDE.md section 7.4. Mirrored in docs/ASSUMPTIONS.md.
 *
 * Rule 4 of section 0: no invented number may appear as a magic number in
 * code. If you need a new one, add it here and add a row to ASSUMPTIONS.md.
 *
 * The UI labels these as assumptions. None of them is a medical claim.
 */

import type { Severity } from '../sim/types';

/** Road classes we keep from OSM, coarsest to finest. */
export type RoadClass =
  | 'motorway' | 'trunk' | 'primary' | 'secondary'
  | 'tertiary' | 'residential' | 'other';

/**
 * Effective ambulance speed by road class under congestion (km/h).
 * Deliberately conservative: Mumbai traffic is not free-flowing, so we do
 * NOT use OSMnx's guessed free-flow speeds (section 6.1).
 */
export const SPEED_KMH: Record<RoadClass, number> = {
  motorway: 45,
  trunk: 45,
  primary: 35,
  secondary: 28,
  tertiary: 22,
  residential: 18,
  other: 12,
};

/** Fastest speed in the table. The A* heuristic divides by this so it never overestimates. */
export const MAX_SPEED_KMH = Math.max(...Object.values(SPEED_KMH));

/**
 * Maps an OSM `highway` tag to one of our speed classes.
 *
 * Link roads (slip roads) inherit their parent class. `living_street` is
 * treated as residential. Anything unrecognised falls to 'other', the slowest
 * bucket, so an unknown tag can never make a route look faster than it is.
 *
 * This is the ONLY place the mapping is defined; both the data pipeline and
 * the router read it from here.
 */
export function roadClassOf(highway: string): RoadClass {
  switch (highway) {
    case 'motorway':
    case 'motorway_link':
      return 'motorway';
    case 'trunk':
    case 'trunk_link':
      return 'trunk';
    case 'primary':
    case 'primary_link':
      return 'primary';
    case 'secondary':
    case 'secondary_link':
      return 'secondary';
    case 'tertiary':
    case 'tertiary_link':
      return 'tertiary';
    case 'residential':
    case 'living_street':
      return 'residential';
    default:
      return 'other';
  }
}

/** Multiplies every speed. 1.0 default; a rain scenario is slower. */
export const CONGESTION = { default: 1.0, rain: 0.7 } as const;

/** Allocation priority weight. Black is never allocated. */
export const SEVERITY_WEIGHT: Record<Exclude<Severity, 'black'>, number> = {
  red: 100,
  yellow: 40,
  green: 10,
};

/**
 * Minutes a casualty may wait before we call the outcome adverse.
 * NOT a medical claim and NOT a golden-hour threshold: research found no
 * sound hard threshold. The UI says "waited past limit", never "died".
 */
export const DETERIORATION_LIMIT_MIN: Record<Exclude<Severity, 'black'>, number> = {
  red: 45,
  yellow: 90,
  green: 240,
};

/** Minutes a patient occupies a bed before it frees. */
export const TREATMENT_TIME_MIN: Record<Exclude<Severity, 'black'>, number> = {
  red: 180,
  yellow: 90,
  green: 30,
};

/** Supplies consumed when a casualty is handed over. */
export const SUPPLY_USE: Record<Exclude<Severity, 'black'>, { bloodUnits: number; oxygenUnits: number }> = {
  red: { bloodUnits: 2, oxygenUnits: 2 },
  yellow: { bloodUnits: 0, oxygenUnits: 1 },
  green: { bloodUnits: 0, oxygenUnits: 0 },
};

/**
 * Hospital load penalty: a cost in minutes that steers patients away from
 * nearly-full hospitals. Zero up to 60% full, then rising quadratically to
 * 20 minutes at 100%.
 */
export const LOAD_PENALTY = { freeUpToFraction: 0.6, maxPenaltyMin: 20 } as const;

export function loadPenaltyMin(loadFraction: number): number {
  const { freeUpToFraction, maxPenaltyMin } = LOAD_PENALTY;
  if (loadFraction <= freeUpToFraction) return 0;
  const t = (loadFraction - freeUpToFraction) / (1 - freeUpToFraction);
  return maxPenaltyMin * Math.min(t, 1) ** 2;
}

/**
 * Waiting factor: stops low-severity patients being ignored forever.
 * 1 + waitedMin / 30, capped at 3.
 */
export const WAITING = { divisorMin: 30, cap: 3 } as const;

export function waitingFactor(waitedMin: number): number {
  return Math.min(1 + waitedMin / WAITING.divisorMin, WAITING.cap);
}

/** A BLS ambulance carrying a red patient costs this much extra. Soft, not a hard rule. */
export const ALS_PREFERENCE_PENALTY_MIN = 5;

/** An ICU-needing casualty going to a hospital with no free ICU bed. */
export const ICU_SHORTAGE_PENALTY_MIN = 10;

/**
 * An ambulance already heading to a pickup is only reassigned if the new
 * plan is at least this much better. Stops flip-flopping (section 9.5).
 */
export const REASSIGNMENT_MARGIN = 0.2;

/** Weight on travel time relative to severity benefit in the cost matrix (section 9.2). */
export const LAMBDA = 1;

/** Fleet size. Deliberately smaller than the casualty load: scarcity is the point. */
export const FLEET = { als: 5, bls: 9 } as const;

/** Casualty mix for the main scenario. */
export const CASUALTY_MIX: Record<Severity, number> = {
  red: 7, yellow: 14, green: 13, black: 2,
};

/** Start-of-run hospital occupancy, seeded random in this range. */
export const START_OCCUPANCY = { min: 0.25, max: 0.45 } as const;

/** ICU beds as a share of total, when nothing is verified. */
export const ICU_SHARE_OF_BEDS = 0.08;

/**
 * Response target line drawn on the comparison chart (minutes).
 * The 108 service's stated urban average per team research.
 * UNVERIFIED -- must be confirmed by a human before any public claim.
 */
export const RESPONSE_TARGET_MIN = 20;

/** 1 real second = 1 simulated minute at 1x (locked decision 8). */
export const TICK_MS_AT_1X = 1000;
export const SPEEDS = [1, 2, 4] as const;
