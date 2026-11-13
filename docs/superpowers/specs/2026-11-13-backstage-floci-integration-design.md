# Backstage and Floci Integration Design

## Intent

This stage proves that the four Phoenix repositories can operate together
locally with Backstage as the configured orchestration boundary and Floci as
the AWS emulator. It does not implement the later Git/approval/merge lifecycle
or decide where Terraform runners execute.

## Goals

- Make the Backstage Yarn/Docker build reproducible.
- Connect the Backstage account catalog provider to the standard Floci instance.
- Start and seed `phoenix-local` from `phoenix-aws-org`.
- Start Backstage with its catalog, templates, account provider, and orchestrator
  plugin enabled in explicit local mode.
- Verify Backstage health, catalog entities/templates, Floci registry data, and
  the offline `phoenix-aws` orchestration/provider tests in one command.
- Fail with a clear diagnostic when repository layout, configuration, Docker,
  Floci, seeding, or Backstage startup is broken.

## Non-goals

- Execute Terraform from Backstage.
- Implement branch, pull-request, approval, or merge orchestration.
- Select GitHub-hosted, self-hosted, or any other runner location.
- Claim that Floci proves IAM/OIDC or real AWS fidelity.

## Approach

`phoenix-local` owns a versioned integration script because it is the shared
local standard. The script resolves sibling repositories, starts a uniquely
named Floci project, seeds Layer 0, confirms the registry, builds and starts the
Backstage Docker stack, and queries Backstage APIs. It then runs Backstage
orchestrator tests plus `phoenix-aws` context tests and workflow linting.

Backstage local configuration uses `host.docker.internal:4566`, dummy AWS
credentials, and `phoenix.orchestrator.mode=floci`. Floci mode initializes the
control plane but deliberately performs no Terraform dispatch at this stage.

## Success criteria

- The Backstage Docker image installs, type-checks, and builds.
- Backstage reports healthy and loads environment/workload templates.
- The Floci-seeded AWS account registry projects account resources into the
  Backstage catalog.
- All existing orchestrator and Terraform context tests pass.
- Cleanup is deterministic and does not remove unrelated Docker projects.
