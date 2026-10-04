import { useStore } from '../state/store';

/**
 * Scenario panel (CLAUDE.md section 10, locked decision 7).
 *
 * SIMULATED world events. Kept visibly and structurally separate from the
 * Operator panel, because the first question anyone asks is "what would be
 * real here?". The footer answers it.
 */
export default function ScenarioPanel() {
  const world = useStore((s) => s.world);
  const inject = useStore((s) => s.inject);

  const hospitals = world?.hospitals ?? [];
  const ambulances = world?.ambulances ?? [];
  const fullest = [...hospitals].sort(
    (a, b) => a.beds.available / a.beds.total - b.beds.available / b.beds.total,
  )[0];
  const busiest = ambulances.find((a) => a.status !== 'offline');
  const offline = ambulances.find((a) => a.status === 'offline');

  const disabled = !world;

  return (
    <section className="flex flex-col bg-slate p-3" data-tour="scenario">
      <h2 className="text-xs font-medium tracking-wide text-ice-300">Scenario</h2>
      <p className="mt-1 text-[11px] text-mist">Inject event</p>

      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={disabled || !fullest}
          onClick={() =>
            fullest &&
            inject(
              { type: 'fillHospital', hospitalId: fullest.id, availableBeds: 0 },
              `${fullest.name} is full`,
            )
          }
          className={buttonClass}
        >
          Fill a hospital
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            world &&
            inject(
              {
                type: 'surge',
                center: world.casualties[0]?.position ?? { lat: 19.0085, lng: 72.8368 },
                count: 6,
                spreadM: 250,
                severityMix: { red: 2, yellow: 2, green: 2 },
              },
              'Surge injected',
            )
          }
          className={buttonClass}
        >
          Surge of casualties
        </button>

        <button
          type="button"
          disabled={disabled || !busiest}
          onClick={() =>
            busiest &&
            inject(
              { type: 'ambulanceOffline', ambulanceId: busiest.id },
              `${busiest.id} offline`,
            )
          }
          className={buttonClass}
        >
          Take an ambulance offline
        </button>

        <button
          type="button"
          disabled={disabled || !offline}
          onClick={() =>
            offline &&
            inject({ type: 'ambulanceOnline', ambulanceId: offline.id }, `${offline.id} back online`)
          }
          className={buttonClass}
        >
          Put an ambulance back
        </button>

        <button
          type="button"
          disabled={disabled || !fullest}
          onClick={() =>
            fullest &&
            inject(
              { type: 'resupply', hospitalId: fullest.id, bloodUnits: 20, oxygenUnits: 20 },
              `${fullest.name} resupplied`,
            )
          }
          className={buttonClass}
        >
          Resupply a hospital
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const heavy = (world?.congestion ?? 1) < 1;
            inject(
              { type: 'setCongestion', multiplier: heavy ? 1 : 0.7 },
              heavy ? 'Congestion cleared' : 'Congestion raised',
            );
          }}
          className={buttonClass}
        >
          {(world?.congestion ?? 1) < 1 ? 'Clear congestion' : 'Raise congestion'}
        </button>

      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-mist">
        Click a road on the map to close or reopen it.
      </p>

      <p className="mt-2.5 border-t border-hairline pt-2 text-[10px] leading-relaxed text-mist">
        In a real deployment these would arrive from traffic data, hospital systems and
        emergency calls. Here they are simulated.
      </p>
    </section>
  );
}

const buttonClass =
  'rounded-md border border-hairline bg-graphite px-2 py-1.5 text-left text-[11px] leading-tight ' +
  'text-frost transition-colors hover:border-ice-500 disabled:cursor-not-allowed ' +
  'disabled:opacity-40 disabled:hover:border-hairline';
