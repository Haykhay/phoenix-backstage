# Backstage Orchestrator Design

## Intent

Phoenix needs one control plane for environment delivery. Backstage is that
control plane: it converts a catalog-backed request into ordered Terraform
units, obtains any required Entra-backed approvals, dispatches the existing
`phoenix-aws` Terraform workflow, reports progress, and reclaims disposable
sandboxes. Developers continue to request YAML through Backstage; they do not
operate GitHub Actions or Terraform directly.

## Goals

- Resolve account, networking, infrastructure, and Kubernetes units in a
  deterministic dependency order and reject cycles or unresolved dependencies.
- Gate deployments and weekend retention using current membership of Backstage
  Group entities synchronized from Entra ID.
- Persist requests, unit attempts, approvals, exemptions, and audit events.
- Dispatch one unit at a time through `phoenix-aws/.github/workflows/terraform.yml`,
  waiting for success and stopping on failure.
- Notify requesters and approver groups through Backstage notifications.
- Reclaim sandbox environments on Fridays and flag idle sandboxes, with a
  notification/grace period before optional automatic teardown.
- Exercise the same policy and ordering code locally against Floci before live
  AWS use.

## Non-goals

- Reimplement Terraform apply/destroy in Backstage.
- Treat GitHub Actions as the orchestration state store.
- Maintain approver membership separately from Entra-backed catalog groups.
- Automatically destroy stage or production environments.
- Claim that Floci proves GitHub OIDC federation, IAM enforcement, or true AWS
  account isolation.

## Anti-goals

- An approval that remains valid after its request, unit set, or commit changes.
- A missing/empty/stale approver group silently bypassing a gate.
- A scheduler race dispatching the same unit twice.
- Weekend retention becoming a permanent, unreviewed exemption.

## Constraints

- `main` is the adopted standard; work is delivered through feature branches
  and PRs.
- `terraform.yml` remains the only live apply/destroy implementation.
- Catalog `dependsOn` is authoritative for Layer 3 prerequisites.
- CI is an offline plan/test gate; Floci is the local integration target.
- Existing Backstage catalog, permissions, notifications, scheduler, database,
  and GitHub integration facilities are used rather than parallel systems.

## Approaches

### Chosen: dedicated Backstage backend plugin with a thin frontend

The plugin owns durable orchestration records, policy evaluation, dependency
resolution, approvals, dispatch adapters, scheduler tasks, and HTTP routes. A
small frontend page exposes request status, approvals, retention requests,
run links, failures, and retries. Scaffolder actions create orchestration
requests and link to the record.

This fits long-running state, restarts, retries, scheduling, and auditability.

### Rejected: scaffolder actions only

Scaffolder is a good request entry point but a poor durable coordinator for
multi-day approvals, scheduled reclamation, restart recovery, and operational
queries.

### Rejected: GitHub Actions as orchestrator

Workflow matrices and chained dispatches would move policy and approval state
out of Backstage, conflict with the required control-plane ownership, and make
Entra-backed authorization and notifications harder to audit.

## Domain model

An orchestration request records requester entity ref, source repository and
commit, action (`apply` or `destroy`), ordered units, status, policy snapshot,
and timestamps. Each unit records its path, layer, component/instance identity,
dependencies, attempt state, dispatch identifier, and run URL.

An approval records request ID, exact request digest, approval kind
(`deployment` or `retention`), required group entity ref, decision, actor entity
ref, comment, creation/decision/expiry timestamps, and audit metadata. Decisions
are accepted only when the actor is a current member of the required catalog
group. Membership and request digest are revalidated immediately before a
dispatch or teardown exclusion.

Retention approvals are scoped to an environment/unit set and must expire.
Expired or revoked approvals automatically restore teardown eligibility.

Scaffolder supplies the source owner/repository/ref/commit, requester and
reason, plus exact committed unit paths. The backend reads those files at that
commit, validates identity fields, derives the environment key from tier and
env-id, and enriches Kubernetes units from catalog entities. The request digest
covers commit, action, unit identities, and resolved policy gates.

## Dependency resolution

The resolver is a pure TypeScript function. Unit paths determine fixed layers:
account (external/AFT), networking, infrastructure, then `k8s-installs`.
All earlier-layer units precede later-layer units. Within Layer 3, component
dependencies come from catalog Resource entities' `spec.dependsOn`; component
instances inherit their component's dependencies. A stable topological sort
preserves input order among otherwise-independent nodes. Missing dependencies,
duplicate unit identities, unknown paths, and cycles are explicit errors.
Destroy uses the exact reverse order after protected-unit filtering.

