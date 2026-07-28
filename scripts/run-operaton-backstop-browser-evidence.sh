#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_url="${PLAYWRIGHT_BASE_URL:-http://localhost:5173}"
api_url="${E2E_API_BASE_URL:-http://localhost:8787}"
backend_env_file="${EG_BACKEND_ENV_FILE:-$repo_root/.env.docker}"
compose_file="$repo_root/infra/docker/compose/docker-compose.yml"
backend_expose_file="$repo_root/infra/docker/compose/docker-compose.backend-expose.yml"
compose_overlay="${EG_OPERATON_BACKSTOP_COMPOSE_OVERLAY:-}"
image="${EG_OPERATON_IMAGE:-operaton/operaton@sha256:0843bc2b4cedf1d01fdc965203f8c213c3d63a810d49c43fc141608a6f9bb813}"
container="eg-operaton-backstop-browser-${RANDOM}-${RANDOM}"

is_local_url() {
  node --input-type=module - "$1" <<'NODE'
const url = new URL(process.argv[2]);
process.exit(['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.local') ? 0 : 1);
NODE
}

if [[ ! -f "$backend_env_file" || ! -f "$compose_file" || ! -f "$backend_expose_file" ]] || { [[ -n "$compose_overlay" ]] && [[ ! -f "$compose_overlay" ]]; } || ! is_local_url "$base_url" || ! is_local_url "$api_url"; then
  echo 'Operaton browser evidence requires the local Docker stack and localhost URLs.' >&2
  exit 2
fi
compose_args=(--project-directory "$repo_root" --env-file "$backend_env_file" -f "$compose_file" -f "$backend_expose_file")
if [[ -n "$compose_overlay" ]]; then compose_args+=(-f "$compose_overlay"); fi
# The default development Compose profile intentionally keeps the API private
# to the Docker network.  Playwright's local seed and cleanup hooks need the
# loopback API, so add the repository's explicitly local-only port overlay.
# This does not change the production compose definition or the frontend's
# internal API routing.
docker compose "${compose_args[@]}" up --detach backend >/dev/null
for _ in {1..90}; do
  if curl --fail --silent --max-time 2 "$api_url/ready" >/dev/null \
    && curl --fail --silent --max-time 2 "$base_url/login" >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --fail --silent --show-error --max-time 5 "$api_url/ready" >/dev/null || ! curl --fail --silent --show-error --max-time 5 "$base_url/login" >/dev/null; then
  echo 'The local EnterpriseGlue frontend or backend is not ready.' >&2
  exit 2
fi

cleanup() {
  local status=$?
  docker rm --force "$container" >/dev/null 2>&1 || true
  # Remove the test-only secret injection so a developer's local backend is
  # returned to its ordinary Compose definition after this opt-in rehearsal.
  if [[ -n "$compose_overlay" ]]; then
    docker compose --project-directory "$repo_root" --env-file "$backend_env_file" \
      -f "$compose_file" -f "$backend_expose_file" up --detach --force-recreate backend >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap cleanup EXIT
docker run --detach --rm --name "$container" --publish '127.0.0.1::8080' "$image" >/dev/null
port="$(docker port "$container" 8080/tcp | sed -n '1s/.*://p')"
for _ in {1..90}; do curl --fail --silent --max-time 2 "http://127.0.0.1:${port}/engine-rest/engine" >/dev/null && break; sleep 1; done
curl --fail --silent --max-time 2 "http://127.0.0.1:${port}/engine-rest/engine" >/dev/null

set -a
. "$backend_env_file"
set +a
db_endpoint="$(docker compose "${compose_args[@]}" port db 5432 | sed -n '1p')"
test -n "$db_endpoint"
export POSTGRES_HOST=127.0.0.1 POSTGRES_PORT="${db_endpoint##*:}"
export E2E_SEED_USER=true E2E_DIRECT_DB_CLEANUP=true E2E_API_BASE_URL="$api_url"
export PLAYWRIGHT_BASE_URL="$base_url" PLAYWRIGHT_BROWSERS=chromium PLAYWRIGHT_WORKERS=1
# Retain the panel screenshot attachment for local visual review. The test
# result directory is ignored and never becomes product source or release data.
export ENGINE_TENANCY_LOCAL_EVIDENCE=true
evidence_dir="$repo_root/.artifacts/operaton-backstop-browser"
mkdir -p "$evidence_dir"
export OPERATON_BACKSTOP_SCREENSHOT_PATH="$evidence_dir/operaton-backstop-direct-$(date +%Y%m%dT%H%M%S).png"
export OPERATON_BACKSTOP_BROWSER_EVIDENCE=true
# Restart after apply and before drift. This proves a fresh backend process
# reloads the persisted narrow engine connection rather than relying on the
# preview/apply process-memory cache.
export OPERATON_BACKSTOP_RESTART_BACKEND=true
# The backend is in Docker and must address the host-published ephemeral
# Operaton port through its host gateway; direct browser checks stay loopback.
export OPERATON_BACKSTOP_ENGINE_URL="http://host.docker.internal:${port}/engine-rest"
export OPERATON_BACKSTOP_DIRECT_URL="http://127.0.0.1:${port}/engine-rest"
pnpm exec playwright test "${EG_OPERATON_BACKSTOP_PLAYWRIGHT_SPEC:-test/e2e/operaton-backstop-browser.spec.ts}" --config test/e2e/playwright.config.ts
