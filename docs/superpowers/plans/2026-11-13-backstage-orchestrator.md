# Backstage Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Backstage the durable, Entra-authorized orchestrator for ordered Phoenix deployments, approvals, notifications, retention, idle reclamation, and Floci verification.

**Architecture:** Focused modules in the existing Backstage backend package implement pure domain logic, durable storage, routes, scheduling, and live/local dispatch adapters. The existing app exposes operational pages. `phoenix-aws` keeps Terraform ownership while adding correlation metadata and Floci provider gates.

**Tech Stack:** TypeScript, Backstage backend system and frontend system, React, Jest, Knex/Backstage database, GitHub Actions, Terraform, Floci.

**Spec:** `docs/superpowers/specs/2026-11-13-backstage-orchestrator-design.md`

## Global Constraints

- Entra-synchronized Backstage Group entities are the only approver-membership source.
- Every applicable approval gate must pass; missing membership fails closed.
- Only sandbox environments are eligible for scheduled teardown.
- Any protected unit makes the complete environment ineligible for automated teardown.
- Missing or stale idle evidence means not proven idle.
- Live Terraform execution remains in `phoenix-aws/.github/workflows/terraform.yml`.
- All production behavior is introduced test-first.

## Review Focus

- Concurrent scheduler/API workers must not claim the same request or unit twice.
- Catalog group changes between approval and dispatch must invalidate authorization.
- Unit or commit changes must invalidate the request digest and approvals.
- GitHub workflow correlation must remain unique under concurrent identical unit dispatches.
- Local mode must reject stage/prod and must never contact live GitHub/AWS endpoints.

---

### Task 1: Pure orchestration domain

**Files:**
- Create: `packages/backend/src/modules/orchestrator/types.ts`
- Create: `packages/backend/src/modules/orchestrator/resolver.ts`
- Create: `packages/backend/src/modules/orchestrator/policy.ts`
- Test: `packages/backend/src/modules/orchestrator/resolver.test.ts`
- Test: `packages/backend/src/modules/orchestrator/policy.test.ts`

**Interfaces:**
- Produces: `resolveInstallOrder(units, componentDependencies)`, `requestDigest(request)`, `requiredApprovalGates(request, policy)`, `selectTeardownCandidates(environments, now)`.

- [ ] Write resolver tests for fixed layer order, stable Layer 3 topological order, instances, missing dependencies, duplicates, and cycles; run and observe expected failures.
- [ ] Implement minimal resolver and run tests green.
- [ ] Write policy tests for all-gates approval, current group membership, digest invalidation, expiry, protected environments, stage/prod rejection, missing idle evidence, and local-mode safety; run red.
- [ ] Implement policy/digest/selection functions and run all domain tests green.

### Task 2: Durable orchestration service and API

**Files:**
- Create: `packages/backend/src/modules/orchestrator/store.ts`
- Create: `packages/backend/src/modules/orchestrator/service.ts`
- Create: `packages/backend/src/modules/orchestrator/router.ts`
- Create: `packages/backend/src/modules/orchestrator/module.ts`
- Test: `packages/backend/src/modules/orchestrator/service.test.ts`
- Test: `packages/backend/src/modules/orchestrator/router.test.ts`
- Modify: `packages/backend/src/index.ts`

**Interfaces:**
- Consumes: Task 1 domain functions.
- Produces: request/create/read/list, approve/reject, retention, retry, and scheduler operations; versioned `/api/orchestrator` routes.

- [ ] Write service tests for state transitions, leases/idempotency, current catalog group checks, audit history, retry-at-failure, notifications, and restart recovery; run red.
- [ ] Implement database-backed store and service with atomic claims; run green.
- [ ] Write route tests for validation, identity binding, permission denial, conflict responses, and safe error bodies; run red.
- [ ] Implement routes/backend module and register it; run backend tests green.

### Task 3: Dispatch, scheduling, and local Floci adapter

**Files:**
- Create: `packages/backend/src/modules/orchestrator/dispatch.ts`
- Create: `packages/backend/src/modules/orchestrator/scheduler.ts`
- Test: `packages/backend/src/modules/orchestrator/dispatch.test.ts`
- Test: `packages/backend/src/modules/orchestrator/scheduler.test.ts`
- Modify: `app-config.yaml`
- Modify: `app-config.docker.yaml`

**Interfaces:**
- Produces: `GitHubWorkflowDispatcher`, `FlociDispatcher`, Friday teardown and idle-detection tasks.

- [ ] Write dispatch tests for correlation, sequential waiting, stop-on-failure, reconciliation, and local endpoint/tier isolation; run red.
- [ ] Implement live and local adapters; run green.
- [ ] Write scheduler tests for Friday selection, retention expiry, notification grace, opt-in teardown, and transaction leases; run red.
- [ ] Implement scheduler tasks/config and run backend suite green.

### Task 4: Backstage operational UI

**Files:**
- Create: `packages/app/src/components/orchestrator/OrchestratorPage.tsx`
- Create: `packages/app/src/components/orchestrator/OrchestratorPage.test.tsx`
- Create: `packages/app/src/components/orchestrator/api.ts`
- Modify: `packages/app/src/App.tsx`

**Interfaces:**
- Consumes: Task 2 HTTP API.
- Produces: request status, unit progress, approval/retention forms, run links, failure detail, and retry controls.

- [ ] Consult modern-web-guidance for accessible status tables, forms, confirmation dialogs, and date/expiry inputs.
- [ ] Write UI tests for loading/empty/error states, approval visibility, accessible form errors, destructive confirmation, expiry, and retry; run red.
- [ ] Implement the page/API route and follow retrieved guidance; run app tests green.

### Task 5: GitHub workflow correlation and Floci provider gates

**Files:**
- Modify: `/private/tmp/phoenix-worktrees/aws-floci-orchestration/.github/workflows/terraform.yml`
- Modify: applicable provider/variable files under `networking/`, `infrastructure/`, and `k8s-installs/`
- Add/modify: Terraform tests adjacent to affected roots.

**Interfaces:**
- Consumes: `orchestration_id`, `config_file`, and `action` from Backstage.
- Produces: uniquely correlated runs and `var.floci` provider behavior.

- [ ] Add an offline workflow assertion that requires and surfaces `orchestration_id`; run red.
- [ ] Update workflow dispatch/run naming and validate with `actionlint`.
- [ ] Add Terraform tests proving Floci endpoint/credential selection and live assume-role selection; run red.
- [ ] Add minimal shared provider gates to applicable roots and run Terraform tests green.

### Task 6: Integration harness and runbook

**Files:**
- Create: `docs/orchestrator/README.md`
- Create: `scripts/test-orchestrator-floci.sh`
- Modify: scaffolder template to submit exact committed paths to the orchestrator.
- Modify: `README.md`

**Interfaces:**
- Produces: reproducible `phoenix-local make up && make seed` orchestration verification and operator documentation.

- [ ] Write harness assertions for ordered local dispatch, approval pause/resume, Friday selection, retention exclusion, and failed-unit retry; run red.
- [ ] Implement harness/template integration and run against seeded Floci or record explicit emulator limitations.
- [ ] Document configuration, Entra group annotations, triggering, approvals, schedules, exemptions, recovery, local testing, and live limitations.
- [ ] Run Backstage tests/typecheck/build, Terraform tests, `actionlint`, and repository status/diff review.