## Policy and approvals

Catalog annotations/config map deployment categories and retention requests to
Entra-synchronized Backstage group entity refs. Policy is deny-by-default when
a gate is required but its group cannot be resolved or has no current members.
Stage/prod apply gates and sensitive/high-cost component gates are supported;
the catalog can add gates without code changes.

Approval notifications include requester, reason, request digest, unit summary,
duration/expiry where applicable, and a Backstage review link. Request changes
invalidate pending or granted decisions.

Every applicable gate must be approved. Gates are grouped by approver group and
the unit subset that caused the gate. Tier defaults live in plugin config;
component gates use `phoenix/deployment-approval-group` and
`phoenix/high-cost`. Retention uses `phoenix/retention-approval-group` with a
configured platform-group fallback.

## Dispatch and recovery

The live adapter uses Backstage's configured GitHub credentials to dispatch
`terraform.yml` with `config_file` and `action`, correlates the resulting run,
stores its URL/ID, and polls to completion. A database lease makes claiming the
next unit atomic. Failures stop the request and notify the requester; retries
create a new attempt without erasing history. On restart, pending/running
requests are reconciled against stored GitHub run IDs.

The workflow gains an `orchestration_id` input and includes it in its run name,
allowing unambiguous correlation. It still applies YAML from `main`; Backstage
refuses dispatch if `main` no longer contains the approved unit identity. A
retry resumes at the failed unit after rechecking the digest, current group
membership, approvals, and successful attempt history.

The local adapter executes the same ordered request against Floci-aware roots
with `TF_VAR_floci=1`, dummy credentials, and `AWS_ENDPOINT_URL`. It is enabled
only by explicit local configuration and must reject production tiers.

## Scheduled reclamation

Backstage scheduler tasks select only sandbox-tier environments. Friday
teardown excludes active, unexpired retention approvals and any protected unit.
Idle detection evaluates configured activity evidence, creates a candidate,
notifies the requester, and waits through a configured grace period. Automatic
teardown is opt-in; otherwise candidates require an operator action.

Selection and state transition are transactional and idempotent. Stage/prod,
accounts, registry, regional/network foundations, and catalog-marked protected
units are never automated teardown targets.

An environment is the complete set of paths sharing its tier/env-id identity.
Retention and reclamation apply to that whole set. If any unit or required
dependency is protected, automated teardown rejects the entire environment.

Idle evidence is provided through an adapter. The live adapter combines
Kubernetes non-system workload activity with node-utilisation evidence over a
configured lookback; the local adapter uses deterministic fixtures. Missing,
stale, contradictory, or inaccessible evidence means “not proven idle” and
cannot trigger automated teardown.

## Floci support

Applicable `phoenix-aws` networking, infrastructure, and Kubernetes Terraform
roots gain a `floci` provider gate following the Layer 0 pattern. Offline tests
cover generated provider configuration and selection safety. Floci integration
starts and seeds `phoenix-local`, runs Backstage with the local adapter, submits
a sandbox request, observes ordered dispatch, and verifies teardown selection.
Unsupported emulated services may be represented by an explicit dry-run result;
the test must distinguish that from a successful real apply.

## UI

The orchestration page provides accessible request/status tables, unit progress,
approval review forms, retention expiry controls, run links, failure detail, and
retry actions. Server-side authorization is authoritative; hidden/disabled UI
controls are only usability aids. Destructive decisions require clear scope and
confirmation.

## Verification

- Unit tests: graph ordering/cycles/missing dependencies, request digests,
  approval membership and invalidation, teardown selection, expiry, idle grace,
  retry/idempotency, and local/live adapter boundaries.
- Backend integration tests: routes, database persistence, scheduler leases,
  notifications, catalog groups, and GitHub run correlation.
- Frontend tests: loading/empty/error states, accessible approval and teardown
  forms, permissions, and status updates.
- `yarn test`, `yarn tsc`, `yarn build`, Terraform tests/validation, `actionlint`,
  and a seeded Floci dry-run/integration scenario.

## Builder calls

- Choose focused plugin-internal modules and migrations consistent with the
  installed Backstage version.
- Use repository-native test utilities and avoid introducing infrastructure
  dependencies that the existing stack already provides.
- Keep the first UI operational and compact; catalog/scaffolder remains the
  request-authoring experience.
