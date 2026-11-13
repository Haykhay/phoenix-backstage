import { randomUUID } from 'node:crypto';

import {
  approvalsSatisfyGates,
  requestDigest,
  requiredApprovalGates,
} from './policy.ts';
import { resolveInstallOrder } from './resolver.ts';
import type { OrchestrationStore, StoredRequest, StoredUnit } from './store.ts';
import type {
  ApprovalDecision,
  ApprovalPolicy,
  ComponentDependencies,
  OrchestrationRequestInput,
} from './types.ts';

export interface OrchestrationNotification {
  recipient: string;
  title: string;
  description: string;
  requestId: string;
}

export interface ServiceDependencies {
  store: OrchestrationStore;
  policy: ApprovalPolicy;
  componentDependencies: ComponentDependencies;
  getGroupMembers(group: string): Promise<ReadonlySet<string>>;
  notify(notification: OrchestrationNotification): Promise<void>;
  now?: () => Date;
  id?: () => string;
}

export interface ApprovalInput {
  group: string;
  actor: string;
  decision: 'approved' | 'rejected';
}

export class OrchestrationService {
  readonly #deps: ServiceDependencies;

  constructor(dependencies: ServiceDependencies) {
    this.#deps = dependencies;
  }

  #authorizationPayload(request: Pick<StoredRequest,
    'source' | 'requester' | 'action' | 'tier' | 'units' | 'gates' | 'reason' | 'retentionExpiresAt'
  >): unknown {
    return {
      source: request.source,
      requester: request.requester,
      action: request.action,
      tier: request.tier,
      units: request.units.map(unit => ({
        path: unit.path,
        component: unit.component,
        protected: unit.protected,
      })),
      gates: request.gates,
      reason: request.reason,
      retentionExpiresAt: request.retentionExpiresAt,
    };
  }

  #validateTier(input: OrchestrationRequestInput): void {
    const tiers = new Set(input.units.flatMap(unit => {
      const parts = unit.path.split('/');
      return ['infrastructure', 'k8s-installs'].includes(parts[0]) && parts[1] === 'environments'
        ? [parts[2]]
        : [];
    }));
    if (tiers.size > 1 || (tiers.size === 1 && !tiers.has(input.tier))) {
      throw new Error(`request tier ${input.tier} does not match unit paths: ${[...tiers].join(', ')}`);
    }
  }

  async create(input: OrchestrationRequestInput): Promise<StoredRequest> {
    this.#validateTier(input);
    if (input.action === 'retain') {
      if (!input.reason?.trim()) throw new Error('retention reason is required');
      if (!input.retentionExpiresAt || new Date(input.retentionExpiresAt).getTime() <= (this.#deps.now?.() ?? new Date()).getTime()) {
        throw new Error('retention expiry must be in the future');
      }
    }
    const installOrder = resolveInstallOrder(input.units, this.#deps.componentDependencies);
    const ordered = input.action === 'destroy' ? [...installOrder].reverse() : installOrder;
    const enriched = {
      ...input,
      units: ordered.map(unit => ({ path: unit.path, component: unit.component })),
    };
    const gates = requiredApprovalGates(enriched, this.#deps.policy);
    const timestamp = (this.#deps.now?.() ?? new Date()).toISOString();
    const requestWithoutDigest: Omit<StoredRequest, 'digest'> = {
      id: this.#deps.id?.() ?? randomUUID(),
      status: gates.length ? 'pending_approval' : 'ready',
      requester: input.requester,
      tier: input.tier,
      action: input.action,
      source: input.source,
      gates,
      approvals: [],
      units: ordered.map(unit => ({ ...unit, status: 'pending', attempt: 1 })),
      createdAt: timestamp,
      updatedAt: timestamp,
      reason: input.reason,
      retentionExpiresAt: input.retentionExpiresAt,
    };
    const request: StoredRequest = {
      ...requestWithoutDigest,
      digest: requestDigest(this.#authorizationPayload(requestWithoutDigest as StoredRequest)),
    };
    await this.#deps.store.insert(request);
    await Promise.all(gates.map(gate => this.#deps.notify({
      recipient: gate.group,
      title: `Phoenix ${input.action} approval required`,
      description: `${input.requester} requested ${gate.reason}`,
      requestId: request.id,
    })));
    return request;
  }

  async get(id: string): Promise<StoredRequest> {
    const request = await this.#deps.store.get(id);
    if (!request) throw new Error(`request not found: ${id}`);
    return request;
  }

  async list(): Promise<StoredRequest[]> {
    return this.#deps.store.list();
  }

  async decide(id: string, input: ApprovalInput): Promise<StoredRequest> {
    const request = await this.get(id);
    if (!request.gates.some(gate => gate.group === input.group)) {
      throw new Error(`group is not required for request: ${input.group}`);
    }
    const members = await this.#deps.getGroupMembers(input.group);
    if (!members.has(input.actor)) {
      throw new Error(`${input.actor} is not a current member of ${input.group}`);
    }
    const decision: ApprovalDecision = {
      ...input,
      digest: request.digest,
    };
    const allMembers = await this.#approvalMembers(request);
    const timestamp = (this.#deps.now?.() ?? new Date()).toISOString();
    return this.#deps.store.update(id, current => {
      const approvals = [
        ...current.approvals.filter(item => item.group !== input.group),
        { ...decision, digest: current.digest },
      ];
      const approved = approvalsSatisfyGates(
        current.gates,
        approvals,
        current.digest,
        allMembers,
      );
      return {
        ...current,
        approvals,
        status: input.decision === 'rejected'
          ? 'rejected'
          : approved ? (current.action === 'retain' ? 'retained' : 'ready') : current.status,
        updatedAt: timestamp,
      };
    });
  }

  async #approvalMembers(request: StoredRequest): Promise<Map<string, ReadonlySet<string>>> {
    return new Map(await Promise.all(request.gates.map(async gate => [
      gate.group,
      await this.#deps.getGroupMembers(gate.group),
    ] as const)));
  }

  async claimNextUnit(id: string, worker: string): Promise<StoredUnit | undefined> {
    const request = await this.get(id);
    const members = await this.#approvalMembers(request);
    let claimed: StoredUnit | undefined;
    await this.#deps.store.update(id, current => {
      if (current.status !== 'ready') {
        if (current.status === 'running' && current.units.some(unit => unit.status === 'running')) return current;
        throw new Error(`request is not executable: ${current.status}`);
      }
      const currentDigest = requestDigest(this.#authorizationPayload(current));
      if (currentDigest !== current.digest) throw new Error('request digest changed');
      if (current.gates.length && !approvalsSatisfyGates(
        current.gates,
        current.approvals,
        current.digest,
        members,
      )) throw new Error('approval requirements are not satisfied');
      if (current.units.some(unit => unit.status === 'running')) return current;
      const index = current.units.findIndex(unit => unit.status === 'pending');
      if (index < 0) return current;
      const units = current.units.map((unit, unitIndex) => unitIndex === index
        ? { ...unit, status: 'running' as const, leaseOwner: worker }
        : unit);
      claimed = units[index];
      return { ...current, units, status: 'running' };
    });
    return claimed;
  }

  async recordUnitResult(
    id: string,
    path: string,
    result: { status: 'succeeded' | 'failed'; runUrl?: string },
  ): Promise<StoredRequest> {
    return this.#deps.store.update(id, current => {
      const units = current.units.map(unit => unit.path === path
        ? { ...unit, ...result, leaseOwner: undefined }
        : unit);
      const status = result.status === 'failed'
        ? 'failed'
        : units.every(unit => unit.status === 'succeeded') ? 'completed' : 'ready';
      return { ...current, units, status };
    });
  }

  async retry(id: string): Promise<StoredRequest> {
    return this.#deps.store.update(id, current => {
      if (current.status !== 'failed') throw new Error('only failed requests can be retried');
      const units = current.units.map(unit => unit.status === 'failed'
        ? { ...unit, status: 'pending' as const, attempt: unit.attempt + 1, leaseOwner: undefined }
        : unit);
      return { ...current, units, status: 'ready' };
    });
  }
}
