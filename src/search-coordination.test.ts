import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RequestSequencer } from './search-coordination.ts';

describe('request sequencer (stale response protection)', () => {
  it('marks the latest request as current', () => {
    const seq = new RequestSequencer();
    const first = seq.next();
    assert.equal(seq.isCurrent(first), true);
  });

  it('invalidates an older request once a newer one is issued', () => {
    const seq = new RequestSequencer();
    const first = seq.next();
    const second = seq.next();
    assert.equal(seq.isCurrent(first), false);
    assert.equal(seq.isCurrent(second), true);
  });

  it('a slow stale response cannot replace newer results', () => {
    const seq = new RequestSequencer();
    const stale = seq.next(); // request A in flight
    const current = seq.next(); // request B supersedes it
    // Simulate the responses arriving out of order: A resolves later.
    assert.equal(seq.isCurrent(stale), false); // A's result must be dropped
    assert.equal(seq.isCurrent(current), true); // B's result is accepted
  });

  it('sequence numbers are strictly increasing', () => {
    const seq = new RequestSequencer();
    const a = seq.next();
    const b = seq.next();
    const c = seq.next();
    assert.ok(a < b && b < c);
  });
});
