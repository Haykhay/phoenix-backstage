#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
phoenix_root=$(cd "$repo_root/.." && pwd)
local_repo=${PHOENIX_LOCAL_DIR:-$phoenix_root/phoenix-local}
aws_repo=${PHOENIX_AWS_DIR:-$phoenix_root/AWS}

make -C "$local_repo" up PROJECT="${PROJECT:-phoenix-orchestrator-test}"
make -C "$local_repo" seed PROJECT="${PROJECT:-phoenix-orchestrator-test}"
node --test "$repo_root"/packages/backend/src/modules/orchestrator/*.node.test.mjs
terraform -chdir="$aws_repo/infrastructure/modules/context" test
actionlint "$aws_repo/.github/workflows/terraform.yml"

echo "Floci seeded; offline orchestration/provider gates passed."
echo "Kubernetes applies need a local Kubernetes API and remain dry-run-only."
