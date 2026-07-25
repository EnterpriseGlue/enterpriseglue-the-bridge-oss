#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${PLAYWRIGHT_BASE_URL:-https://localhost:5443}"
api_url="${CAMUNDA_NATIVE_GRANT_API_URL:-http://localhost:8787}"
mock_control_url="${CAMUNDA_MOCK_CONTROL_URL:-http://localhost:${CAMUNDA_MOCK_HOST_PORT:-59080}}"
ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-.local/docker/keycloak-tls/ca.crt}"
env_file="${CAMUNDA_NATIVE_GRANT_LOCAL_ENV_FILE:-.local/docker/env/docker.env}"

is_local_url() {
  node --input-type=module - "$1" <<'NODE'
const value = process.argv[2];
try {
  const hostname = new URL(value).hostname;
  process.exit(['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local') ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

if ! is_local_url "$base_url" || ! is_local_url "$api_url" || ! is_local_url "$mock_control_url"; then
  echo "[camunda-native-grant-browser] Browser, API, and mock-control URLs must be localhost, loopback, or .local." >&2
  exit 2
fi
for required_file in "$env_file" "$ca_file"; do
  if [[ ! -f "$required_file" ]]; then
    echo "[camunda-native-grant-browser] Required local file does not exist: $required_file" >&2
    exit 2
  fi
done
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "[camunda-native-grant-browser] Release evidence must be run from a clean worktree." >&2
  exit 2
fi
if ! curl --fail --silent --show-error --max-time 5 "$api_url/ready" >/dev/null; then
  echo "[camunda-native-grant-browser] Backend readiness check failed at $api_url/ready." >&2
  exit 2
fi
if ! curl --fail --silent --show-error --max-time 5 "$mock_control_url/health" >/dev/null; then
  echo "[camunda-native-grant-browser] Mock-engine control endpoint is unavailable at $mock_control_url/health." >&2
  exit 2
fi
if ! curl --fail --silent --show-error --max-time 5 --cacert "$ca_file" "$base_url/login" >/dev/null; then
  echo "[camunda-native-grant-browser] TLS frontend is unavailable at $base_url/login." >&2
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
export E2E_CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest"
export E2E_SEED_USER=true
export E2E_DIRECT_DB_CLEANUP=true
export CAMUNDA_NATIVE_GRANT_BROWSER_EVIDENCE=true
export CAMUNDA_MOCK_CONTROL_URL="$mock_control_url"
export PLAYWRIGHT_BASE_URL="$base_url"
export PLAYWRIGHT_LOCAL_CA_FILE="$ca_file"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true
export PLAYWRIGHT_WORKERS=1
export PLAYWRIGHT_BROWSERS=chromium

rm -rf test/results/camunda-native-grant-browser-observations
pnpm exec playwright test test/e2e/camunda-native-grant-migration.spec.ts \
  --config test/e2e/playwright.config.ts
node scripts/write-camunda-native-grant-browser-evidence.mjs
