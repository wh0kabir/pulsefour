import { describe, expect, it } from 'vitest';

import { Ledger, canonicalJson, computeHash, sha256Hex } from '../src/sim/ledger';
import { GENESIS_PREV_HASH } from '../src/sim/types';

function makeLedger(): Ledger {
  return new Ledger('0.1.0-test+abc1234', 'confighash');
}

async function seed(ledger: Ledger, count = 6): Promise<void> {
  for (let i = 0; i < count; i++) {
    await ledger.append({
      simMin: i,
      type: 'assignment_confirmed',
      actor: 'system',
      payload: { casualtyId: `C${i}`, ambulanceId: `A${i % 3}` },
    });
  }
}

describe('canonical JSON', () => {
  it('sorts keys so the same record always hashes the same', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('is stable for nested objects and arrays', () => {
    const one = canonicalJson({ z: [{ y: 1, x: 2 }], a: { d: 4, c: 3 } });
    const two = canonicalJson({ a: { c: 3, d: 4 }, z: [{ x: 2, y: 1 }] });
    expect(one).toBe(two);
  });

  it('drops undefined values rather than emitting them', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('produces no insignificant whitespace', () => {
    expect(canonicalJson({ a: [1, 2, 3] })).toBe('{"a":[1,2,3]}');
  });
});

describe('hashing', () => {
  it('matches the known SHA-256 of a known string', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the same record identically every time', async () => {
    const draft = {
      seq: 0,
      simMin: 3,
      type: 'handover' as const,
      actor: 'system' as const,
      payload: { b: 1, a: 2 },
      systemVersion: 'v',
      configHash: 'c',
      prevHash: GENESIS_PREV_HASH,
    };
    const a = await computeHash(draft);
    // Same content, different key insertion order.
    const b = await computeHash({ ...draft, payload: { a: 2, b: 1 } });
    expect(a).toBe(b);
  });
});

describe('Ledger', () => {
  it('starts empty with a genesis head', () => {
    const ledger = makeLedger();
    expect(ledger.length).toBe(0);
    expect(ledger.head).toEqual({ seq: -1, hash: GENESIS_PREV_HASH });
  });

  it('chains each record to the previous one', async () => {
    const ledger = makeLedger();
    await seed(ledger, 4);
    const all = ledger.all;

    expect(all[0]!.prevHash).toBe(GENESIS_PREV_HASH);
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.prevHash).toBe(all[i - 1]!.hash);
      expect(all[i]!.seq).toBe(i);
    }
  });

  it('verifies as intact once a checkpoint is pinned', async () => {
    const ledger = makeLedger();
    await seed(ledger);
    ledger.pinCheckpoint();
    const result = await ledger.verify();
    expect(result.state).toBe('intact');
  });

  it('reports no-checkpoint when none has been pinned', async () => {
    const ledger = makeLedger();
    await seed(ledger);
    expect((await ledger.verify()).state).toBe('no-checkpoint');
  });

  it('keeps verifying as intact when more records are appended after the checkpoint', async () => {
    const ledger = makeLedger();
    await seed(ledger, 3);
    ledger.pinCheckpoint();
    await seed(ledger, 3);
    expect((await ledger.verify()).state).toBe('intact');
  });

  it('detects an edited row and names the first bad sequence', async () => {
    const ledger = makeLedger();
    await seed(ledger);
    ledger.pinCheckpoint();

    expect(ledger.demoEditRow(2)).toBe(true);

    const result = await ledger.verify();
    expect(result.state).toBe('broken');
    if (result.state === 'broken') {
      expect(result.atSeq).toBe(2);
      expect(result.expectedHash).not.toBe(result.actualHash);
    }
  });

  it('detects a fully rewritten chain through the checkpoint', async () => {
    const ledger = makeLedger();
    await seed(ledger);
    ledger.pinCheckpoint();

    // Rewriting recomputes every hash, so the chain is internally consistent.
    await ledger.demoRewriteChain(2);

    const result = await ledger.verify();
    // Crucially NOT 'broken': the chain itself is valid. Only the separately
    // pinned checkpoint reveals it.
    expect(result.state).toBe('rewritten');
  });

  it('a rewritten chain would verify as intact WITHOUT a checkpoint', async () => {
    const ledger = makeLedger();
    await seed(ledger);
    await ledger.demoRewriteChain(2);
    const result = await ledger.verify();
    // This is exactly why the checkpoint exists (section 11).
    expect(result.state).toBe('no-checkpoint');
  });

  it('detects removal of rows past the checkpoint', async () => {
    const ledger = makeLedger();
    await seed(ledger, 6);
    ledger.pinCheckpoint();
    const snapshot = ledger.snapshot();

    ledger.restore(snapshot.slice(0, 3));
    expect((await ledger.verify()).state).toBe('rewritten');

    ledger.restore(snapshot);
    expect((await ledger.verify()).state).toBe('intact');
  });

  it('restores cleanly after demo tampering', async () => {
    const ledger = makeLedger();
    await seed(ledger);
    ledger.pinCheckpoint();
    const snapshot = ledger.snapshot();

    ledger.demoEditRow(1);
    expect((await ledger.verify()).state).toBe('broken');

    ledger.restore(snapshot);
    expect((await ledger.verify()).state).toBe('intact');
  });

  it('slices records appended since a given sequence', async () => {
    const ledger = makeLedger();
    await seed(ledger, 5);
    expect(ledger.slice(3).map((r) => r.seq)).toEqual([3, 4]);
  });
});

describe('concurrent appends (regression)', () => {
  it('stays verifiable when appends are fired without awaiting', async () => {
    // Hashing is async. The engine appends from synchronous call sites with
    // `void ledger.append(...)`, so overlapping appends must not both read
    // the same prevHash. This previously broke the chain at a random row.
    const ledger = makeLedger();

    for (let i = 0; i < 60; i++) {
      void ledger.append({
        simMin: i,
        type: 'handover',
        actor: 'system',
        payload: { i },
      });
    }

    await ledger.drain();

    expect(ledger.length).toBe(60);
    const seqs = ledger.all.map((r) => r.seq);
    expect(seqs).toEqual([...Array(60).keys()]);
    expect((await ledger.verify()).state).toBe('no-checkpoint');

    ledger.pinCheckpoint();
    expect((await ledger.verify()).state).toBe('intact');
  });
});
