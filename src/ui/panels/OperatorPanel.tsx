import { useState } from 'react';

import { useStore } from '../state/store';

/**
 * Operator panel (CLAUDE.md section 10, locked decision 7).
 *
 * REAL actions a dispatcher takes: confirm, override, reject, resolve an
 * escalation. Separate from the Scenario panel on purpose.
 *
 * With auto-accept on, the system dispatches by itself and this panel is
 * quiet. Turning it off puts the human in the loop: nothing moves until the
 * operator approves it. The banner at the top makes that state obvious rather
 * than leaving it buried in a toggle.
 */
export default function OperatorPanel() {
  const world = useStore((s) => s.world);
  const operator = useStore((s) => s.operator);
  const setAutoAccept = useStore((s) => s.setAutoAccept);
  const selectDecision = useStore((s) => s.selectDecision);
  const [overriding, setOverriding] = useState<string | null>(null);

  const autoAccept = world?.autoAccept ?? true;

  const pending = (world?.pending ?? [])
    .map((id) => world?.decisions.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  const escalations = (world?.escalations ?? [])
    .map((casualtyId) => ({
      casualtyId,
      casualty: world?.casualties.find((c) => c.id === casualtyId),
      decision: world?.decisions.find(
        (d) => d.kind === 'escalation' && d.casualtyId === casualtyId,
      ),
    }))
    .filter((e) => e.casualty);

  const hospitalName = (id?: string) =>
    world?.hospitals.find((h) => h.id === id)?.name ?? id ?? '—';

  return (
    <section className="flex min-h-0 flex-col bg-slate p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium tracking-wide text-ice-300">Operator</h2>
        <button
          type="button"
          onClick={() => setAutoAccept(!autoAccept)}
          className={
            'rounded px-1.5 py-0.5 text-[10px] transition-colors ' +
            (autoAccept
              ? 'bg-graphite text-mist hover:text-frost'
              : 'bg-ice-600 text-matte')
          }
        >
          {autoAccept ? 'Take control' : 'In control'}
        </button>
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-mist">
        {autoAccept
          ? 'Auto-accept is on. The system is dispatching by itself.'
          : 'You are dispatching. Nothing moves until you confirm it.'}
      </p>

      <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto">
        <div>
          <h3 className="text-[11px] text-mist">
            Pending{' '}
            <span className={pending.length > 0 ? 'tabular text-ice-300' : 'tabular text-frost'}>
              {pending.length}
            </span>
          </h3>

          {pending.length === 0 ? (
            <p className="mt-1 text-[11px] leading-relaxed text-mist">
              {autoAccept
                ? 'Nothing waiting. Press "Take control" to approve each assignment yourself.'
                : 'Nothing waiting yet.'}
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {pending.slice(0, 8).map((decision) => (
                <li key={decision.id} className="rounded-md border border-hairline bg-graphite p-2">
                  <button
                    type="button"
                    onClick={() => selectDecision(decision.id)}
                    className="block w-full text-left"
                  >
                    <p className="text-[11px] text-frost">
                      {decision.ambulanceId} to {decision.casualtyId}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-mist">
                      {hospitalName(decision.hospitalId)} ·{' '}
                      <span className="tabular">{decision.factors.travelToCasualtyMin} min</span> to
                      scene
                    </p>
                  </button>

                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        operator({ type: 'confirm', decisionId: decision.id }, 'Assignment confirmed')
                      }
                      className="rounded bg-ice-600 px-2 py-0.5 text-[11px] text-matte hover:bg-ice-500"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setOverriding(overriding === decision.id ? null : decision.id)
                      }
                      aria-expanded={overriding === decision.id}
                      className="rounded border border-hairline px-2 py-0.5 text-[11px] text-mist hover:text-frost"
                    >
                      Override
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        operator({ type: 'reject', decisionId: decision.id }, 'Assignment rejected')
                      }
                      className="rounded border border-hairline px-2 py-0.5 text-[11px] text-mist hover:text-frost"
                    >
                      Reject
                    </button>
                  </div>

                  {/* Override: send this patient somewhere else. */}
                  {overriding === decision.id && (
                    <div className="mt-2 border-t border-hairline pt-2">
                      <p className="text-[10px] text-ice-300">Send to a different hospital</p>
                      <ul className="mt-1 space-y-0.5">
                        {(world?.hospitals ?? [])
                          .filter((h) => h.id !== decision.hospitalId)
                          .slice(0, 6)
                          .map((h) => (
                            <li key={h.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  operator(
                                    {
                                      type: 'override',
                                      decisionId: decision.id,
                                      hospitalId: h.id,
                                    },
                                    `Overridden to ${h.name}`,
                                  );
                                  setOverriding(null);
                                }}
                                className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-[10px] text-mist hover:bg-slate hover:text-frost"
                              >
                                <span className="truncate">{h.name}</span>
                                <span className="tabular shrink-0">
                                  {h.beds.available} free
                                </span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-[11px] text-mist">
            Escalations{' '}
            <span
              className={
                escalations.length > 0 ? 'tabular text-sev-yellow' : 'tabular text-frost'
              }
            >
              {escalations.length}
            </span>
          </h3>
          {escalations.length === 0 ? (
            <p className="mt-1 text-[11px] text-mist">None. Nobody is unservable right now.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {escalations.slice(0, 5).map(({ casualtyId, casualty, decision }) => (
                <li
                  key={casualtyId}
                  className="rounded-md border border-sev-yellow/40 bg-graphite p-2"
                >
                  <p className="text-[11px] text-frost">
                    {casualtyId} <span className="text-mist">({casualty?.severity})</span>
                  </p>
                  {decision?.reason && (
                    <p className="mt-0.5 text-[10px] leading-relaxed text-mist">{decision.reason}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        operator(
                          { type: 'resolveEscalation', casualtyId, resolution: 'hold' },
                          'Held for review',
                        )
                      }
                      className="rounded border border-hairline px-2 py-0.5 text-[11px] text-mist hover:text-frost"
                    >
                      Hold
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const hospital = world?.hospitals.find((h) => h.beds.available > 0);
                        operator(
                          {
                            type: 'resolveEscalation',
                            casualtyId,
                            resolution: 'forceDispatch',
                            hospitalId: hospital?.id,
                          },
                          'Force-dispatched',
                        );
                      }}
                      className="rounded bg-ice-600 px-2 py-0.5 text-[11px] text-matte hover:bg-ice-500"
                    >
                      Force dispatch
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        operator(
                          { type: 'resolveEscalation', casualtyId, resolution: 'markHandled' },
                          'Marked handled',
                        )
                      }
                      className="rounded border border-hairline px-2 py-0.5 text-[11px] text-mist hover:text-frost"
                    >
                      Mark handled
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-3 border-t border-hairline pt-2 text-[10px] leading-relaxed text-mist">
        These are the actions a real dispatcher would take.
      </p>
    </section>
  );
}
