#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"

node .yarn/releases/yarn-4.13.0.cjs install --immutable >/dev/null

ruby -ryaml -e '
  config = YAML.load_file("app-config.docker.yaml")
  abort "registry endpoint must be configurable for host Floci" unless config.dig("phoenix", "registry", "endpoint") == "${FLOCI_ENDPOINT:-http://host.docker.internal:4566}"
  abort "orchestrator must use explicit floci mode" unless config.dig("phoenix", "orchestrator", "mode") == "floci"
  compose = YAML.load_file("docker-compose.yaml")
  env = compose.dig("services", "backstage", "environment")
  abort "local AWS access key missing" unless env["AWS_ACCESS_KEY_ID"] == "test"
  abort "local AWS secret key missing" unless env["AWS_SECRET_ACCESS_KEY"] == "test"
  abort "local AWS region missing" unless env["AWS_DEFAULT_REGION"] == "eu-west-1"
  abort "Floci endpoint is not passed into Backstage" unless env["FLOCI_ENDPOINT"] == "${FLOCI_ENDPOINT:-http://host.docker.internal:4566}"
  abort "Backstage port is not configurable" unless compose.dig("services", "backstage", "ports") == ["${BACKSTAGE_PORT:-7007}:7007"]
'

echo "Backstage local package and Floci configuration verified"
