import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planFridayTeardown, planIdleReclamation } from './scheduler.ts';

const now = new Date('2026-11-13T18:00:00Z');

describe('reclamation scheduling', () => {
  it('destroys only Friday-safe sandbox environments', () => {
    const actions = planFridayTeardown([
      { id: 'sandbox', tier: 'sandbox', units: [{ path: 'a' }] },
      { id: 'retained', tier: 'sandbox', units: [{ path: 'b' }], retentionExpiresAt: '2026-11-15T00:00:00Z' },
      { id: 'prod', tier: 'prod', units: [{ path: 'c' }] },
    ], now);
    assert.deepEqual(actions, [{ type: 'destroy', environmentId: 'sandbox', reason: 'friday' }]);
  });

  it('notifies first and waits through the idle grace period', () => {
    const base = { tier: 'sandbox', units: [{ path: 'a' }], reclaimReason: 'idle', idleEvidence: { idle: true, fresh: true } };
    assert.deepEqual(planIdleReclamation([{ id: 'new', ...base }], now, { graceHours: 24, autoTeardown: true }), [
      { type: 'notify', environmentId: 'new', reason: 'idle' },
    ]);
    assert.deepEqual(planIdleReclamation([{ id: 'waiting', ...base, notifiedAt: '2026-11-13T12:00:00Z' }], now, { graceHours: 24, autoTeardown: true }), []);
    assert.deepEqual(planIdleReclamation([{ id: 'expired', ...base, notifiedAt: '2026-11-12T12:00:00Z' }], now, { graceHours: 24, autoTeardown: true }), [
      { type: 'destroy', environmentId: 'expired', reason: 'idle' },
    ]);
  });

  it('never auto-destroys idle candidates when automation is disabled', () => {
    const candidate = { id: 'manual', tier: 'sandbox', units: [{ path: 'a' }], reclaimReason: 'idle', idleEvidence: { idle: true, fresh: true }, notifiedAt: '2026-11-01T00:00:00Z' };
    assert.deepEqual(planIdleReclamation([candidate], now, { graceHours: 24, autoTeardown: false }), []);
  });
});
