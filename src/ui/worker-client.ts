/**
 * The only bridge between the UI and the simulation (CLAUDE.md section 5).
 *
 * The UI imports this and types from src/sim/types.ts, and nothing else from
 * src/sim. The worker owns all mutable state; this just ships commands across
 * and hands back whatever comes.
 */

import type { WorkerCommand, WorkerEvent } from '../sim/types';

export type WorkerEventHandler = (event: WorkerEvent) => void;

export class SimulationClient {
  private worker: Worker | null = null;
  private handlers = new Set<WorkerEventHandler>();

  start(): void {
    if (this.worker) return;

    // `type: 'module'` so the worker can use normal imports. Vite resolves
    // this URL and bundles the worker for production.
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.addEventListener('message', (event: MessageEvent<WorkerEvent>) => {
      for (const handler of this.handlers) handler(event.data);
    });

    this.worker.addEventListener('error', (event) => {
      for (const handler of this.handlers) {
        handler({ type: 'error', message: event.message || 'worker failed' });
      }
    });
  }

  on(handler: WorkerEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(command: WorkerCommand): void {
    this.worker?.postMessage(command);
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.handlers.clear();
  }
}
