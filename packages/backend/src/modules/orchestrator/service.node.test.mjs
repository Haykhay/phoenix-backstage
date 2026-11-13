import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemoryOrchestrationStore } from './store.ts';
import { OrchestrationService } from './service.ts';

const input = {
  source: { owner: 'Haykhay', repo: 'phoenix-aws', commit: 'abc123' },
  requester: 'user:default/jdoe',
  action: 'apply',
  tier: 'prod',
  units: [{ path: 'infrastructure/environments/prod/team-prod/eu-west-1/core-platform.yaml' }],
};

function fixture() {
  const store = new MemoryOrchestrationStore();
  const notifications = [];
  const members = new Map([
    ['group:default/prod-approvers', new Set(['user:default/alice'])],
  ]);
  const service = new OrchestrationService({
    store,
    policy: { tierApprovalGroups: { prod: 'group:default/prod-approvers' } },
    componentDependencies: {},
    getGroupMembers: async group => members.get(group) ?? new Set(),
    notify: async notification => { notifications.push(notification); },
  });
  return { store, service, notifications, members };
}

describe('OrchestrationService', () => {
  it('persists a gated request and notifies its approver group', async () => {
    const { service, notifications } = fixture();
    const created = await service.create(input);
    assert.equal(created.status, 'pending_approval');
    assert.equal(created.units[0].status, 'pending');
    assert.deepEqual(notifications.map(item => item.recipient), ['group:default/prod-approvers']);
    assert.equal((await service.get(created.id)).digest, created.digest);
  });

  it('rejects approval from a user outside the current Entra-backed group', async () => {
    const { service } = fixture();
    const created = await service.create(input);
    await assert.rejects(
      service.decide(created.id, {
        group: 'group:default/prod-approvers',
        actor: 'user:default/bob',
        decision: 'approved',
      }),
      /not a current member/,
    );
  });

  it('invalidates approval when the stored request digest changes', async () => {
    const { service, store } = fixture();
    const created = await service.create(input);
    await service.decide(created.id, {
      group: 'group:default/prod-approvers',
      actor: 'user:default/alice',
      decision: 'approved',
    });
    await store.update(created.id, request => ({ ...request, digest: 'changed' }));
    await assert.rejects(service.claimNextUnit(created.id, 'worker-1'), /digest changed/);
  });

  it('moves a fully approved deployment to ready', async () => {
    const { service } = fixture();
    const created = await service.create(input);
    const approved = await service.decide(created.id, {
      group: 'group:default/prod-approvers', actor: 'user:default/alice', decision: 'approved',
    });
    assert.equal(approved.status, 'ready');
  });

  it('recomputes the digest and rejects a changed commit at claim time', async () => {
    const { service, store } = fixture();
    const created = await service.create(input);
    await service.decide(created.id, {
      group: 'group:default/prod-approvers', actor: 'user:default/alice', decision: 'approved',
    });
    await store.update(created.id, request => ({ ...request, source: { ...request.source, commit: 'changed' } }));
    await assert.rejects(service.claimNextUnit(created.id, 'worker'), /digest changed/);
  });

  it('rejects a caller tier that disagrees with committed unit paths', async () => {
    const { service } = fixture();
    await assert.rejects(
      service.create({ ...input, tier: 'sandbox' }),
      /tier.*does not match/,
    );
  });

  it('leases a unit once and resumes at a failed unit on retry', async () => {
    const { service } = fixture();
    const created = await service.create(input);
    await service.decide(created.id, {
      group: 'group:default/prod-approvers', actor: 'user:default/alice', decision: 'approved',
    });
    const first = await service.claimNextUnit(created.id, 'worker-1');
    assert.equal(first.path, input.units[0].path);
    assert.equal(await service.claimNextUnit(created.id, 'worker-2'), undefined);
    await service.recordUnitResult(created.id, first.path, { status: 'failed', runUrl: 'https://example.test/run/1' });
    await service.retry(created.id);
    const retried = await service.claimNextUnit(created.id, 'worker-2');
    assert.equal(retried.path, first.path);
    assert.equal(retried.attempt, 2);
  });

  it('stops the chain after a failed unit', async () => {
    const { service } = fixture();
    const created = await service.create({
      ...input,
      tier: 'sandbox',
      units: [
        { path: 'infrastructure/environments/sandbox/a/eu-west-1/core-network.yaml' },
        { path: 'infrastructure/environments/sandbox/a/eu-west-1/core-platform.yaml' },
      ],
    });
    const first = await service.claimNextUnit(created.id, 'worker');
    await service.recordUnitResult(created.id, first.path, { status: 'failed' });
    await assert.rejects(service.claimNextUnit(created.id, 'worker'), /not executable/);
  });

  it('persists destroy units in reverse dependency order', async () => {
    const { service } = fixture();
    const created = await service.create({
      ...input,
      action: 'destroy',
      tier: 'sandbox',
      units: [
        { path: 'infrastructure/environments/sandbox/a/eu-west-1/core-platform.yaml' },
        { path: 'k8s-installs/environments/sandbox/a/eu-west-1/1/reloader.yaml' },
      ],
    });
    assert.deepEqual(created.units.map(unit => unit.path), [
      'k8s-installs/environments/sandbox/a/eu-west-1/1/reloader.yaml',
      'infrastructure/environments/sandbox/a/eu-west-1/core-platform.yaml',
    ]);
  });

  it('merges independent approval decisions against current stored state', async () => {
    const store = new MemoryOrchestrationStore();
    const groups = new Map([
      ['group:default/prod', new Set(['user:default/alice'])],
      ['group:default/cost', new Set(['user:default/bob'])],
    ]);
    const service = new OrchestrationService({
      store,
      policy: {
        tierApprovalGroups: { prod: 'group:default/prod' },
        componentApprovalGroups: { vllm: 'group:default/cost' },
      },
      componentDependencies: {},
      getGroupMembers: async group => groups.get(group) ?? new Set(),
      notify: async () => {},
    });
    const created = await service.create({
      ...input,
      units: [{
        path: 'k8s-installs/environments/prod/team-prod/eu-west-1/1/vllm.model.yaml',
        component: 'vllm',
      }],
    });
    await service.decide(created.id, { group: 'group:default/prod', actor: 'user:default/alice', decision: 'approved' });
    const result = await service.decide(created.id, { group: 'group:default/cost', actor: 'user:default/bob', decision: 'approved' });
    assert.equal(result.approvals.length, 2);
    assert.equal(result.status, 'ready');
  });

  it('activates a time-bounded retention only after group approval', async () => {
    const { store, members } = fixture();
    members.set('group:default/retention-approvers', new Set(['user:default/alice']));
    const service = new OrchestrationService({
      store,
      policy: { retentionApprovalGroup: 'group:default/retention-approvers' },
      componentDependencies: {},
      getGroupMembers: async group => members.get(group) ?? new Set(),
      notify: async () => {},
    });
    const created = await service.create({
      ...input,
      action: 'retain',
      tier: 'sandbox',
      units: [{ path: 'infrastructure/environments/sandbox/a/eu-west-1/core-platform.yaml' }],
      retentionExpiresAt: '2026-11-16T09:00:00Z',
      reason: 'Monday customer demonstration',
    });
    assert.equal(created.status, 'pending_approval');
    const approved = await service.decide(created.id, {
      group: 'group:default/retention-approvers',
      actor: 'user:default/alice',
      decision: 'approved',
    });
    assert.equal(approved.status, 'retained');
    assert.equal(approved.retentionExpiresAt, '2026-11-16T09:00:00Z');
  });
});
