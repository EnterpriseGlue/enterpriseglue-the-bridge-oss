#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export EG_OPERATON_BACKSTOP_COMPOSE_OVERLAY="$repo_root/test/e2e/operaton-container/docker-compose.config-backstop-env.yml"
export OPERATON_CONFIG_BACKSTOP_PASSWORD="${OPERATON_CONFIG_BACKSTOP_PASSWORD:-demo}"
export OPERATON_CONFIG_BACKSTOP_NATIVE_GROUP="${OPERATON_CONFIG_BACKSTOP_NATIVE_GROUP:-egconfigbackstoplocal}"
export OPERATON_CONFIG_BACKSTOP_BROWSER_EVIDENCE=true
export EG_OPERATON_BACKSTOP_PLAYWRIGHT_SPEC="test/e2e/operaton-config-backstop-browser.spec.ts"

exec "$repo_root/scripts/run-operaton-backstop-browser-evidence.sh"
