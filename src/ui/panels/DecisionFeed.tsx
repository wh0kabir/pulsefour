import { useStore } from '../state/store';

/**
 * The decision feed and "why" card (CLAUDE.md sections 9.7, 13).
 *
 * Every number shown here is a number the allocator actually used.
 */
export default function DecisionFeed() {
  const world = useStore((s) => s.world);
  const selectedId = useStore((s) => s.selectedDecisionId);
  const selectDecision = useStore((s) => s.selectDecision);

  const decisions = [...(world?.decisions ?? [])].reverse();
  const hospitalName = (id?: string) =>
    world?.hospitals.find((h) => h.id === id)?.name ?? id ?? '—';

  return (
    <section className="flex min-h-0 flex-col bg-slate p-3" data-tour="decisions">
      <h2 className="text-xs font-medium tracking-wide text-ice-300">Decisions</h2>
      <p className="mt-1 text-[11px] text-mist">Newest first. Open one for the reasoning.</p>

      {decisions.length === 0 ? (
        <p className="mt-3 text-[11px] text-mist">
          Nothing yet. Press play to start the scenario.
        </p>
      ) : (
        <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {decisions.map((decision) => {
            const open = decision.id === selectedId;
            const isEscalation = decision.kind === 'escalation';
            return (
              <li key={decision.id}>
                <div
                  className={
                    'rounded-md border p-2 transition-colors ' +
                    (open
                      ? 'ice-border border-transparent'
                      : isEscalation
                        ? 'border-sev-yellow/40 bg-graphite'
                        : 'border-hairline bg-graphite hover:border-ice-500/50')
                  }
                >
                  <button
                    type="button"
                    onClick={() => selectDecision(open ? null : decision.id)}
                    aria-expanded={open}
                    className="block w-full text-left"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-medium text-frost">
                        {isEscalation ? 'Escalation' : decision.ambulanceId}
                        {!isEscalation && (
                          <span className="text-mist"> to {decision.casualtyId}</span>
                        )}
                        {isEscalation && <span className="text-mist"> {decision.casualtyId}</span>}
                      </span>
                      <span className="tabular shrink-0 font-mono text-[10px] text-mist">
                        {String(decision.simMin).padStart(2, '0')} min
                      </span>
                    </div>
                    {!isEscalation && (
                      <p className="mt-0.5 truncate text-[10px] text-mist">
                        {hospitalName(decision.hospitalId)}
                      </p>
                    )}
                  </button>

                  {open && (
                    <div className="mt-2 border-t border-hairline pt-2">
                      <p className="text-[11px] leading-relaxed text-frost">{decision.reason}</p>

                      {!isEscalation && (
                        <>
                          <dl className="mt-2 space-y-0.5 text-[10px] text-mist">
                            <Row label="Travel to scene" value={`${decision.factors.travelToCasualtyMin} min`} />
                            <Row label="On to hospital" value={`${decision.factors.travelToHospitalMin} min`} />
                            <Row label="Hospital load penalty" value={`${decision.factors.loadPenaltyMin} min`} />
                            <Row label="Severity weight" value={String(decision.factors.severityWeight)} />
                            <Row label="Waiting factor" value={`${decision.factors.waitingFactor}x`} />
                            <Row label="Total cost" value={String(decision.factors.totalCost)} strong />
                          </dl>

                          {decision.alternatives.length > 0 && (
                            <div className="mt-2">
                              <p className="text-[10px] text-ice-300">Alternatives considered</p>
                              <ul className="mt-1 space-y-0.5">
                                {decision.alternatives.slice(0, 4).map((alt, i) => (
                                  <li key={i} className="text-[10px] leading-relaxed text-mist">
                                    {hospitalName(alt.hospitalId)}
                                    {alt.cost !== undefined && (
                                      <span className="tabular"> — {alt.cost} min</span>
                                    )}
                                    {alt.rejectedBecause && <> — {alt.rejectedBecause}</>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className={'tabular ' + (strong ? 'text-frost' : 'text-mist')}>{value}</dd>
    </div>
  );
}
