import { useStore } from '../state/store';

/**
 * Ledger tab (CLAUDE.md sections 11, 13).
 *
 * Monospace is appropriate here: these are hashes.
 */
export default function LedgerTab() {
  const ledger = useStore((s) => s.ledger);
  const world = useStore((s) => s.world);
  const verify = useStore((s) => s.verify);
  const pinCheckpoint = useStore((s) => s.pinCheckpoint);
  const verifyLedger = useStore((s) => s.verifyLedger);
  const demoToolsOpen = useStore((s) => s.demoToolsOpen);
  const demoTamper = useStore((s) => s.demoTamper);

  const checkpoint = world?.checkpoint;
  const brokenAt = verify?.state === 'broken' ? verify.atSeq : null;
  const rows = [...ledger].reverse();

  return (
    <div className="flex h-full min-h-0 flex-col bg-matte">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
        <button
          type="button"
          onClick={pinCheckpoint}
          className="rounded-md bg-ice-600 px-3 py-1.5 text-xs font-medium text-matte hover:bg-ice-500"
        >
          Pin checkpoint
        </button>
        <button
          type="button"
          onClick={verifyLedger}
          className="rounded-md border border-hairline px-3 py-1.5 text-xs text-frost hover:border-ice-500"
        >
          Verify chain
        </button>

        <span className="ml-1 rounded-md border border-hairline bg-slate px-2 py-1 font-mono text-[10px] text-mist">
          {checkpoint
            ? `checkpoint @${checkpoint.seq} ${checkpoint.hash.slice(0, 12)}…`
            : 'no checkpoint pinned'}
        </span>

        <span className="tabular ml-auto text-[11px] text-mist">
          {ledger.length} records
        </span>
      </div>

      {verify && <VerifyBanner />}

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-mist">
            The ledger fills as the scenario runs. Press play.
          </p>
        ) : (
          <table className="w-full border-collapse text-left font-mono text-[11px]">
            <thead className="sticky top-0 bg-slate">
              <tr className="border-b border-hairline text-ice-300">
                <th className="px-3 py-2 font-medium">seq</th>
                <th className="px-3 py-2 font-medium">min</th>
                <th className="px-3 py-2 font-medium">type</th>
                <th className="px-3 py-2 font-medium">actor</th>
                <th className="px-3 py-2 font-medium">hash</th>
                <th className="px-3 py-2 font-medium">prev</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => {
                const broken = brokenAt !== null && record.seq >= brokenAt;
                return (
                  <tr
                    key={record.seq}
                    className={
                      'border-b border-hairline/50 ' +
                      (broken ? 'bg-sev-red/10 text-sev-red' : 'text-mist')
                    }
                  >
                    <td className="tabular px-3 py-1.5">{record.seq}</td>
                    <td className="tabular px-3 py-1.5">{record.simMin}</td>
                    <td className="px-3 py-1.5 text-frost">{record.type}</td>
                    <td className="px-3 py-1.5">{record.actor}</td>
                    <td className="px-3 py-1.5">{record.hash.slice(0, 10)}…</td>
                    <td className="px-3 py-1.5">{record.prevHash.slice(0, 10)}…</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {demoToolsOpen && (
        <div className="border-t border-sev-yellow/40 bg-slate px-4 py-3">
          <h3 className="text-xs font-medium text-sev-yellow">Demo tools</h3>
          <p className="mt-1 max-w-[70ch] text-[11px] leading-relaxed text-mist">
            These deliberately tamper with the ledger to show what verification catches. They
            exist only in this drawer and are never reachable from normal operation.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ledger.length < 3}
              onClick={() => demoTamper('edit-row', Math.min(2, ledger.length - 1))}
              className={demoButton}
            >
              Edit a past record
            </button>
            <button
              type="button"
              disabled={ledger.length < 3}
              onClick={() => demoTamper('rewrite-chain', Math.min(2, ledger.length - 1))}
              className={demoButton}
            >
              Rewrite the whole chain
            </button>
          </div>
          <p className="mt-2 text-[10px] text-mist">
            Pin a checkpoint first, then tamper, then verify.
          </p>
        </div>
      )}
    </div>
  );
}

const demoButton =
  'rounded-md border border-sev-yellow/40 bg-graphite px-2.5 py-1 text-[11px] ' +
  'text-frost hover:border-sev-yellow disabled:cursor-not-allowed disabled:opacity-40';

function VerifyBanner() {
  const verify = useStore((s) => s.verify)!;

  const tone =
    verify.state === 'intact'
      ? 'border-sev-green/40 text-sev-green'
      : verify.state === 'no-checkpoint'
        ? 'border-hairline text-mist'
        : 'border-sev-red/50 text-sev-red';

  let message: string;
  switch (verify.state) {
    case 'intact':
      message = `Intact. The chain recomputes correctly and matches the pinned checkpoint at sequence ${verify.head.seq}.`;
      break;
    case 'broken':
      message = `Broken at sequence ${verify.atSeq}. That record was edited, so it and everything after it no longer match.`;
      break;
    case 'rewritten':
      message = `Rewritten. The chain is internally consistent, but its head no longer matches the checkpoint pinned at sequence ${verify.checkpoint.seq}. Only the separately pinned checkpoint catches this.`;
      break;
    default:
      message =
        'No checkpoint pinned. The chain recomputes cleanly, but without a checkpoint a full rewrite would look identical. Pin one, then verify.';
  }

  return (
    <div className={`border-b bg-slate px-4 py-2.5 text-xs leading-relaxed ${tone}`}>
      {message}
    </div>
  );
}
