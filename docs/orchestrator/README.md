# Phoenix Backstage orchestrator

Backstage is Phoenix's control plane. It receives exact unit paths from
Scaffolder, resolves catalog dependencies, obtains Entra-backed approvals, and
dispatches `phoenix-aws/.github/workflows/terraform.yml` one unit at a time.

## Ordering

The fixed order is account → networking → infrastructure → `k8s-installs`.
Layer 3 uses each `phoenix-component` Resource's `spec.dependsOn`. Instances
inherit their component dependencies. Missing prerequisites, duplicates,
unknown paths, and cycles fail before dispatch. Destroy reverses the order.

## Approvals

Entra ID is authoritative. Microsoft Graph synchronizes users/groups into the
catalog; current `Group.spec.members` is checked when deciding and immediately
before dispatch. Configure tier gates under
`phoenix.orchestrator.approvals.tiers`; components can set
`phoenix/deployment-approval-group`. Every applicable group must approve the
exact request digest, so a commit/unit/policy change invalidates approval.

Weekend retention is a `retain` request with a reason and future expiry, using
`phoenix.orchestrator.approvals.retentionGroup`. Expiry restores teardown
eligibility. Backstage notifications go to approver groups and requesters.

## Reclamation safety

Only sandbox is eligible. Stage/prod and an environment containing any
protected unit are rejected as a whole. Idle reclamation requires fresh
affirmative evidence; missing/stale evidence means not idle. Automation is off
by default and always notifies before its grace period.

## Local Floci mode

Start and seed the standard sibling `phoenix-local` repository, then run
Backstage with `PHOENIX_ORCHESTRATOR_MODE=floci`. The local dispatcher creates a
temporary YAML overlay with `floci: true` and a local `aws_endpoint_url`; never
commit those fields to live units. AWS provider gates skip role assumption and
credential/account discovery only for an explicit sandbox overlay.

Floci proves supported AWS API sequencing. Kubernetes applies still require a
reachable Kubernetes API, and local testing cannot prove GitHub OIDC, IAM
enforcement, or real account isolation.

## Recovery

Each attempt has a unique `orchestration_id` and stored run URL. Failure stops
the chain. Retry revalidates the digest, current group membership, approvals,
and successful history, then resumes at the failed unit.

