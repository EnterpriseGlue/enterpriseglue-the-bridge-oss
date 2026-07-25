#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_env_file="${EG_BACKEND_ENV_FILE:-.env.docker}"
base_url="${PLAYWRIGHT_BASE_URL:-https://localhost:5443}"
api_base_url="${E2E_API_BASE_URL:-http://localhost:8787}"
db_port="${AUTHZ_LOCAL_POSTGRES_PORT:-}"
container_image="${PLAYWRIGHT_WEBKIT_CONTAINER_IMAGE:-mcr.microsoft.com/playwright:v1.59.1-jammy}"
browser="${PLAYWRIGHT_CONTAINER_BROWSER:-webkit}"
suite="${PLAYWRIGHT_CONTAINER_SUITE:-seeded-smoke}"

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

to_container_url() {
  node --input-type=module - "$1" <<'NODE'
const value = process.argv[2];
const url = new URL(value);
url.hostname = 'enterpriseglue-webkit.local';
console.log(url.toString().replace(/\/$/, ''));
NODE
}

if ! is_local_url "$base_url" || ! is_local_url "$api_base_url"; then
  echo "[authz-webkit-container] Browser and API URLs must target localhost, loopback, or a .local host." >&2
  exit 2
fi

if [[ ! -f "$backend_env_file" ]]; then
  echo "[authz-webkit-container] Backend environment file not found: $backend_env_file" >&2
  exit 2
fi

if [[ "$browser" != "firefox" && "$browser" != "webkit" ]]; then
  echo "[authz-webkit-container] PLAYWRIGHT_CONTAINER_BROWSER must be firefox or webkit." >&2
  exit 2
fi

if [[ "$suite" != "seeded-smoke" && "$suite" != "accessibility" ]]; then
  echo "[authz-webkit-container] PLAYWRIGHT_CONTAINER_SUITE must be seeded-smoke or accessibility." >&2
  exit 2
fi

if [[ -z "$db_port" ]]; then
  db_endpoint="$(docker compose --project-directory "$repo_root" --env-file "$backend_env_file" \
    -f "$repo_root/infra/docker/compose/docker-compose.yml" port db 5432 | sed -n '1p')"
  db_port="${db_endpoint##*:}"
fi
if [[ ! "$db_port" =~ ^[0-9]+$ ]]; then
  echo "[authz-webkit-container] Could not determine the local Compose database port." >&2
  exit 2
fi

mock_container="$(docker compose --project-directory "$repo_root" --env-file "$backend_env_file" \
  -f "$repo_root/infra/docker/compose/docker-compose.yml" \
  -f "$repo_root/infra/docker/compose/docker-compose.e2e-mission-control.yml" \
  ps -q camunda-mock)"
if [[ -z "$mock_container" ]]; then
  echo "[authz-webkit-container] The local Camunda mock is not running." >&2
  exit 2
fi

compose_network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$mock_container" | head -1)"
if [[ -z "$compose_network" ]]; then
  echo "[authz-webkit-container] Could not determine the local Compose network." >&2
  exit 2
fi

container_base_url="$(to_container_url "$base_url")"
container_api_url="$(to_container_url "$api_base_url")"

docker run --rm --init \
  --network "$compose_network" \
  --add-host enterpriseglue-webkit.local:host-gateway \
  --env-file "$backend_env_file" \
  -e CI=true \
  -e IBM_TELEMETRY_DISABLED=true \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PLAYWRIGHT_BROWSERS="$browser" \
  -e PLAYWRIGHT_CONTAINER_SUITE="$suite" \
  -e PLAYWRIGHT_WORKERS=1 \
  -e PLAYWRIGHT_BASE_URL="$container_base_url" \
  -e PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true \
  -e E2E_API_BASE_URL="$container_api_url" \
  -e E2E_CAMUNDA_BASE_URL=http://camunda-mock:9080/engine-rest \
  -e E2E_SEED_USER=true \
  -e E2E_DIRECT_DB_CLEANUP=true \
  -e POSTGRES_HOST=enterpriseglue-webkit.local \
  -e POSTGRES_PORT="$db_port" \
  -v "$repo_root:/work" \
  -v eg_playwright_linux_root_node_modules:/work/node_modules \
  -v eg_playwright_linux_backend_node_modules:/work/backend/node_modules \
  -v eg_playwright_linux_frontend_node_modules:/work/frontend/node_modules \
  -v eg_playwright_linux_backend_host_node_modules:/work/packages/backend-host/node_modules \
  -v eg_playwright_linux_frontend_host_node_modules:/work/packages/frontend-host/node_modules \
  -v eg_playwright_linux_shared_node_modules:/work/packages/shared/node_modules \
  -v eg_playwright_linux_pnpm_store:/root/.local/share/pnpm/store \
  -w /work \
  "$container_image" \
  bash -lc 'corepack pnpm install --frozen-lockfile --prefer-offline >/dev/null && case "$PLAYWRIGHT_CONTAINER_SUITE" in seeded-smoke) seed_dir="$(mktemp -d /tmp/enterpriseglue-authz-webkit.XXXXXX)"; trap "rm -rf \"$seed_dir\"" EXIT; E2E_SEED_FILE="$seed_dir/user.json" corepack pnpm exec playwright test test/e2e/smoke/login.spec.ts test/e2e/smoke/access-control-local.spec.ts test/e2e/smoke/fine-grained-access-local.spec.ts --config test/e2e/playwright.config.ts ;; accessibility) E2E_SEED_USER=false E2E_DIRECT_DB_CLEANUP=false corepack pnpm exec playwright test test/e2e/access-control-accessibility.spec.ts --config test/e2e/playwright.config.ts ;; esac'
