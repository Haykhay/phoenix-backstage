import { createHash } from 'node:crypto';

import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalPolicy,
  OrchestrationRequestInput,
  ReclaimableEnvironment,
} from './types.ts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

export function requestDigest(request: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(request)))
    .digest('hex');
}

export function requiredApprovalGates(
  request: OrchestrationRequestInput,
  policy: ApprovalPolicy,
): ApprovalGate[] {
  const gates: ApprovalGate[] = [];
  if (request.action === 'retain') {
    if (!policy.retentionApprovalGroup) {
      throw new Error('retention approval group is not configured');
    }
    return [{
      group: policy.retentionApprovalGroup,
      reason: 'weekend-retention',
      unitPaths: request.units.map(unit => unit.path),
    }];
  }
  const tierGroup = policy.tierApprovalGroups?.[request.tier];
  if (tierGroup) {
    gates.push({
      group: tierGroup,
      reason: `tier:${request.tier}`,
      unitPaths: request.units.map(unit => unit.path),
    });
  }

  const grouped = new Map<string, { reasons: Set<string>; paths: string[] }>();
  for (const unit of request.units) {
    if (!unit.component) continue;
    const group = policy.componentApprovalGroups?.[unit.component];
    if (!group) continue;
    const entry = grouped.get(group) ?? { reasons: new Set(), paths: [] };
    entry.reasons.add(`component:${unit.component}`);
    entry.paths.push(unit.path);
    grouped.set(group, entry);
  }
  for (const [group, entry] of grouped) {
    gates.push({
      group,
      reason: [...entry.reasons].sort().join(','),
      unitPaths: entry.paths,
    });
  }
  return gates;
}

export function approvalsSatisfyGates(
  gates: readonly ApprovalGate[],
  approvals: readonly ApprovalDecision[],
  digest: string,
  currentMembers: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  return gates.every(gate => {
    const members = currentMembers.get(gate.group);
    if (!members?.size) return false;
    return approvals.some(approval =>
      approval.group === gate.group &&
      approval.digest === digest &&
      approval.decision === 'approved' &&
      members.has(approval.actor),
    );
  });
}

export function selectTeardownCandidates(
  environments: readonly ReclaimableEnvironment[],
  now: Date,
): ReclaimableEnvironment[] {
  return environments.filter(environment => {
    if (environment.tier !== 'sandbox') return false;
    if (environment.units.some(unit => unit.protected)) return false;
    if (
      environment.retentionExpiresAt &&
      new Date(environment.retentionExpiresAt).getTime() > now.getTime()
    ) return false;
    if (environment.reclaimReason === 'idle') {
      return environment.idleEvidence?.idle === true &&
        environment.idleEvidence.fresh === true;
    }
    return true;
  });
}

export function assertLocalDispatchAllowed(tier: string): void {
  if (tier !== 'sandbox') {
    throw new Error(`local Floci dispatch is sandbox only; received ${tier}`);
  }
}
