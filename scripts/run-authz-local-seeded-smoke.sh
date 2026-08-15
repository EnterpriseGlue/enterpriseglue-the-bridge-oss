#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${PLAYWRIGHT_BASE_URL:-http://localhost:5173}"
api_base_url="${E2E_API_BASE_URL:-http://localhost:8787}"
backend_env_file="${EG_BACKEND_ENV_FILE:-.env.docker}"
local_ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-}"
compose_file="infra/docker/compose/docker-compose.yml"
mission_control_compose_file="infra/docker/compose/docker-compose.e2e-mission-control.yml"

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
if [[ ! -f "$mission_control_compose_file" ]]; then
  echo "[authz-local-seeded-smoke] Mission Control Compose overlay not found: $mission_control_compose_file" >&2
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

# Runtime-resource authorization needs a deterministic engine reachable from
# the backend container. Start only the local mock service; it shares the
# existing Compose network and does not recreate the running backend or DB.
docker compose --project-directory . --env-file "$backend_env_file" \
  -f "$compose_file" -f "$mission_control_compose_file" \
  up -d --wait camunda-mock

curl_args=(--fail --silent --show-error --max-time 5)
if [[ -n "$local_ca_file" ]]; then
  if [[ ! -f "$local_ca_file" ]]; then
    echo "[authz-local-seeded-smoke] PLAYWRIGHT_LOCAL_CA_FILE does not exist: $local_ca_file" >&2
    exit 2
  fi
  curl_args+=(--cacert "$local_ca_file")
fi

if ! curl --fail --silent --show-error --max-time 5 "$api_base_url/ready" >/dev/null \
  && ! curl --fail --silent --show-error --max-time 5 "$api_base_url/health" >/dev/null; then
  echo "[authz-local-seeded-smoke] Backend is not ready at $api_base_url/ready or $api_base_url/health." >&2
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
  E2E_CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" \
  PLAYWRIGHT_BASE_URL="$base_url" \
  POSTGRES_HOST=127.0.0.1 \
  POSTGRES_PORT="$db_port" \
  PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-1}"
)
if [[ -n "$local_ca_file" ]]; then
  playwright_env+=(PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true)
fi

# The fine-grained suites deliberately revoke assignments and group
# memberships. Give each suite its own fixture instead of sharing mutable
# principals across the aggregate smoke run.
smoke_specs=(
  test/e2e/smoke/login.spec.ts
  test/e2e/smoke/access-control-local.spec.ts
  test/e2e/smoke/access-model-pages-local.spec.ts
  test/e2e/smoke/resource-administration-local.spec.ts
  test/e2e/smoke/resource-scope-assignments-local.spec.ts
  test/e2e/smoke/fine-grained-access-local.spec.ts
  test/e2e/smoke/variable-access-control-local.spec.ts
)

for smoke_spec in "${smoke_specs[@]}"; do
  env "${playwright_env[@]}" pnpm exec playwright test "$smoke_spec" \
    --config test/e2e/playwright.config.ts
done
