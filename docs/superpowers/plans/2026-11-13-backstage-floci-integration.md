# Backstage and Floci Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove all Phoenix repositories integrate locally through a correctly configured Backstage control plane and the standard Floci environment.

**Architecture:** `phoenix-backstage` fixes its package-manager and Docker-to-Floci configuration. `phoenix-local` owns a fail-fast harness that composes and verifies `phoenix-aws-org`, `phoenix-aws`, and `phoenix-backstage` without implementing deployment flow.

**Tech Stack:** Bash, Docker Compose, Yarn 4, Backstage, Terraform, AWS CLI, Floci.

**Spec:** `docs/superpowers/specs/2026-11-13-backstage-floci-integration-design.md`

## Global Constraints

- No direct Terraform execution from Backstage.
- No runner-location decision.
- The harness targets sandbox/local resources only.
- Each Docker project name is unique and cleanup is scoped to it.

## Review Focus

- Container-to-host Floci addressing must work on macOS Docker Desktop.
- Missing sibling repositories must fail before starting containers.
- Failed seed or Backstage startup must preserve useful logs.
- Credentials must be dummy local values and never printed as secrets.
- Cleanup must not stop another developer's Floci or Backstage instance.

### Task 1: Repair Backstage package and Floci configuration

**Files:**
- Modify: `.yarnrc.yml`
- Create: `.yarn/plugins/@yarnpkg/plugin-backstage.cjs`
- Modify: `app-config.docker.yaml`
- Modify: `docker-compose.yaml`
- Test: `scripts/verify-local-config.sh`

- [ ] Write failing configuration assertions for the Backstage Yarn plugin, Floci endpoint, dummy credentials, and explicit local orchestrator mode.
- [ ] Import the official Backstage Yarn plugin and add minimal Docker configuration.
- [ ] Run configuration assertions, immutable install, type-check, and backend build.
- [ ] Commit the Backstage changes.

### Task 2: Add the shared four-repository integration harness

**Files (phoenix-local):**
- Create: `scripts/verify-backstage-integration.sh`
- Create: `tests/verify-backstage-integration.bats` or dependency-free shell test
- Modify: `Makefile`
- Modify: `README.md`

- [ ] Write failing tests for repository discovery, command failure, project-name isolation, and cleanup.
- [ ] Implement `make verify-backstage` with explicit repository overrides.
- [ ] Verify seed, registry, Backstage health/catalog/templates, orchestrator tests, Terraform context tests, and `actionlint`.
- [ ] Commit the phoenix-local changes.

### Task 3: Run and document the integration

- [ ] Run the harness against fresh uniquely named Docker projects.
- [ ] Record any explicit Floci limitations without treating dry-run as apply success.
- [ ] Push both feature branches and create cross-linked PRs against `main`.
