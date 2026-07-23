#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${PLAYWRIGHT_BASE_URL:-https://localhost:5443}"
api_url="${ENGINE_TENANCY_API_URL:-http://localhost:8787}"
mock_control_url="${CAMUNDA_MOCK_CONTROL_URL:-http://localhost:${CAMUNDA_MOCK_HOST_PORT:-59080}}"
ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-.local/docker/keycloak-tls/ca.crt}"
env_file="${ENGINE_TENANCY_LOCAL_ENV_FILE:-.local/docker/env/docker.env}"

is_local_url() {
  node --input-type=module - "$1" <<'NODE'
const value = process.argv[2];
try {
  const hostname = new URL(value).hostname;
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local');
  process.exit(local ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

if ! is_local_url "$base_url" || ! is_local_url "$api_url" || ! is_local_url "$mock_control_url"; then
  echo "[engine-tenancy-provisioning] Browser, API, and mock-control URLs must target localhost, loopback, or a .local host." >&2
  exit 2
fi

if [[ ! -f "$env_file" ]]; then
  echo "[engine-tenancy-provisioning] Local Docker environment file does not exist: $env_file" >&2
  exit 2
fi

if [[ ! -f "$ca_file" ]]; then
  echo "[engine-tenancy-provisioning] Local CA file does not exist: $ca_file" >&2
  exit 2
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]] && [[ "${PROVISIONING_ALLOW_DIRTY:-false}" != "true" ]]; then
  echo "[engine-tenancy-provisioning] Release evidence must be run from a clean worktree." >&2
  exit 2
fi

if ! curl --fail --silent --show-error --max-time 5 "$api_url/ready" >/dev/null; then
  echo "[engine-tenancy-provisioning] Backend readiness check failed at $api_url/ready." >&2
  exit 2
fi

if ! curl --fail --silent --show-error --max-time 5 "$mock_control_url/health" >/dev/null; then
  echo "[engine-tenancy-provisioning] Mock-engine control endpoint is unavailable at $mock_control_url/health." >&2
  exit 2
fi

if ! curl --fail --silent --show-error --max-time 5 --cacert "$ca_file" "$base_url/login" >/dev/null; then
  echo "[engine-tenancy-provisioning] TLS frontend is unavailable at $base_url/login." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

export POSTGRES_HOST=127.0.0.1
export POSTGRES_PORT="${POSTGRES_HOST_PORT:-5432}"
export POSTGRES_DATABASE="${POSTGRES_DATABASE:-${POSTGRES_DB:-enterpriseglue}}"
export E2E_API_BASE_URL="$api_url"
export E2E_SEED_USER=true
export E2E_DIRECT_DB_CLEANUP=true
export ENGINE_TENANCY_LOCAL_EVIDENCE=true
export ENGINE_TENANCY_PROVISIONING_EVIDENCE=true
export CAMUNDA_MOCK_CONTROL_URL="$mock_control_url"
export PLAYWRIGHT_BASE_URL="$base_url"
export PLAYWRIGHT_LOCAL_CA_FILE="$ca_file"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true
export PLAYWRIGHT_WORKERS=1
export PLAYWRIGHT_BROWSERS=chromium

rm -f test/results/engine-tenancy-provisioning-observations/*.json
pnpm exec playwright test test/e2e/engine-tenancy-provisioning-journeys.spec.ts \
  --config test/e2e/playwright.config.ts
node --test scripts/engine-tenancy-provisioning-journeys.test.mjs
if [[ "${PROVISIONING_ALLOW_DIRTY:-false}" == "true" ]]; then
  node scripts/write-engine-tenancy-provisioning-evidence.mjs --allow-dirty || true
else
  node scripts/write-engine-tenancy-provisioning-evidence.mjs
fi
