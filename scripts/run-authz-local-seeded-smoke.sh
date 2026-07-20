#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${PLAYWRIGHT_BASE_URL:-http://localhost:5173}"
api_base_url="${E2E_API_BASE_URL:-http://localhost:8787}"
backend_env_file="${EG_BACKEND_ENV_FILE:-.env.docker}"
local_ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-}"
compose_file="infra/docker/compose/docker-compose.yml"

is_local_url() {
  node --input-type=module - "$1" <<'NODE'
const value = process.argv[2];
try {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.local');
  process.exit(local ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

if [[ ! -f "$backend_env_file" ]]; then
  echo "[authz-local-seeded-smoke] Backend environment file not found: $backend_env_file" >&2
  exit 2
fi
if [[ ! -f "$compose_file" ]]; then
  echo "[authz-local-seeded-smoke] Compose file not found: $compose_file" >&2
  exit 2
fi
if ! is_local_url "$base_url" || ! is_local_url "$api_base_url"; then
  echo "[authz-local-seeded-smoke] PLAYWRIGHT_BASE_URL and E2E_API_BASE_URL must target localhost, loopback, or a .local host." >&2
  exit 2
fi

set -a
. "$backend_env_file"
set +a
for required in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DATABASE; do
  if [[ -z "${!required:-}" ]]; then
    echo "[authz-local-seeded-smoke] $required is required in $backend_env_file." >&2
    exit 2
  fi
done

db_endpoint="$(docker compose --project-directory . --env-file "$backend_env_file" -f "$compose_file" port db 5432 | sed -n '1p')"
if [[ -z "$db_endpoint" ]]; then
  echo "[authz-local-seeded-smoke] The local Compose database is not running. Start the local stack first." >&2
  exit 2
fi
db_port="${db_endpoint##*:}"
if [[ ! "$db_port" =~ ^[0-9]+$ ]]; then
  echo "[authz-local-seeded-smoke] Could not determine the local database port." >&2
  exit 2
fi

curl_args=(--fail --silent --show-error --max-time 5)
if [[ -n "$local_ca_file" ]]; then
  if [[ ! -f "$local_ca_file" ]]; then
    echo "[authz-local-seeded-smoke] PLAYWRIGHT_LOCAL_CA_FILE does not exist: $local_ca_file" >&2
    exit 2
  fi
  curl_args+=(--cacert "$local_ca_file")
fi

if ! curl --fail --silent --show-error --max-time 5 "$api_base_url/ready" >/dev/null; then
  echo "[authz-local-seeded-smoke] Backend is not ready at $api_base_url/ready." >&2
  exit 2
fi
if ! curl "${curl_args[@]}" "$base_url/login" >/dev/null; then
  echo "[authz-local-seeded-smoke] Frontend is not reachable at $base_url/login." >&2
  exit 2
fi

seed_dir="$(mktemp -d "${TMPDIR:-/tmp}/enterpriseglue-authz-smoke.XXXXXX")"
cleanup() {
  rm -rf "$seed_dir"
}
trap cleanup EXIT

# The existing Playwright setup creates canonical baseline and administrator
# memberships, and global teardown deletes its disposable local rows again.
playwright_env=(
  E2E_SEED_USER=true \
  E2E_DIRECT_DB_CLEANUP=true \
  E2E_SEED_FILE="$seed_dir/user.json" \
  E2E_API_BASE_URL="$api_base_url" \
  PLAYWRIGHT_BASE_URL="$base_url" \
  POSTGRES_HOST=127.0.0.1 \
  POSTGRES_PORT="$db_port"
)
if [[ -n "$local_ca_file" ]]; then
  playwright_env+=(PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true)
fi

env "${playwright_env[@]}" pnpm exec playwright test \
  test/e2e/smoke/login.spec.ts \
  test/e2e/smoke/access-control-local.spec.ts \
  test/e2e/smoke/fine-grained-access-local.spec.ts \
  --config test/e2e/playwright.config.ts
