#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_env_file="${EG_BACKEND_ENV_FILE:-.env.docker}"
base_url="${PLAYWRIGHT_BASE_URL:-https://localhost:5443}"
api_base_url="${E2E_API_BASE_URL:-http://localhost:8787}"
# This digest is the immutable image used for the browser lane. Do not accept a
# mutable image override for a runner that receives disposable database access.
container_image="mcr.microsoft.com/playwright@sha256:8a0360d39d1973be506dd59002904a774f6d697d4946c94063b3fd006461c8ff"
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

set -a
# shellcheck disable=SC1090
source "$backend_env_file"
set +a
for required in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DATABASE; do
  if [[ -z "${!required:-}" ]]; then
    echo "[authz-webkit-container] $required is required in $backend_env_file." >&2
    exit 2
  fi
done

compose=(docker compose --project-directory "$repo_root" --env-file "$backend_env_file" \
  -f "$repo_root/infra/docker/compose/docker-compose.yml" \
  -f "$repo_root/infra/docker/compose/docker-compose.e2e-mission-control.yml")

service_container() {
  "${compose[@]}" ps -q "$1" | sed -n '1p'
}

mock_container="$(service_container camunda-mock)"
db_container="$(service_container db)"
backend_container="$(service_container backend)"
frontend_container="$(service_container frontend)"
if [[ -z "$mock_container" || -z "$db_container" || -z "$backend_container" || -z "$frontend_container" ]]; then
  echo "[authz-webkit-container] The local backend, frontend, database, and Camunda mock must be running." >&2
  exit 2
fi

compose_project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$mock_container")"
frontend_tls_container="$(docker ps -q \
  --filter "label=com.docker.compose.project=$compose_project" \
  --filter 'label=com.docker.compose.service=frontend-tls' | sed -n '1p')"
if [[ -z "$frontend_tls_container" ]]; then
  echo "[authz-webkit-container] The local TLS frontend must be running for the isolated browser fallback." >&2
  exit 2
fi

runner_network="eg-authz-playwright-${RANDOM}-${RANDOM}"
isolated_containers=()
cleanup() {
  local container
  for container in "${isolated_containers[@]}"; do
    docker network disconnect "$runner_network" "$container" >/dev/null 2>&1 || true
  done
  docker network rm "$runner_network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create --internal "$runner_network" >/dev/null
attach_local_service() {
  local container="$1"
  local alias="$2"
  docker network connect --alias "$alias" "$runner_network" "$container"
  isolated_containers+=("$container")
}
attach_local_service "$db_container" db
attach_local_service "$backend_container" backend
attach_local_service "$frontend_container" frontend
attach_local_service "$frontend_tls_container" frontend-tls
attach_local_service "$mock_container" camunda-mock

# Corepack has no bundled pnpm binary in the image. Prime the immutable
# lockfile dependencies without forwarding the environment file, mounting the
# source read-only, or attaching to the application network. The test container
# below is always egress-isolated and runs offline from these named volumes.
linux_volumes=(
  -v eg_playwright_linux_root_node_modules:/work/node_modules
  -v eg_playwright_linux_backend_node_modules:/work/backend/node_modules
  -v eg_playwright_linux_frontend_node_modules:/work/frontend/node_modules
  -v eg_playwright_linux_backend_host_node_modules:/work/packages/backend-host/node_modules
  -v eg_playwright_linux_frontend_host_node_modules:/work/packages/frontend-host/node_modules
  -v eg_playwright_linux_shared_node_modules:/work/packages/shared/node_modules
  -v eg_playwright_linux_pnpm_store:/root/.local/share/pnpm/store
  -v eg_playwright_linux_corepack:/root/.cache/node/corepack
)
if ! docker run --rm --network none \
  -e COREPACK_HOME=/root/.cache/node/corepack \
  -v "$repo_root:/work:ro" \
  -v eg_playwright_linux_corepack:/root/.cache/node/corepack \
  -w /work \
  "$container_image" bash -lc 'corepack pnpm --version >/dev/null' >/dev/null 2>&1; then
  echo "[authz-webkit-container] Priming pinned Linux test dependencies without application credentials."
  docker run --rm --init \
    --network bridge \
    -e COREPACK_HOME=/root/.cache/node/corepack \
    -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    -v "$repo_root:/work:ro" \
    "${linux_volumes[@]}" \
    -w /work \
    "$container_image" \
    bash -lc 'corepack pnpm install --frozen-lockfile --prefer-offline >/dev/null'
fi

container_base_url="https://frontend-tls"
container_api_url="https://frontend-tls"

docker run --rm --init \
  --network "$runner_network" \
  -e COREPACK_HOME=/root/.cache/node/corepack \
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
  -e E2E_LOCAL_COMPOSE_NETWORK=true \
  -e POSTGRES_HOST=db \
  -e POSTGRES_PORT=5432 \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DATABASE="$POSTGRES_DATABASE" \
  -e POSTGRES_SCHEMA="${POSTGRES_SCHEMA:-main}" \
  -e POSTGRES_SSL="${POSTGRES_SSL:-false}" \
  -v "$repo_root:/work" \
  "${linux_volumes[@]}" \
  -w /work \
  "$container_image" \
  bash -lc 'corepack pnpm install --frozen-lockfile --offline >/dev/null && case "$PLAYWRIGHT_CONTAINER_SUITE" in seeded-smoke) seed_dir="$(mktemp -d /tmp/enterpriseglue-authz-webkit.XXXXXX)"; trap "rm -rf \"$seed_dir\"" EXIT; E2E_SEED_FILE="$seed_dir/user.json" corepack pnpm exec playwright test test/e2e/smoke/login.spec.ts test/e2e/smoke/access-control-local.spec.ts test/e2e/smoke/fine-grained-access-local.spec.ts --config test/e2e/playwright.config.ts ;; accessibility) E2E_SEED_USER=false E2E_DIRECT_DB_CLEANUP=false corepack pnpm exec playwright test test/e2e/access-control-accessibility.spec.ts --config test/e2e/playwright.config.ts ;; esac'
