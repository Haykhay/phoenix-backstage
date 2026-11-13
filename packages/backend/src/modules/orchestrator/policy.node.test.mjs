import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  approvalsSatisfyGates,
  assertLocalDispatchAllowed,
  requestDigest,
  requiredApprovalGates,
  selectTeardownCandidates,
} from './policy.ts';

const request = {
  source: { owner: 'Haykhay', repo: 'phoenix-aws', commit: 'abc123' },
  requester: 'user:default/jdoe',
  action: 'apply',
  tier: 'prod',
  units: [
    { path: 'infrastructure/environments/prod/team-prod/eu-west-1/core-platform.yaml' },
    {
      path: 'k8s-installs/environments/prod/team-prod/eu-west-1/1/vllm.model.yaml',
      component: 'vllm',
    },
  ],
};

describe('approval policy', () => {
  it('requires every distinct tier and component approval group', () => {
    assert.deepEqual(requiredApprovalGates(request, {
      tierApprovalGroups: { prod: 'group:default/platform-prod-approvers' },
      componentApprovalGroups: { vllm: 'group:default/ai-cost-approvers' },
    }), [
      {
        group: 'group:default/platform-prod-approvers',
        reason: 'tier:prod',
        unitPaths: request.units.map(unit => unit.path),
      },
      {
        group: 'group:default/ai-cost-approvers',
        reason: 'component:vllm',
        unitPaths: [request.units[1].path],
      },
    ]);
  });

  it('invalidates approvals when the request commit changes', () => {
    assert.notEqual(requestDigest(request), requestDigest({
      ...request,
      source: { ...request.source, commit: 'def456' },
    }));
  });

  it('fails closed unless every gate has a current-member approval for the digest', () => {
    const gates = requiredApprovalGates(request, {
      tierApprovalGroups: { prod: 'group:default/platform-prod-approvers' },
      componentApprovalGroups: { vllm: 'group:default/ai-cost-approvers' },
    });
    const digest = requestDigest(request);
    const approvals = gates.map((gate, index) => ({
      group: gate.group,
      digest,
      actor: `user:default/approver-${index}`,
      decision: 'approved',
    }));
    const members = new Map([
      [gates[0].group, new Set([approvals[0].actor])],
      [gates[1].group, new Set([approvals[1].actor])],
    ]);
    assert.equal(approvalsSatisfyGates(gates, approvals, digest, members), true);
    members.get(gates[1].group).clear();
    assert.equal(approvalsSatisfyGates(gates, approvals, digest, members), false);
  });
});

describe('reclamation policy', () => {
  const now = new Date('2026-11-13T18:00:00Z');

  it('selects only complete unprotected sandboxes without active retention', () => {
    const environments = [
      { id: 'ready', tier: 'sandbox', units: [{ path: 'a' }] },
      { id: 'prod', tier: 'prod', units: [{ path: 'b' }] },
      { id: 'protected', tier: 'sandbox', units: [{ path: 'c', protected: true }] },
      { id: 'retained', tier: 'sandbox', units: [{ path: 'd' }], retentionExpiresAt: '2026-11-14T18:00:00Z' },
      { id: 'expired', tier: 'sandbox', units: [{ path: 'e' }], retentionExpiresAt: '2026-11-12T18:00:00Z' },
    ];
    assert.deepEqual(selectTeardownCandidates(environments, now).map(item => item.id), ['ready', 'expired']);
  });

  it('does not select an idle candidate when evidence is missing or stale', () => {
    const environments = [
      { id: 'missing', tier: 'sandbox', units: [{ path: 'a' }], reclaimReason: 'idle' },
      { id: 'stale', tier: 'sandbox', units: [{ path: 'b' }], reclaimReason: 'idle', idleEvidence: { idle: true, fresh: false } },
      { id: 'proven', tier: 'sandbox', units: [{ path: 'c' }], reclaimReason: 'idle', idleEvidence: { idle: true, fresh: true } },
    ];
    assert.deepEqual(selectTeardownCandidates(environments, now).map(item => item.id), ['proven']);
  });

  it('rejects non-sandbox local dispatch', () => {
    assert.doesNotThrow(() => assertLocalDispatchAllowed('sandbox'));
    assert.throws(() => assertLocalDispatchAllowed('stage'), /sandbox only/);
    assert.throws(() => assertLocalDispatchAllowed('prod'), /sandbox only/);
  });
});
