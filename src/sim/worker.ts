/**
 * The simulation worker (CLAUDE.md section 5).
 *
 * The worker owns ALL mutable state. The UI sends commands and renders
 * whatever WorldState comes back. It never imports engine internals.
 */

/// <reference lib="webworker" />

import { runComparison } from './compare';
import { Engine } from './engine';
import { RoadGraph } from './graph';
import { canonicalJson, sha256Hex } from './ledger';
import type { Scenario } from './scenario';
import type {
  GraphFile,
  Hospital,
  WorkerCommand,
  WorkerEvent,
  WorldState,
} from './types';
import * as assumptions from '../config/assumptions';

const TICK_MS_AT_1X = 1000;

let graph: RoadGraph | null = null;
let hospitals: Hospital[] = [];
let scenario: Scenario | null = null;
let engine: Engine | null = null;

let timer: ReturnType<typeof setTimeout> | null = null;
let ledgerCursor = 0;
let stepping = false;

function post(event: WorkerEvent): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(event);
}

function fail(message: string): void {
  post({ type: 'error', message });
}

/**
 * SHA-256 of the canonical assumptions in force, recorded on every ledger
 * record so a reader can tell which configuration produced it.
 */
async function computeConfigHash(): Promise<string> {
  const serialisable: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(assumptions)) {
    if (typeof value === 'function') continue;
    serialisable[key] = value;
  }
  return sha256Hex(canonicalJson(serialisable));
}

async function loadData(): Promise<void> {
  if (graph && scenario) return;

  const [graphResponse, hospitalResponse, scenarioResponse] = await Promise.all([
    fetch('/data/graph.json'),
    fetch('/data/hospitals.json'),
    fetch('/data/scenario-parel.json'),
  ]);

  if (!graphResponse.ok) throw new Error(`graph.json: ${graphResponse.status}`);
  if (!hospitalResponse.ok) throw new Error(`hospitals.json: ${hospitalResponse.status}`);
  if (!scenarioResponse.ok) throw new Error(`scenario-parel.json: ${scenarioResponse.status}`);

  graph = new RoadGraph((await graphResponse.json()) as GraphFile);
  hospitals = ((await hospitalResponse.json()) as { hospitals: Hospital[] }).hospitals;
  scenario = (await scenarioResponse.json()) as Scenario;
}

function emitState(): void {
  if (!engine) return;
  const state: WorldState = engine.snapshot();
  post({ type: 'state', state });

  const fresh = engine.newLedgerRecords(ledgerCursor);
  if (fresh.length > 0) {
    ledgerCursor = fresh[fresh.length - 1]!.seq + 1;
    post({ type: 'ledger', records: fresh });
  }
}

function stopTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleTick(): void {
  stopTimer();
  if (!engine || !engine.isRunning) return;

  const state = engine.snapshot();
  const interval = TICK_MS_AT_1X / state.speed;

  timer = setTimeout(async () => {
    if (!engine || !engine.isRunning) return;
    // Guard against overlapping ticks if a step ever runs long.
    if (stepping) {
      scheduleTick();
      return;
    }
    stepping = true;
    try {
      await engine.step();
      emitState();
      // Stop at the end of the scenario rather than running forever.
      if (scenario && engine.currentMin >= scenario.durationMin) {
        engine.pause();
        emitState();
        return;
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      engine.pause();
    } finally {
      stepping = false;
    }
    scheduleTick();
  }, interval);
}

async function handle(command: WorkerCommand): Promise<void> {
  switch (command.type) {
    case 'init': {
      await loadData();
      if (!graph || !scenario) throw new Error('data not loaded');
      engine = new Engine({
        graph,
        hospitals,
        scenario,
        seed: command.seed ?? scenario.seed,
        systemVersion: __PULSE_VERSION__,
        configHash: await computeConfigHash(),
        withLedger: true,
      });
      ledgerCursor = 0;
      emitState();
      break;
    }

    case 'play': {
      engine?.play();
      emitState();
      scheduleTick();
      break;
    }

    case 'pause': {
      engine?.pause();
      stopTimer();
      emitState();
      break;
    }

    case 'setSpeed': {
      engine?.setSpeed(command.speed);
      emitState();
      scheduleTick();
      break;
    }

    case 'setAutoAccept': {
      engine?.setAutoAccept(command.value);
      emitState();
      break;
    }

    case 'inject': {
      await engine?.inject(command.event, 'scenario');
      emitState();
      break;
    }

    case 'operator': {
      await engine?.operator(command.action);
      emitState();
      break;
    }

    case 'reset': {
      stopTimer();
      engine?.reset(command.seed);
      ledgerCursor = 0;
      emitState();
      break;
    }

    case 'runComparison': {
      await loadData();
      if (!graph || !scenario) throw new Error('data not loaded');
      // A fresh graph so a closed road in the live run cannot leak into the
      // comparison: all three strategies must see identical conditions.
      const results = await runComparison({
        graph: new RoadGraph(await (await fetch('/data/graph.json')).json() as GraphFile),
        hospitals,
        scenario,
        seed: scenario.seed,
      });
      post({ type: 'comparison', results });
      break;
    }

    case 'pinCheckpoint': {
      engine?.ledger.pinCheckpoint();
      emitState();
      break;
    }

    case 'verifyLedger': {
      if (!engine) break;
      await engine.ledger.drain();
      const result = await engine.ledger.verify();
      post({ type: 'verify', result });
      break;
    }

    case 'demoTamper': {
      if (!engine) break;
      await engine.ledger.drain();
      if (command.mode === 'edit-row') engine.ledger.demoEditRow(command.seq);
      else await engine.ledger.demoRewriteChain(command.seq);
      post({ type: 'ledger', records: engine.ledger.snapshot() });
      emitState();
      break;
    }
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
  void handle(event.data).catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
});
