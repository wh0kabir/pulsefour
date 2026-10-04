import { RESPONSE_TARGET_MIN } from '../../config/assumptions';
import type { Metrics } from '../../sim/types';
import { useStore } from '../state/store';

/**
 * End-of-run report.
 *
 * DELIBERATELY NOT a "lives saved" counter. Section 7.4 is explicit that the
 * deterioration limits are modelling parameters and not a medical claim, and
 * section 15 forbids presenting this as a medical device. So the report counts
 * what the simulation can actually support: who reached a hospital inside their
 * own limit, how much sooner the critical cases were admitted, and how that
 * compares with the two baselines standing in for current practice.
 */

function formatClock(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default function RunReport() {
  const open = useStore((s) => s.reportOpen);
  const completed = useStore((s) => s.completed);
  const world = useStore((s) => s.world);
  const elapsedMs = useStore((s) => s.runElapsedMs);
  const comparison = useStore((s) => s.comparison);
  const comparisonRunning = useStore((s) => s.comparisonRunning);
  const closeReport = useStore((s) => s.closeReport);
  const setTab = useStore((s) => s.setTab);
  const reset = useStore((s) => s.reset);

  if (!open || !completed || !world) return null;

  const metrics: Metrics = world.metrics;
  const casualties = world.casualties;

  const dispatchable = casualties.filter((c) => c.severity !== 'black');
  const admitted = dispatchable.filter((c) => c.status === 'admitted');
  const pastLimit = metrics.pastLimitCount;
  const withinLimit = admitted.length - Math.min(admitted.length, pastLimit);

  const pulse = comparison?.find((r) => r.strategy === 'pulse');
  const nearest = comparison?.find((r) => r.strategy === 'nearest');
  const fcfs = comparison?.find((r) => r.strategy === 'fcfs');

  /**
   * Lead with how many critical patients actually reached a bed, not the mean
   * admission time. A strategy that admits only its three fastest reds and
   * leaves the other six queued at a full hospital posts the best-looking
   * average in the room, which is exactly what the nearest-hospital baseline
   * does here. The count is the honest headline; the mean is a footnote.
   */
  const redAdmitted = (r?: { metrics: Metrics }) => r?.metrics.admittedBySeverity.red;
  const redTotal = (r?: { metrics: Metrics }) => r?.metrics.totalBySeverity.red;

  const mineAdmitted = redAdmitted(pulse);
  const nearestAdmitted = redAdmitted(nearest);
  const fcfsAdmitted = redAdmitted(fcfs);
  const totalReds = redTotal(pulse);

  const redMine = pulse?.metrics.meanAdmissionMinBySeverity.red;
  const redNearest = nearest?.metrics.meanAdmissionMinBySeverity.red;
  const redFcfs = fcfs?.metrics.meanAdmissionMinBySeverity.red;

  const overloadVsNearest =
    pulse && nearest ? nearest.metrics.overloadEvents - pulse.metrics.overloadEvents : null;
  const limitVsNearest =
    pulse && nearest ? nearest.metrics.pastLimitCount - pulse.metrics.pastLimitCount : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-matte/80" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="fixed top-1/2 left-1/2 z-50 max-h-[88vh] w-[min(40rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-hairline bg-slate p-6"
      >
        <p className="text-[11px] text-ice-300">Run complete</p>
        <h2 id="report-title" className="mt-1.5 font-display text-xl font-medium text-frost">
          {completed.durationMin} simulated minutes in {formatClock(elapsedMs)}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-mist">
          Parel crowd crush{comparison?.[0] ? `, seed ${comparison[0].seed}` : ''}. Everything
          below comes from the run you just watched.
        </p>

        {/* What happened --------------------------------------------- */}
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-4">
          <Stat label="Casualties" value={String(dispatchable.length)} note="excluding black" />
          <Stat label="Reached hospital" value={String(admitted.length)} />
          <Stat
            label="Within their limit"
            value={String(Math.max(0, withinLimit))}
            tone="good"
          />
          <Stat
            label="Waited past limit"
            value={String(pastLimit)}
            tone={pastLimit > 0 ? 'warn' : 'good'}
          />
        </div>

        <div className="mt-px grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-3">
          <Stat
            label="Mean time to scene"
            value={`${metrics.meanResponseMin.toFixed(1)} min`}
          />
          <Stat
            label={`On scene within ${RESPONSE_TARGET_MIN} min`}
            value={`${Math.round(metrics.shareWithinTarget * 100)}%`}
          />
          <Stat
            label="Critical cases to a trauma hospital"
            value={`${Math.round(metrics.redToTraumaShare * 100)}%`}
          />
        </div>

        {/* Against current practice ----------------------------------- */}
        <h3 className="mt-6 font-display text-sm font-medium text-frost">
          Against current practice
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-mist">
          The same incident, the same fleet and the same seed, run again two more ways. Both
          baselines ignore severity and hospital capacity, which is how the research
          describes dispatch today.
        </p>

        {comparisonRunning && (
          <p className="mt-3 text-xs text-mist">Running both baselines…</p>
        )}

        {comparison && (
          <div className="mt-3 space-y-2">
            {mineAdmitted !== undefined && nearestAdmitted !== undefined && totalReds ? (
              <Claim
                good={mineAdmitted >= nearestAdmitted}
                text={`Critical patients who reached a bed: ${mineAdmitted} of ${totalReds}, against ${nearestAdmitted} under nearest-hospital dispatch and ${fcfsAdmitted ?? '-'} under first come, first served.`}
              />
            ) : null}

            {overloadVsNearest !== null && overloadVsNearest !== 0 && (
              <Claim
                good={overloadVsNearest > 0}
                text={
                  overloadVsNearest > 0
                    ? `${overloadVsNearest} fewer arrivals at a hospital with no free bed than nearest-hospital dispatch. That is the difference capacity-aware routing makes.`
                    : `${Math.abs(overloadVsNearest)} more arrivals at a full hospital than nearest-hospital dispatch.`
                }
              />
            )}

            {limitVsNearest !== null && limitVsNearest !== 0 && (
              <Claim
                good={limitVsNearest > 0}
                text={
                  limitVsNearest > 0
                    ? `${limitVsNearest} fewer casualties waited past the limit they were given than under nearest-hospital dispatch.`
                    : `${Math.abs(limitVsNearest)} more casualties waited past their limit than under nearest-hospital dispatch.`
                }
              />
            )}

            {/* The mean, with the caveat attached rather than buried. */}
            {redMine !== undefined && (
              <p className="rounded-md border border-hairline bg-graphite px-3 py-2 text-[11px] leading-relaxed text-mist">
                Mean time to admission for critical patients:{' '}
                <span className="tabular text-frost">{redMine.toFixed(1)} min</span> here
                {redNearest !== undefined && (
                  <>
                    , {redNearest.toFixed(1)} min for nearest-hospital
                    {nearestAdmitted !== undefined && totalReds
                      ? ` (but over only ${nearestAdmitted} of ${totalReds} patients)`
                      : ''}
                  </>
                )}
                {redFcfs !== undefined && <>, {redFcfs.toFixed(1)} min for first come</>}. Compare
                these only alongside the counts above: an average taken over the few patients a
                strategy managed to admit will always look good.
              </p>
            )}
          </div>
        )}

        {/* The honesty line ------------------------------------------- */}
        <p className="mt-5 rounded-lg border border-hairline bg-graphite p-3 text-[11px] leading-relaxed text-mist">
          <strong className="font-medium text-frost">What this does not say.</strong> These are
          not lives saved and not a clinical outcome. The deterioration limits are modelling
          parameters, not medical thresholds, so Pulse reports only that a casualty was
          reached and admitted inside the limit it was given. Bed counts, ambulances and
          casualties are simulated; the streets and hospital locations are real.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              closeReport();
              setTab('compare');
            }}
            className="rounded-md bg-ice-600 px-3.5 py-1.5 text-xs font-medium text-matte hover:bg-ice-500"
          >
            See the full comparison
          </button>
          <button
            type="button"
            onClick={() => {
              closeReport();
              setTab('ledger');
            }}
            className="rounded-md border border-hairline px-3 py-1.5 text-xs text-frost hover:border-ice-500"
          >
            Check the record
          </button>
          <button
            type="button"
            onClick={() => {
              closeReport();
              reset();
            }}
            className="rounded-md border border-hairline px-3 py-1.5 text-xs text-mist hover:text-frost"
          >
            Run again
          </button>
          <button
            type="button"
            onClick={closeReport}
            className="ml-auto text-xs text-mist hover:text-frost"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'good' | 'warn';
}) {
  const colour =
    tone === 'good' ? 'text-sev-green' : tone === 'warn' ? 'text-sev-yellow' : 'text-frost';
  return (
    <div className="bg-slate p-3">
      <p className="text-[10px] leading-tight text-mist">{label}</p>
      <p className={`tabular mt-1 font-display text-lg ${colour}`}>{value}</p>
      {note && <p className="text-[10px] text-mist">{note}</p>}
    </div>
  );
}

function Claim({ good, text }: { good: boolean; text: string }) {
  return (
    <p
      className={
        'rounded-md border px-3 py-2 text-xs leading-relaxed ' +
        (good
          ? 'border-ice-600/40 bg-ice-600/10 text-frost'
          : 'border-sev-yellow/40 bg-sev-yellow/5 text-mist')
      }
    >
      {text}
    </p>
  );
}
