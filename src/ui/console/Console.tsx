import { useEffect, useState } from 'react';

import CompareTab from '../compare/CompareTab';
import LedgerTab from '../ledger/LedgerTab';
import MapView from '../map/MapView';
import DecisionFeed from '../panels/DecisionFeed';
import OperatorPanel from '../panels/OperatorPanel';
import ScenarioPanel from '../panels/ScenarioPanel';
import { useStore, type Tab } from '../state/store';
import RunReport from './RunReport';
import Tour from './Tour';

/**
 * The console (CLAUDE.md section 13). One React island.
 *
 * It renders whatever WorldState the worker sends and never imports
 * simulation code beyond the shared types.
 */

const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'compare', label: 'Compare' },
  { id: 'ledger', label: 'Ledger' },
];

const MIN_WIDTH = 900;

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${MIN_WIDTH - 1}px)`);
    setNarrow(query.matches);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export default function Console() {
  const isNarrow = useIsNarrow();
  const connect = useStore((s) => s.connect);
  const disconnect = useStore((s) => s.disconnect);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const toggleDemoTools = useStore((s) => s.toggleDemoTools);
  const demoToolsOpen = useStore((s) => s.demoToolsOpen);
  const error = useStore((s) => s.error);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  if (isNarrow) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6 py-20">
        <p className="max-w-[40ch] text-center text-sm leading-relaxed text-mist">
          The console is a control-room layout and is best viewed on a larger screen. Open it
          on a display at least {MIN_WIDTH} pixels wide.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.25rem)] min-h-0 flex-col">
      <TransportBar />
      <HealthStrip />

      {error && (
        <div className="border-b border-sev-red/40 bg-sev-red/10 px-4 py-2 text-xs text-sev-red">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[16rem_1fr_16rem] gap-px bg-hairline">
        {/* Scenario takes only the height it needs; the operator, who has real
            work to do, gets everything left over. */}
        <div className="grid min-h-0 grid-rows-[auto_1fr] gap-px bg-hairline">
          <ScenarioPanel />
          <OperatorPanel />
        </div>

        <section className="relative min-h-0 bg-matte" data-tour="map">
          {/* The map stays mounted across tabs so MapLibre does not re-upload
              the whole road network every time the operator looks elsewhere. */}
          <div className={tab === 'map' ? 'absolute inset-0' : 'invisible absolute inset-0'}>
            <MapView />
          </div>
          {tab === 'compare' && (
            <div className="absolute inset-0">
              <CompareTab />
            </div>
          )}
          {tab === 'ledger' && (
            <div className="absolute inset-0">
              <LedgerTab />
            </div>
          )}
        </section>

        <DecisionFeed />
      </div>

      <div className="flex items-center gap-1 border-t border-hairline px-4 py-1.5" role="tablist" data-tour="tabs">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={
              'rounded-md px-3 py-1 text-xs transition-colors ' +
              (tab === id ? 'bg-graphite text-frost' : 'text-mist hover:text-frost')
            }
          >
            {label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1">
          <Tour />
        </div>

        <button
          type="button"
          onClick={() => {
            toggleDemoTools();
            setTab('ledger');
          }}
          aria-pressed={demoToolsOpen}
          className={
            'rounded-md px-3 py-1 text-xs transition-colors ' +
            (demoToolsOpen ? 'bg-graphite text-sev-yellow' : 'text-mist hover:text-frost')
          }
        >
          Demo tools
        </button>
      </div>

      <Toasts />
      <RunReport />
    </div>
  );
}

function TransportBar() {
  const world = useStore((s) => s.world);
  const play = useStore((s) => s.play);
  const pause = useStore((s) => s.pause);
  const setSpeed = useStore((s) => s.setSpeed);
  const setAutoAccept = useStore((s) => s.setAutoAccept);
  const reset = useStore((s) => s.reset);

  const running = world?.running ?? false;
  const simMin = world?.simMin ?? 0;
  const autoAccept = world?.autoAccept ?? true;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2" data-tour="transport">
      <button
        type="button"
        onClick={running ? pause : play}
        disabled={!world}
        className="rounded-md bg-ice-600 px-3 py-1 text-xs font-medium text-matte hover:bg-ice-500 disabled:opacity-40"
      >
        {running ? 'Pause' : 'Play'}
      </button>

      <div className="flex overflow-hidden rounded-md border border-hairline">
        {([1, 2, 4] as const).map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => setSpeed(speed)}
            aria-pressed={world?.speed === speed}
            className={
              'px-2 py-1 text-xs transition-colors ' +
              (world?.speed === speed ? 'bg-graphite text-frost' : 'text-mist hover:text-frost')
            }
          >
            {speed}x
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-hairline px-2.5 py-1 text-xs text-mist hover:text-frost"
      >
        Reset
      </button>

      <span className="ml-2 text-xs text-mist">
        Sim{' '}
        <span className="tabular font-mono text-frost">
          {String(Math.floor(simMin / 60)).padStart(2, '0')}:
          {String(simMin % 60).padStart(2, '0')}
        </span>
      </span>

      {/*
        A plain button, NOT wrapped in a <label>. A label treats a nested
        button as its control and re-dispatches the click to it, so every
        press fired twice and the switch appeared stuck.
      */}
      <button
        type="button"
        role="switch"
        aria-checked={autoAccept}
        aria-label="Auto-accept assignments"
        onClick={() => setAutoAccept(!autoAccept)}
        className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-mist transition-colors hover:text-frost"
      >
        Auto-accept
        <span
          aria-hidden="true"
          className={
            'relative h-5 w-9 shrink-0 rounded-full transition-colors ' +
            (autoAccept ? 'bg-ice-600' : 'bg-graphite')
          }
        >
          <span
            className={
              'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-frost transition-transform ' +
              (autoAccept ? 'translate-x-4' : 'translate-x-0')
            }
          />
        </span>
      </button>
    </div>
  );
}

function HealthStrip() {
  const world = useStore((s) => s.world);

  const waiting = world?.casualties.filter((c) => c.status === 'waiting').length ?? 0;
  const busy =
    world?.ambulances.filter((a) => a.status === 'to_patient' || a.status === 'to_hospital')
      .length ?? 0;
  const fleet = world?.ambulances.length ?? 0;

  const totalBeds = world?.hospitals.reduce((s, h) => s + h.beds.total, 0) ?? 0;
  const freeBeds = world?.hospitals.reduce((s, h) => s + h.beds.available, 0) ?? 0;
  const bedsUsed = totalBeds > 0 ? Math.round(((totalBeds - freeBeds) / totalBeds) * 100) : 0;

  const response = world?.metrics.meanResponseMin ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-1 border-b border-hairline px-4 py-2 text-xs text-mist" data-tour="health">
      <span>
        <span className="tabular text-frost">{waiting}</span> waiting
      </span>
      <span>
        <span className="tabular text-frost">{busy}</span> of{' '}
        <span className="tabular text-frost">{fleet}</span> ambulances busy
      </span>
      <span>
        Beds <span className="tabular text-frost">{bedsUsed}%</span> used
      </span>
      <span>
        Avg response{' '}
        <span className="tabular text-frost">{response > 0 ? response.toFixed(1) : '—'}</span>{' '}
        min
      </span>
      {(world?.congestion ?? 1) < 1 && (
        <span className="text-sev-yellow">
          Congestion <span className="tabular">{Math.round((world?.congestion ?? 1) * 100)}%</span>
        </span>
      )}
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-16 left-1/2 z-50 -translate-x-1/2 space-y-1.5">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="rounded-md border border-hairline bg-slate px-3 py-1.5 text-xs text-frost"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
