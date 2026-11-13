import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { routeOrchestratorRequest } from './router.ts';

const service = {
  async list() { return [{ id: 'request-1' }]; },
  async get(id) { if (id === 'missing') throw new Error('request not found: missing'); return { id }; },
  async create(body) { return { id: 'created', requester: body.requester }; },
  async decide(id, body) { return { id, actor: body.actor, decision: body.decision }; },
  async retry(id) { return { id, status: 'ready' }; },
};

describe('routeOrchestratorRequest', () => {
  it('binds create and approval actors to the authenticated identity', async () => {
    const created = await routeOrchestratorRequest(service, {
      method: 'POST', path: '/requests', identity: 'user:default/jdoe', body: { requester: 'user:default/forged' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.requester, 'user:default/jdoe');

    const decision = await routeOrchestratorRequest(service, {
      method: 'POST', path: '/requests/request-1/decisions', identity: 'user:default/alice',
      body: { group: 'group:default/prod', actor: 'user:default/forged', decision: 'approved' },
    });
    assert.equal(decision.body.actor, 'user:default/alice');
  });

  it('returns safe validation and not-found responses', async () => {
    assert.deepEqual(await routeOrchestratorRequest(service, {
      method: 'POST', path: '/requests', identity: 'user:default/jdoe', body: undefined,
    }), { status: 400, body: { error: 'request body is required' } });
    assert.deepEqual(await routeOrchestratorRequest(service, {
      method: 'GET', path: '/requests/missing', identity: 'user:default/jdoe',
    }), { status: 404, body: { error: 'request not found' } });
  });

  it('does not expose unknown internal errors', async () => {
    const broken = { ...service, async list() { throw new Error('secret database DSN'); } };
    assert.deepEqual(await routeOrchestratorRequest(broken, {
      method: 'GET', path: '/requests', identity: 'user:default/jdoe',
    }), { status: 500, body: { error: 'internal orchestrator error' } });
  });
});
