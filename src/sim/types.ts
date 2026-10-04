/**
 * The state contract (CLAUDE.md section 12).
 *
 * This is the ONLY simulation module the UI may import. The UI renders
 * whatever WorldState the worker sends and never reaches into sim internals.
 * Keep this file free of DOM and React types.
 */

export type Severity = 'red' | 'yellow' | 'green' | 'black';
export type LatLng = { lat: number; lng: number };
export type EdgePos = { edgeId: number; fraction: number };

export type Strategy = 'pulse' | 'nearest' | 'fcfs';
export type Speed = 1 | 2 | 4;

export interface Casualty {
  id: string;
  severity: Severity;
  position: LatLng;
  nodeId: number;
  appearedAtMin: number;
  waitedMin: number;
  limitMin: number;
  status:
    | 'waiting' | 'assigned' | 'pickup' | 'transporting'
    | 'queued_at_ed' | 'admitted' | 'adverse' | 'unserved';
  ambulanceId?: string;
  hospitalId?: string;
}

export interface Ambulance {
  id: string;
  kind: 'BLS' | 'ALS';
  position: LatLng;
  edgePos: EdgePos;
  status: 'idle' | 'to_patient' | 'to_hospital' | 'offline';
  routeEdgeIds: number[];
  casualtyId?: string;
  hospitalId?: string;
}

/**
 * Where each hospital field came from. Section 15 requires a visible badge on
 * anything 'simulated'. OpenStreetMap does NOT tell us trauma capability.
 */
export interface Provenance {
  location: 'osm';
  capacity: 'verified' | 'simulated';
  capability: 'verified' | 'simulated';
}

export interface Hospital {
  id: string;
  name: string;
  position: LatLng;
  nodeId: number;
  traumaCapable: boolean;
  hasIcu: boolean;
  beds: { total: number; available: number; icuTotal: number; icuAvailable: number };
  supplies: { bloodUnits: number; oxygenUnits: number };
  /** Casualty ids waiting for a bed to free. */
  edQueue: string[];
  provenance: Provenance;
}

/** Every number here is a number the allocator actually used (section 9.7). */
export interface DecisionFactors {
  travelToCasualtyMin: number;
  travelToHospitalMin: number;
  loadPenaltyMin: number;
  severityWeight: number;
  waitingFactor: number;
  totalCost: number;
}

export interface DecisionAlternative {
  hospitalId?: string;
  ambulanceId?: string;
  cost?: number;
  rejectedBecause?: string;
}

export interface Decision {
  id: string;
  simMin: number;
  kind: 'assignment' | 'reassignment' | 'escalation';
  status: 'suggested' | 'confirmed' | 'overridden' | 'rejected' | 'completed';
  casualtyId: string;
  ambulanceId?: string;
  hospitalId?: string;
  factors: DecisionFactors;
  alternatives: DecisionAlternative[];
  /** Plain English, shown in the "why" card. */
  reason: string;
}

/** Section 9.9. Computed identically for all three strategies. */
export interface Metrics {
  meanResponseMin: number;
  shareWithinTarget: number;
  redToTraumaShare: number;
  meanAdmissionMinBySeverity: Partial<Record<Severity, number>>;
  overloadEvents: number;
  peakHospitalLoad: number;
  pastLimitCount: number;
  unservedCount: number;
  /** Standard deviation of per-hospital load fractions. */
  loadSpread: number;
}

export interface WorldState {
  tick: number;
  simMin: number;
  running: boolean;
  speed: Speed;
  strategy: Strategy;
  autoAccept: boolean;
  congestion: number;
  casualties: Casualty[];
  ambulances: Ambulance[];
  hospitals: Hospital[];
  closedEdgeIds: number[];
  /** Recent window, not the whole history. */
  decisions: Decision[];
  /** Decision ids awaiting operator confirmation. */
  pending: string[];
  escalations: string[];
  metrics: Metrics;
  ledgerHead: { seq: number; hash: string };
  checkpoint?: { seq: number; hash: string };
}

/* ------------------------------------------------------------------ */
/* Road graph data file (public/data/graph.json, built by scripts)    */
/* ------------------------------------------------------------------ */

/** One of our speed classes. Mirrors RoadClass in src/config/assumptions.ts. */
export type SpeedClass =
  | 'motorway' | 'trunk' | 'primary' | 'secondary'
  | 'tertiary' | 'residential' | 'other';

/**
 * The compact graph file. Parallel arrays: an edge's index IS its edgeId,
 * and those ids are stable across rebuilds.
 */
