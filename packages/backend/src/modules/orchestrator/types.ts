export type UnitLayer = 0 | 1 | 2 | 3;

export interface OrchestrationUnit {
  path: string;
  protected?: boolean;
}

export interface ResolvedUnit extends OrchestrationUnit {
  layer: UnitLayer;
  component?: string;
  instance?: string;
}

export type ComponentDependencies = Readonly<Record<string, readonly string[]>>;

export interface RequestUnit extends OrchestrationUnit {
  component?: string;
}

export interface OrchestrationRequestInput {
  source: { owner: string; repo: string; commit: string };
  requester: string;
  action: 'apply' | 'destroy';
  tier: string;
  units: readonly RequestUnit[];
}

export interface ApprovalGate {
  group: string;
  reason: string;
  unitPaths: readonly string[];
}

export interface ApprovalDecision {
  group: string;
  digest: string;
  actor: string;
  decision: 'approved' | 'rejected';
}

export interface ApprovalPolicy {
  tierApprovalGroups?: Readonly<Record<string, string>>;
  componentApprovalGroups?: Readonly<Record<string, string>>;
}

export interface IdleEvidence {
  idle: boolean;
  fresh: boolean;
}

export interface ReclaimableEnvironment {
  id: string;
  tier: string;
  units: readonly OrchestrationUnit[];
  retentionExpiresAt?: string;
  reclaimReason?: 'friday' | 'idle';
  idleEvidence?: IdleEvidence;
}


