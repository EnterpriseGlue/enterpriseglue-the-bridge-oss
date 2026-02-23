#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_DIR="infra/docker/compose"
DEFAULT_ENV_FILE="$ROOT_DIR/.local/docker/env/images.oracle.env"
LEGACY_ENV_FILE="$ROOT_DIR/.env.images.oracle"
ENV_FILE="${EG_ORACLE_IMAGE_ENV_FILE:-$DEFAULT_ENV_FILE}"
if [[ "$ENV_FILE" == "$DEFAULT_ENV_FILE" && ! -f "$ENV_FILE" && -f "$LEGACY_ENV_FILE" ]]; then
  ENV_FILE="$LEGACY_ENV_FILE"
fi
WAIT_SECONDS=360
FRONTEND_PORT=""

log() { echo "[e2e-oracle] $*"; }

wait_for_container_health() {
  local container_name="$1"
  local timeout="$2"
  local elapsed=0
  while true; do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || echo missing)"
    if [[ "$status" == "healthy" ]]; then
      return
    fi
    if [[ "$status" == "unhealthy" ]]; then
      log "Container $container_name reported unhealthy; waiting for recovery"
    fi
    sleep 3
    elapsed=$((elapsed + 3))
    if (( elapsed >= timeout )); then
      EG_BACKEND_ENV_FILE="$ENV_FILE" docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.oracle.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" ps || true
      EG_BACKEND_ENV_FILE="$ENV_FILE" docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.oracle.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" logs backend --tail=150 || true
      error "Timed out waiting for $container_name to become healthy"
    fi
  done
}
error() { echo "[e2e-oracle] ERROR: $*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

require_file() {
  [[ -f "$1" ]] || error "Missing required file: $1"
}

is_port_busy() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

choose_port() {
  for port in 8080 18080 28080; do
    if ! is_port_busy "$port"; then
      printf '%s' "$port"
      return
    fi
  done
  error "No free frontend port among 8080/18080/28080"
}

env_get() {
  local key="$1"
  awk -F '=' -v k="$key" '$1 == k { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE"
}

wait_for_http() {
  local url="$1"
  local timeout="$2"
  local elapsed=0
  while ! curl -fsS "$url" >/dev/null 2>&1; do
    sleep 2
    elapsed=$((elapsed + 2))
    if (( elapsed >= timeout )); then
      error "Timed out waiting for $url"
    fi
  done
}

cleanup() {
  set +e
  FRONTEND_HOST_PORT="$FRONTEND_PORT" FRONTEND_URL="http://localhost:$FRONTEND_PORT" EG_BACKEND_ENV_FILE="$ENV_FILE" \
    docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.oracle.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" down -v >/dev/null 2>&1
}
trap cleanup EXIT

main() {
  require_cmd docker
  require_cmd curl
  require_cmd lsof
  require_cmd npm
  require_file "$ENV_FILE"

  FRONTEND_PORT="$(choose_port)"

  local admin_email admin_password
  admin_email="$(env_get ADMIN_EMAIL)"
  admin_password="$(env_get ADMIN_PASSWORD)"
  [[ -n "$admin_email" ]] || error "ADMIN_EMAIL missing in $ENV_FILE"
  [[ -n "$admin_password" ]] || error "ADMIN_PASSWORD missing in $ENV_FILE"

  cd "$ROOT_DIR"

  log "Starting Oracle db/backend services"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" FRONTEND_URL="http://localhost:$FRONTEND_PORT" EG_BACKEND_ENV_FILE="$ENV_FILE" \
    docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.oracle.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" up -d db backend

  wait_for_container_health "enterpriseglue-the-bridge-oss-db-1" "$WAIT_SECONDS"
  wait_for_container_health "enterpriseglue-the-bridge-oss-backend-1" "$WAIT_SECONDS"

  log "Starting frontend service"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" FRONTEND_URL="http://localhost:$FRONTEND_PORT" EG_BACKEND_ENV_FILE="$ENV_FILE" \
    docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.oracle.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" up -d frontend

  wait_for_http "http://localhost:$FRONTEND_PORT/health" "$WAIT_SECONDS"
  wait_for_http "http://localhost:$FRONTEND_PORT/login" "$WAIT_SECONDS"

  log "Running Playwright smoke tests against Oracle containers"
  PLAYWRIGHT_BASE_URL="http://localhost:$FRONTEND_PORT" \
  E2E_API_BASE_URL="http://localhost:$FRONTEND_PORT" \
  E2E_SEED_USER=false \
  E2E_USER="$admin_email" \
  E2E_PASSWORD="$admin_password" \
  npm run test:e2e:smoke

  log "Oracle container E2E smoke tests passed"
}

main "$@"
