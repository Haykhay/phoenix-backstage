import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executeRequest } from './worker.ts';

describe('executeRequest', () => {
  it('runs units serially and stops after a failure', async () => {
    const units = [
      { path: 'one', action: 'apply', tier: 'sandbox', attempt: 1 },
      { path: 'two', action: 'apply', tier: 'sandbox', attempt: 1 },
    ];
    const recorded = [];
    const dispatched = [];
    await executeRequest({
      requestId: 'req', workerId: 'worker',
      service: {
        get: async () => ({ action: 'apply', tier: 'sandbox' }),
        claimNextUnit: async () => units.shift(),
        recordUnitResult: async (_id, path, result) => recorded.push([path, result.status]),
      },
      dispatcher: {
        dispatch: async input => {
          dispatched.push(input.configFile);
          return { status: input.configFile === 'one' ? 'failed' : 'succeeded' };
        },
      },
    });
    assert.deepEqual(dispatched, ['one']);
    assert.deepEqual(recorded, [['one', 'failed']]);
  });
});
