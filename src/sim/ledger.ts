/**
 * Hash-chained, append-only ledger (CLAUDE.md section 11, locked decision 4).
 *
 * This gives TAMPER-EVIDENCE, not tamper-proofing, and it does not prove the
 * inputs were true. Read the honest wording in section 11 before describing it
 * to anyone.
 *
 * Each record's hash covers the previous record's hash, so editing row 12
 * breaks row 12 and every row after it. Because a ledger held in the browser
 * can be rebuilt end to end by whoever controls the browser, verification also
 * compares the chain head against a CHECKPOINT pinned separately.
 *
 * Uses Web Crypto, which is available in workers and in Node 19+.
 */

import { GENESIS_PREV_HASH, type LedgerActor, type LedgerRecord, type LedgerRecordType, type VerifyResult } from './types';

/**
 * Canonical JSON: object keys sorted, no insignificant whitespace.
 * The same logical record must always produce the same bytes, or the chain
 * cannot be recomputed.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

/** The fields a record's hash covers: everything except `hash` itself. */
export function hashablePart(record: Omit<LedgerRecord, 'hash'>): string {
  return canonicalJson({
    seq: record.seq,
    simMin: record.simMin,
    type: record.type,
    actor: record.actor,
    payload: record.payload,
    systemVersion: record.systemVersion,
    configHash: record.configHash,
    prevHash: record.prevHash,
  });
}

export async function computeHash(record: Omit<LedgerRecord, 'hash'>): Promise<string> {
  return sha256Hex(hashablePart(record));
}

export interface LedgerAppend {
  simMin: number;
  type: LedgerRecordType;
  actor: LedgerActor;
  payload: unknown;
}

export class Ledger {
  private records: LedgerRecord[] = [];
  private checkpoint: { seq: number; hash: string } | undefined;

  private readonly systemVersion: string;
  private readonly configHash: string;

  constructor(systemVersion: string, configHash: string) {
    this.systemVersion = systemVersion;
    this.configHash = configHash;
  }

  get length(): number {
    return this.records.length;
  }

  get all(): readonly LedgerRecord[] {
    return this.records;
  }

  get head(): { seq: number; hash: string } {
    const last = this.records[this.records.length - 1];
    return last
      ? { seq: last.seq, hash: last.hash }
      : { seq: -1, hash: GENESIS_PREV_HASH };
  }

  get pinnedCheckpoint(): { seq: number; hash: string } | undefined {
    return this.checkpoint;
  }

  slice(fromSeq: number): LedgerRecord[] {
    return this.records.filter((r) => r.seq >= fromSeq);
  }

  /**
   * Serialises appends.
   *
   * Hashing is async, so two overlapping appends would both read the same
   * `prevHash` and produce a chain that fails its own verification. Chaining
   * every append onto the last one makes that impossible regardless of how
   * callers invoke it, including fire-and-forget `void ledger.append(...)`.
   */
  private queue: Promise<unknown> = Promise.resolve();

  append(entry: LedgerAppend): Promise<LedgerRecord> {
    const next = this.queue.then(() => this.appendNow(entry));
    // Keep the chain alive even if one append rejects.
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Resolves once every queued append has been written. */
  async drain(): Promise<void> {
    await this.queue;
  }

  private async appendNow(entry: LedgerAppend): Promise<LedgerRecord> {
    const prev = this.records[this.records.length - 1];
    const draft: Omit<LedgerRecord, 'hash'> = {
      seq: this.records.length,
      simMin: entry.simMin,
      type: entry.type,
      actor: entry.actor,
      payload: entry.payload,
      systemVersion: this.systemVersion,
      configHash: this.configHash,
      prevHash: prev ? prev.hash : GENESIS_PREV_HASH,
    };
    const record: LedgerRecord = { ...draft, hash: await computeHash(draft) };
    this.records.push(record);
    return record;
  }

  /**
   * Pin the current head as a checkpoint. In a real deployment this is what
   * you publish or anchor elsewhere; here it is shown separately from the
   * ledger, copyable and exportable.
   */
  pinCheckpoint(): { seq: number; hash: string } {
    this.checkpoint = { ...this.head };
    return this.checkpoint;
  }

  /**
   * Recompute the whole chain and compare it to the pinned checkpoint.
   * Three meaningful outcomes, per section 11.
   */
  async verify(): Promise<VerifyResult> {
    let prevHash = GENESIS_PREV_HASH;

    for (const record of this.records) {
      const expected = await computeHash({
        seq: record.seq,
        simMin: record.simMin,
        type: record.type,
        actor: record.actor,
        payload: record.payload,
        systemVersion: record.systemVersion,
        configHash: record.configHash,
        // Use the hash we actually computed for the previous row, so a broken
        // link is detected at the first row where it diverges.
        prevHash,
      });

      if (record.prevHash !== prevHash || record.hash !== expected) {
        return {
          state: 'broken',
          atSeq: record.seq,
          expectedHash: expected,
          actualHash: record.hash,
        };
      }
      prevHash = record.hash;
    }

    const head = this.head;

    if (!this.checkpoint) return { state: 'no-checkpoint', head };

    // The chain recomputes cleanly. If its head no longer matches what we
    // pinned, someone rebuilt the whole thing -- which is exactly what a
    // browser-held ledger allows, and exactly what the checkpoint catches.
    if (this.checkpoint.seq <= head.seq) {
      const atCheckpoint = this.records[this.checkpoint.seq];
      if (!atCheckpoint || atCheckpoint.hash !== this.checkpoint.hash) {
        return { state: 'rewritten', head, checkpoint: this.checkpoint };
      }
    } else {
      // The ledger is shorter than the checkpoint: rows were removed.
      return { state: 'rewritten', head, checkpoint: this.checkpoint };
    }

    return { state: 'intact', head };
  }

  /* ---------------------------------------------------------------- */
  /* Demo tools (section 11). Never reachable from normal operation.   */
  /* ---------------------------------------------------------------- */

  /** Edit a past record in place, leaving its hash stale. Produces 'broken'. */
  demoEditRow(seq: number): boolean {
    const record = this.records[seq];
    if (!record) return false;
    this.records[seq] = {
      ...record,
      payload: { ...(record.payload as object), tamperedBy: 'demo tools' },
    };
    return true;
  }

  /**
   * Edit a row and then recompute every hash after it, so the chain is
   * internally consistent again. Produces 'rewritten' -- only the separately
   * pinned checkpoint catches this.
   */
  async demoRewriteChain(seq: number): Promise<boolean> {
    if (!this.records[seq]) return false;
    this.records[seq] = {
      ...this.records[seq]!,
      payload: { ...(this.records[seq]!.payload as object), rewrittenBy: 'demo tools' },
    };

    let prevHash = seq === 0 ? GENESIS_PREV_HASH : this.records[seq - 1]!.hash;
    for (let i = seq; i < this.records.length; i++) {
      const draft: Omit<LedgerRecord, 'hash'> = { ...this.records[i]!, prevHash };
      const hash = await computeHash(draft);
      this.records[i] = { ...draft, hash };
      prevHash = hash;
    }
    return true;
  }

  /** Restore from a serialised copy (used to undo demo tampering). */
  restore(records: LedgerRecord[]): void {
    this.records = records.map((r) => ({ ...r }));
  }

  snapshot(): LedgerRecord[] {
    return this.records.map((r) => ({ ...r }));
  }
}
