/**
 * Metrics (CLAUDE.md section 9.9).
 *
 * Computed identically for all three strategies so the comparison is fair.
 * Black casualties are excluded from response-time metrics (section 7.5).
 */

import { RESPONSE_TARGET_MIN } from '../config/assumptions';
import type { Hospital, Metrics, Severity } from './types';

export interface MetricSample {
  severity: Severity;
  /** Minutes from appearing to an ambulance reaching the scene. */
  responseMin?: number;
  /** Minutes from appearing to being admitted to a hospital. */
  admissionMin?: number;
  /** True when a red casualty was admitted to a trauma-capable hospital. */
  deliveredToTrauma?: boolean;
  pastLimit: boolean;
  unserved: boolean;
}

export interface MetricAccumulator {
  samples: MetricSample[];
  overloadEvents: number;
  peakHospitalLoad: number;
}

export function emptyAccumulator(): MetricAccumulator {
  return { samples: [], overloadEvents: 0, peakHospitalLoad: 0 };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeMetrics(
  acc: MetricAccumulator,
  hospitals: Hospital[],
): Metrics {
  // Black casualties never enter response or admission statistics.
  const dispatchable = acc.samples.filter((s) => s.severity !== 'black');

  const responses = dispatchable
    .map((s) => s.responseMin)
    .filter((v): v is number => v !== undefined);

  const withinTarget = responses.filter((v) => v <= RESPONSE_TARGET_MIN).length;

  const reds = dispatchable.filter((s) => s.severity === 'red');
  const redsAdmitted = reds.filter((s) => s.deliveredToTrauma !== undefined);
  const redsToTrauma = redsAdmitted.filter((s) => s.deliveredToTrauma === true);

  const meanAdmissionMinBySeverity: Partial<Record<Severity, number>> = {};
  const admittedBySeverity: Partial<Record<Severity, number>> = {};
  const totalBySeverity: Partial<Record<Severity, number>> = {};

  for (const severity of ['red', 'yellow', 'green'] as const) {
    const ofSeverity = dispatchable.filter((s) => s.severity === severity);
    const values = ofSeverity
      .map((s) => s.admissionMin)
      .filter((v): v is number => v !== undefined);

    totalBySeverity[severity] = ofSeverity.length;
    admittedBySeverity[severity] = values.length;
    if (values.length > 0) meanAdmissionMinBySeverity[severity] = mean(values);
  }

  // Spread of load across hospitals: standard deviation of load fractions.
  const loads = hospitals.map((h) =>
    h.beds.total > 0 ? 1 - h.beds.available / h.beds.total : 0,
  );
  const loadMean = mean(loads);
  const loadSpread =
    loads.length > 0
      ? Math.sqrt(mean(loads.map((l) => (l - loadMean) ** 2)))
      : 0;

  return {
    meanResponseMin: mean(responses),
    shareWithinTarget: responses.length > 0 ? withinTarget / responses.length : 0,
    // Share of RED casualties that reached a trauma-capable hospital. Only
    // counts those actually admitted; undelivered reds show up as unserved.
    redToTraumaShare:
      redsAdmitted.length > 0 ? redsToTrauma.length / redsAdmitted.length : 0,
    meanAdmissionMinBySeverity,
    admittedBySeverity,
    totalBySeverity,
    overloadEvents: acc.overloadEvents,
    peakHospitalLoad: acc.peakHospitalLoad,
    pastLimitCount: dispatchable.filter((s) => s.pastLimit).length,
    unservedCount: dispatchable.filter((s) => s.unserved).length,
    loadSpread,
  };
}

export function emptyMetrics(): Metrics {
  return {
    meanResponseMin: 0,
    shareWithinTarget: 0,
    redToTraumaShare: 0,
    meanAdmissionMinBySeverity: {},
    admittedBySeverity: {},
    totalBySeverity: {},
    overloadEvents: 0,
    peakHospitalLoad: 0,
    pastLimitCount: 0,
    unservedCount: 0,
    loadSpread: 0,
  };
}