export interface GraphFile {
  meta: {
    generated: string;
    source: string;
    osmnxVersion: string;
    component: string;
    nodeCount: number;
    edgeCount: number;
    coordDecimalPlaces: number;
    attribution: string;
    licence: string;
  };
  /** OSM highway tag per class index, for map colouring. */
  classes: string[];
  /** Our speed class per class index, for routing. */
  speedClasses: SpeedClass[];
  /** Street names. Edges index into this; -1 means unnamed. */
  names: string[];
  nodes: { lat: number[]; lng: number[]; osmId: number[] };
  edges: {
    from: number[];
    to: number[];
    lengthM: number[];
    classIdx: number[];
    osmWayId: number[];
    /** 0 or 1. */
    oneway: number[];
    nameIdx: number[];
    /** Flat [lat, lng, ...] interior points, or 0 for a straight edge. */
    geom: (number[] | 0)[];
  };
}

/* ------------------------------------------------------------------ */
/* Ledger (section 11)                                                */
/* ------------------------------------------------------------------ */

export type LedgerRecordType =
  | 'casualty_registered' | 'assignment_suggested' | 'assignment_confirmed'
  | 'assignment_overridden' | 'reassignment' | 'escalation' | 'handover'
  | 'supply_transfer' | 'event_injected' | 'operator_action';

export type LedgerActor = 'system' | 'system-auto' | 'operator' | 'scenario';

export interface LedgerRecord {
  seq: number;
  simMin: number;
  type: LedgerRecordType;
  actor: LedgerActor;
  payload: unknown;
  /** package version plus git short sha, injected at build time. */
  systemVersion: string;
  /** SHA-256 of the canonical assumptions/config in force. */
  configHash: string;
  /** Genesis uses 64 zeros. */
  prevHash: string;
  /** SHA-256 of canonical JSON of all fields above except hash. */
  hash: string;
}

export const GENESIS_PREV_HASH = '0'.repeat(64);

export type VerifyResult =
  | { state: 'intact'; head: { seq: number; hash: string } }
  | { state: 'broken'; atSeq: number; expectedHash: string; actualHash: string }
  | { state: 'rewritten'; head: { seq: number; hash: string }; checkpoint: { seq: number; hash: string } }
  | { state: 'no-checkpoint'; head: { seq: number; hash: string } };

/* ------------------------------------------------------------------ */
/* Scenario and operator surfaces (section 10)                        */
/* ------------------------------------------------------------------ */

/** Simulated world events. Labelled "Inject event" in the UI. */
export type ScenarioEvent =
  | { type: 'closeRoad'; osmid?: string; edgeIds?: number[]; wholeRoad: boolean }
  | { type: 'openRoad'; osmid?: string; edgeIds?: number[]; wholeRoad: boolean }
  | { type: 'fillHospital'; hospitalId: string; availableBeds: number }
  | { type: 'surge'; center: LatLng; count: number; spreadM: number;
      severityMix?: Partial<Record<Severity, number>> }
  | { type: 'ambulanceOffline'; ambulanceId: string }
  | { type: 'ambulanceOnline'; ambulanceId: string }
  | { type: 'resupply'; hospitalId: string; bloodUnits: number; oxygenUnits: number }
  | { type: 'setCongestion'; multiplier: number };

/** Real actions a dispatcher takes. */
export type OperatorAction =
  | { type: 'confirm'; decisionId: string }
  | { type: 'override'; decisionId: string; ambulanceId?: string; hospitalId?: string }
  | { type: 'reject'; decisionId: string }
  | { type: 'resolveEscalation'; casualtyId: string;
      resolution: 'hold' | 'forceDispatch' | 'markHandled'; hospitalId?: string };

export interface StrategyResult {
  strategy: Strategy;
  seed: number;
  metrics: Metrics;
}

/* ------------------------------------------------------------------ */
/* Worker protocol (section 5)                                        */
/* ------------------------------------------------------------------ */

export type WorkerCommand =
  | { type: 'init'; scenarioId: string; seed?: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'inject'; event: ScenarioEvent }
  | { type: 'operator'; action: OperatorAction }
  | { type: 'setAutoAccept'; value: boolean }
  | { type: 'reset'; seed?: number }
  | { type: 'runComparison' }
  | { type: 'pinCheckpoint' }
  | { type: 'verifyLedger' }
  | { type: 'demoTamper'; mode: 'edit-row' | 'rewrite-chain'; seq: number };

export type WorkerEvent =
  | { type: 'state'; state: WorldState }
  | { type: 'ledger'; records: LedgerRecord[] }
  | { type: 'comparison'; results: StrategyResult[] }
  | { type: 'verify'; result: VerifyResult }
  | { type: 'error'; message: string };
