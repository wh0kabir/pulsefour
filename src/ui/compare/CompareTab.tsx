import { RESPONSE_TARGET_MIN } from '../../config/assumptions';
import type { Metrics, StrategyResult } from '../../sim/types';
import { useStore } from '../state/store';

/**
 * Compare tab (CLAUDE.md sections 9.9, 13).
 *
 * All three strategies on the same seed, the same fleet and the same scenario.
 * Where Pulse loses, this says so rather than hiding it (section 0, rule 5).
 */

const LABELS: Record<StrategyResult['strategy'], string> = {
  pulse: 'Pulse',
  nearest: 'Nearest',
  fcfs: 'First come',
};

interface Row {
  key: string;
  label: string;
  /** Lower is better? */
  lowerBetter: boolean;
  value: (m: Metrics) => number;
  format: (v: number) => string;
  /** Drawn as a bar relative to the worst value. */
  bar?: boolean;
}

const ROWS: Row[] = [
  {
    key: 'response',
    label: 'Mean time to ambulance on scene',
    lowerBetter: true,
    value: (m) => m.meanResponseMin,
    format: (v) => `${v.toFixed(1)} min`,
    bar: true,
  },
  {
    key: 'target',
    label: `Share on scene within ${RESPONSE_TARGET_MIN} min`,
    lowerBetter: false,
    value: (m) => m.shareWithinTarget,
    format: (v) => `${(v * 100).toFixed(0)}%`,
    bar: true,
  },
  {
    key: 'trauma',
    label: 'Red casualties reaching a trauma-capable hospital',
    lowerBetter: false,
    value: (m) => m.redToTraumaShare,
    format: (v) => `${(v * 100).toFixed(0)}%`,
    bar: true,
  },
  // Counts first: a mean taken over the few patients a strategy managed to
  // admit will always flatter it. Nearest-hospital posts the best red
  // admission time here while admitting a third of them.
  {
    key: 'red-admitted',
    label: 'Critical patients who reached a bed',
    lowerBetter: false,
    value: (m) => m.admittedBySeverity.red ?? 0,
    format: (v) => String(Math.round(v)),
    bar: true,
  },
  // The headline mean hides the whole point of triage, so break admission
  // time out by severity (section 9.9). Red is what the system is for.
  {
    key: 'admit-red',
    label: 'Mean time to admission — red (read with the count above)',
    lowerBetter: true,
    value: (m) => m.meanAdmissionMinBySeverity.red ?? 0,
    format: (v) => (v > 0 ? `${v.toFixed(1)} min` : '—'),
    bar: true,
  },
  {
    key: 'admit-yellow',
    label: 'Mean time to admission — yellow',
    lowerBetter: true,
    value: (m) => m.meanAdmissionMinBySeverity.yellow ?? 0,
    format: (v) => (v > 0 ? `${v.toFixed(1)} min` : '—'),
  },
  {
    key: 'admit-green',
    label: 'Mean time to admission — green',
    lowerBetter: true,
    value: (m) => m.meanAdmissionMinBySeverity.green ?? 0,
    format: (v) => (v > 0 ? `${v.toFixed(1)} min` : '—'),
  },
  {
    key: 'overload',
    label: 'Hospital overload events',
    lowerBetter: true,
    value: (m) => m.overloadEvents,
    format: (v) => String(Math.round(v)),
    bar: true,
  },
  {
    key: 'peak',
    label: 'Peak hospital load',
    lowerBetter: true,
    value: (m) => m.peakHospitalLoad,
    format: (v) => `${(v * 100).toFixed(0)}%`,
  },
  {
    key: 'pastlimit',
    label: 'Casualties who waited past their limit',
    lowerBetter: true,
    value: (m) => m.pastLimitCount,
    format: (v) => String(Math.round(v)),
  },
  {
    key: 'unserved',
    label: 'Unserved at the end',
    lowerBetter: true,
    value: (m) => m.unservedCount,
    format: (v) => String(Math.round(v)),
  },
  {
    key: 'spread',
    label: 'Spread of load across hospitals (lower is more even)',
    lowerBetter: true,
    value: (m) => m.loadSpread,
    format: (v) => v.toFixed(3),
  },
];

