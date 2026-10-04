/**
 * UI state (CLAUDE.md section 5: Zustand).
 *
 * This holds only what the UI needs to render. The simulation's state lives in
 * the worker and arrives here as whole WorldState snapshots.
 */

import { create } from 'zustand';

import type {
  LedgerRecord,
  OperatorAction,
  ScenarioEvent,
  Speed,
  StrategyResult,
  VerifyResult,
  WorldState,
} from '../../sim/types';
import { SimulationClient } from '../worker-client';

export type Tab = 'map' | 'compare' | 'ledger';

export interface Toast {
  id: number;
  message: string;
}

interface UiState {
  client: SimulationClient | null;
  connected: boolean;
  error: string | null;

  world: WorldState | null;
  ledger: LedgerRecord[];
  comparison: StrategyResult[] | null;
  comparisonRunning: boolean;
  verify: VerifyResult | null;

  tab: Tab;
  selectedDecisionId: string | null;
  demoToolsOpen: boolean;
  toasts: Toast[];

  /** Wall-clock milliseconds actually spent running, pauses excluded. */
  runElapsedMs: number;
  /** Set when the scenario reaches its end; drives the run report. */
  completed: { simMin: number; durationMin: number } | null;
  reportOpen: boolean;

  connect: () => void;
  disconnect: () => void;
  setTab: (tab: Tab) => void;
  closeReport: () => void;
  openReport: () => void;
  selectDecision: (id: string | null) => void;
  toggleDemoTools: () => void;
  toast: (message: string) => void;

  play: () => void;
  pause: () => void;
  setSpeed: (speed: Speed) => void;
  setAutoAccept: (value: boolean) => void;
  reset: () => void;
  inject: (event: ScenarioEvent, message: string) => void;
  operator: (action: OperatorAction, message: string) => void;
  runComparison: () => void;
  pinCheckpoint: () => void;
  verifyLedger: () => void;
  demoTamper: (mode: 'edit-row' | 'rewrite-chain', seq: number) => void;
}

let toastId = 0;
/** Timestamp of the last state message, for the real-time accumulator. */
let lastStateAt = 0;

export const useStore = create<UiState>((set, get) => ({
  client: null,
  connected: false,
  error: null,

  world: null,
  ledger: [],
  comparison: null,
  comparisonRunning: false,
  verify: null,

  tab: 'map',
  selectedDecisionId: null,
  demoToolsOpen: false,
  toasts: [],

  runElapsedMs: 0,
  completed: null,
  reportOpen: false,

  connect: () => {
    if (get().client) return;
    const client = new SimulationClient();
    client.start();

    client.on((event) => {
      switch (event.type) {
        case 'state': {
          // Accumulate real time only across ticks where the clock was
          // actually running, so pauses do not inflate the figure.
          const now = Date.now();
          const previous = get().world;
          const addMs =
            previous?.running && event.state.running && lastStateAt > 0
              ? Math.min(now - lastStateAt, 5000)
              : 0;
          lastStateAt = now;
          set((state) => ({
            world: event.state,
            connected: true,
            error: null,
            runElapsedMs: state.runElapsedMs + addMs,
          }));
          break;
        }

        case 'complete':
          set({
            completed: { simMin: event.simMin, durationMin: event.durationMin },
            reportOpen: true,
          });
          // The report compares against the baselines, so run them now.
          get().runComparison();
          break;
        case 'ledger':
          set((state) => {
            // demoTamper resends the whole chain; replace rather than append.
            const incoming = event.records;
            if (incoming.length > 0 && incoming[0]!.seq === 0) {
              return { ledger: incoming };
            }
            return { ledger: [...state.ledger, ...incoming] };
          });
          break;
        case 'comparison':
          set({ comparison: event.results, comparisonRunning: false });
          break;
        case 'verify':
          set({ verify: event.result });
          break;
        case 'error':
          set({ error: event.message, comparisonRunning: false });
          break;
      }
    });

    client.send({ type: 'init', scenarioId: 'parel-crowd-crush' });
    set({ client });
  },

  disconnect: () => {
    get().client?.stop();
    set({ client: null, connected: false });
  },

  setTab: (tab) => set({ tab }),
  closeReport: () => set({ reportOpen: false }),
  openReport: () => set({ reportOpen: true }),
  selectDecision: (id) => set({ selectedDecisionId: id }),
  toggleDemoTools: () => set((s) => ({ demoToolsOpen: !s.demoToolsOpen })),

  toast: (message) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3200);
  },

  play: () => get().client?.send({ type: 'play' }),
  pause: () => get().client?.send({ type: 'pause' }),
  setSpeed: (speed) => get().client?.send({ type: 'setSpeed', speed }),
  setAutoAccept: (value) => {
    get().client?.send({ type: 'setAutoAccept', value });
    get().toast(value ? 'Auto-accept on' : 'Auto-accept off');
  },

  reset: () => {
    get().client?.send({ type: 'reset' });
    lastStateAt = 0;
    set({
      ledger: [],
      verify: null,
      selectedDecisionId: null,
      runElapsedMs: 0,
      completed: null,
      reportOpen: false,
    });
    get().toast('Scenario reset');
  },

  inject: (event, message) => {
    get().client?.send({ type: 'inject', event });
    get().toast(message);
  },

  operator: (action, message) => {
    get().client?.send({ type: 'operator', action });
    get().toast(message);
  },

  runComparison: () => {
    set({ comparisonRunning: true });
    get().client?.send({ type: 'runComparison' });
  },

  pinCheckpoint: () => {
    get().client?.send({ type: 'pinCheckpoint' });
    get().toast('Checkpoint pinned');
  },

  verifyLedger: () => get().client?.send({ type: 'verifyLedger' }),

  demoTamper: (mode, seq) => {
    get().client?.send({ type: 'demoTamper', mode, seq });
    get().toast(mode === 'edit-row' ? 'Record edited' : 'Chain rewritten');
  },
}));