export default function CompareTab() {
  const comparison = useStore((s) => s.comparison);
  const running = useStore((s) => s.comparisonRunning);
  const runComparison = useStore((s) => s.runComparison);

  return (
    <div className="h-full min-h-0 overflow-auto bg-matte px-6 py-5">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-medium">Strategy comparison</h2>
            <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-mist">
              Same scenario, same fleet, same seed. The only difference is how each one
              chooses.
            </p>
          </div>
          <button
            type="button"
            onClick={runComparison}
            disabled={running}
            className="rounded-md bg-ice-600 px-3.5 py-2 text-xs font-medium text-matte hover:bg-ice-500 disabled:opacity-50"
          >
            {running ? 'Running all three…' : 'Run comparison'}
          </button>
        </div>

        {!comparison && !running && (
          <p className="mt-10 text-center text-sm text-mist">
            Run the comparison to see how Pulse differs from the two baselines.
          </p>
        )}

        {running && (
          <p className="mt-10 text-center text-sm text-mist">
            Running the full scenario three times in the worker…
          </p>
        )}

        {comparison && <Results results={comparison} />}
      </div>
    </div>
  );
}

function Results({ results }: { results: StrategyResult[] }) {
  const pulse = results.find((r) => r.strategy === 'pulse');
  const baselines = results.filter((r) => r.strategy !== 'pulse');

  // Where does Pulse actually lose? Say so plainly.
  const losses = ROWS.filter((row) => {
    if (!pulse) return false;
    const mine = row.value(pulse.metrics);
    return baselines.some((b) => {
      const theirs = row.value(b.metrics);
      return row.lowerBetter ? theirs < mine : theirs > mine;
    });
  });

  return (
    <div className="mt-6">
      <div className="overflow-hidden rounded-xl border border-hairline">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-hairline bg-slate text-ice-300">
              <th className="px-4 py-2.5 font-medium">Metric</th>
              {results.map((r) => (
                <th key={r.strategy} className="px-4 py-2.5 font-medium">
                  {LABELS[r.strategy]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const values = results.map((r) => row.value(r.metrics));
              const best = row.lowerBetter ? Math.min(...values) : Math.max(...values);
              const max = Math.max(...values, row.key === 'target' || row.key === 'trauma' ? 1 : 0);

              return (
                <tr key={row.key} className="border-b border-hairline/60 last:border-0">
                  <td className="px-4 py-2.5 align-top text-mist">{row.label}</td>
                  {results.map((r, i) => {
                    const value = values[i]!;
                    const isBest = value === best;
                    return (
                      <td key={r.strategy} className="px-4 py-2.5 align-top">
                        <span
                          className={
                            'tabular ' + (isBest ? 'font-medium text-ice-300' : 'text-frost')
                          }
                        >
                          {row.format(value)}
                        </span>
                        {row.bar && max > 0 && (
                          <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-graphite">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${Math.min(100, (value / max) * 100)}%`,
                                backgroundColor: isBest ? '#4DA8FF' : '#2B3440',
                              }}
                            />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-2 text-[11px] leading-relaxed text-mist">
        <p>
          Same scenario, same fleet, same seed. The baselines ignore severity and trauma
          capability by design, as current practice is described in the research.
        </p>
        {losses.length > 0 ? (
          <p className="text-sev-yellow">
            Pulse does not win everything. A baseline matches or beats it on:{' '}
            {losses.map((l) => l.label.toLowerCase()).join('; ')}. That is reported rather
            than tuned away.
          </p>
        ) : (
          <p>Pulse matches or beats both baselines on every metric in this run.</p>
        )}
        <p>
          Read the mean response figure with care. A strategy that ignores severity treats
          a walking-wounded casualty as urgently as a critical one, which flatters its
          average while the critical patients wait. The per-severity admission rows are the
          ones that show what the triage is actually doing.
        </p>
        <p>
          Every figure comes from the same simulation the console runs, with the assumptions
          listed on the About page.
        </p>
      </div>
    </div>
  );
}
