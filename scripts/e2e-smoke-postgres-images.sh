#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_DIR="infra/docker/compose"
DEFAULT_ENV_FILE="$ROOT_DIR/.local/docker/env/images.postgres.env"
LEGACY_ENV_FILE="$ROOT_DIR/.env.images.postgres"
EXAMPLE_ENV_FILE="$ROOT_DIR/infra/docker/env/examples/images.postgres.env.example"
ENV_FILE="${EG_POSTGRES_IMAGE_ENV_FILE:-$DEFAULT_ENV_FILE}"
WAIT_SECONDS="${EG_WAIT_SECONDS:-240}"
ARTIFACT_DIR="${MISSION_CONTROL_SMOKE_ARTIFACT_DIR:-$ROOT_DIR/test/results/mission-control-image-smoke}"
FRONTEND_PORT=""
POSTGRES_HOST_PORT=""
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-enterpriseglue-the-bridge-oss}"

if [[ "$ENV_FILE" == "$DEFAULT_ENV_FILE" && ! -f "$ENV_FILE" && -f "$LEGACY_ENV_FILE" ]]; then
  ENV_FILE="$LEGACY_ENV_FILE"
fi

if [[ "$ENV_FILE" == "$DEFAULT_ENV_FILE" && ! -f "$ENV_FILE" && ! -f "$LEGACY_ENV_FILE" && -f "$EXAMPLE_ENV_FILE" ]]; then
  ENV_FILE="$EXAMPLE_ENV_FILE"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --project-name)
      COMPOSE_PROJECT_NAME="$2"
      shift 2
      ;;
    *)
      echo "[e2e-postgres-images] ERROR: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

log() { echo "[e2e-postgres-images] $*"; }
error() { echo "[e2e-postgres-images] ERROR: $*" >&2; exit 1; }

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
  for port in "$@"; do
    if ! is_port_busy "$port"; then
      printf '%s' "$port"
      return
    fi
  done
  error "No free port available among: $*"
}

env_get() {
  local key="$1"
  awk -F '=' -v k="$key" '$1 == k { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE"
}

env_first() {
  local value=""
  for key in "$@"; do
    value="$(env_get "$key")"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return
    fi
  done
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

wait_for_container_health() {
  local container_name="$1"
  local timeout="$2"
  local elapsed=0
  while true; do
    local container_health
    container_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || echo missing)"
    if [[ "$container_health" == "healthy" ]]; then
      return
    fi
    if [[ "$container_health" == "unhealthy" || "$container_health" == "exited" || "$container_health" == "dead" || "$container_health" == "missing" ]]; then
      EG_BACKEND_ENV_FILE="$ENV_FILE" CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" docker compose --project-name "$COMPOSE_PROJECT_NAME" --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.e2e-mission-control.yml" ps || true
      EG_BACKEND_ENV_FILE="$ENV_FILE" CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" docker compose --project-name "$COMPOSE_PROJECT_NAME" --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.e2e-mission-control.yml" logs backend --tail=150 || true
      error "Container $container_name did not become healthy (status: $container_health)"
    fi
    sleep 3
    elapsed=$((elapsed + 3))
    if (( elapsed >= timeout )); then
      EG_BACKEND_ENV_FILE="$ENV_FILE" CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" docker compose --project-name "$COMPOSE_PROJECT_NAME" --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.e2e-mission-control.yml" ps || true
      EG_BACKEND_ENV_FILE="$ENV_FILE" CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" docker compose --project-name "$COMPOSE_PROJECT_NAME" --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.e2e-mission-control.yml" logs backend --tail=150 || true
      error "Timed out waiting for $container_name to become healthy"
    fi
  done
}

run_playwright_smoke() {
  if [[ -n "${PLAYWRIGHT_RUNNER_IMAGE:-}" ]]; then
    log "Running Playwright smoke in container image $PLAYWRIGHT_RUNNER_IMAGE"
    docker run --rm \
      --network host \
      --ipc host \
      --user "$(id -u):$(id -g)" \
      -e CI="${CI:-true}" \
      -e HOME=/tmp \
      -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
      -e PLAYWRIGHT_BASE_URL \
      -e E2E_API_BASE_URL \
      -e CAMUNDA_BASE_URL \
      -e POSTGRES_HOST \
      -e POSTGRES_PORT \
      -e POSTGRES_USER \
      -e POSTGRES_PASSWORD \
      -e POSTGRES_DATABASE \
      -e POSTGRES_SCHEMA \
      -e POSTGRES_SSL \
      -e ADMIN_EMAIL \
      -e ADMIN_PASSWORD \
      -e E2E_ADMIN_EMAIL \
      -e E2E_ADMIN_PASSWORD \
      -e E2E_REQUIRE_MISSION_CONTROL_MOCK \
      -v "$ROOT_DIR:/work" \
      -w /work \
      "$PLAYWRIGHT_RUNNER_IMAGE" \
      bash -lc "npm run test:e2e:smoke:mission-control"
  else
    npm run test:e2e:smoke:mission-control
  fi
}

collect_failure_artifacts() {
  mkdir -p "$ARTIFACT_DIR"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" \
  POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" \
  EG_BACKEND_ENV_FILE="$ENV_FILE" \
  CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" \
    docker compose --project-name "$COMPOSE_PROJECT_NAME" --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.e2e-mission-control.yml" ps > "$ARTIFACT_DIR/docker-compose-ps.txt" 2>&1 || true
  for service in backend frontend db camunda-mock; do
    FRONTEND_HOST_PORT="$FRONTEND_PORT" \
    POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" \
    EG_BACKEND_ENV_FILE="$ENV_FILE" \
    CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" \
      docker compose --project-name "$COMPOSE_PROJECT_NAME" --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.e2e-mission-control.yml" logs --no-color --tail=300 "$service" > "$ARTIFACT_DIR/${service}.log" 2>&1 || true
  done
}

cleanup() {
  local exit_code="$1"
  set +e
  if (( exit_code != 0 )); then
    collect_failure_artifacts
  fi
  FRONTEND_HOST_PORT="$FRONTEND_PORT" \
  POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" \
  EG_BACKEND_ENV_FILE="$ENV_FILE" \
  CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" \
    docker compose --project-name "$COMPOSE_PROJECT_NAME" --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.e2e-mission-control.yml" down -v >/dev/null 2>&1
}
trap 'rc=$?; trap - EXIT; cleanup "$rc"; exit "$rc"' EXIT

main() {
  require_cmd docker
  require_cmd curl
  require_cmd lsof
  require_cmd npm
  require_file "$ENV_FILE"

  FRONTEND_PORT="$(choose_port 8080 18080 28080)"
  POSTGRES_HOST_PORT="$(choose_port 55432 65432 75432)"

  local postgres_user postgres_password postgres_database postgres_schema postgres_ssl admin_email admin_password
  postgres_user="$(env_first POSTGRES_USER)"
  postgres_password="$(env_first POSTGRES_PASSWORD)"
  postgres_database="$(env_first POSTGRES_DATABASE POSTGRES_DB)"
  postgres_schema="$(env_first POSTGRES_SCHEMA)"
  postgres_ssl="$(env_first POSTGRES_SSL)"
  admin_email="$(env_first ADMIN_EMAIL)"
  admin_password="$(env_first ADMIN_PASSWORD)"

  [[ -n "$postgres_user" ]] || error "POSTGRES_USER missing in $ENV_FILE"
  [[ -n "$postgres_password" ]] || error "POSTGRES_PASSWORD missing in $ENV_FILE"
  [[ -n "$postgres_database" ]] || error "POSTGRES_DATABASE or POSTGRES_DB missing in $ENV_FILE"
  [[ -n "$postgres_schema" ]] || error "POSTGRES_SCHEMA missing in $ENV_FILE"
  [[ -n "$admin_email" ]] || error "ADMIN_EMAIL missing in $ENV_FILE"
  [[ -n "$admin_password" ]] || error "ADMIN_PASSWORD missing in $ENV_FILE"

  log "Starting Postgres db/backend services with Mission Control mock"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" \
  POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" \
  EG_BACKEND_ENV_FILE="$ENV_FILE" \
  CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" \
    docker compose --project-name "$COMPOSE_PROJECT_NAME" --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.e2e-mission-control.yml" up -d db camunda-mock backend

  wait_for_container_health "${COMPOSE_PROJECT_NAME}-backend-1" "$WAIT_SECONDS"

  log "Starting frontend service"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" \
  POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" \
  EG_BACKEND_ENV_FILE="$ENV_FILE" \
  CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" \
    docker compose --project-name "$COMPOSE_PROJECT_NAME" --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.e2e-mission-control.yml" up -d frontend

  wait_for_http "http://localhost:$FRONTEND_PORT/health" "$WAIT_SECONDS"
  wait_for_http "http://localhost:$FRONTEND_PORT/login" "$WAIT_SECONDS"

  log "Running Mission Control Playwright smoke against Postgres images"
  PLAYWRIGHT_BASE_URL="http://localhost:$FRONTEND_PORT" \
  E2E_API_BASE_URL="http://localhost:$FRONTEND_PORT" \
  CAMUNDA_BASE_URL="http://camunda-mock:9080/engine-rest" \
  POSTGRES_HOST="127.0.0.1" \
  POSTGRES_PORT="$POSTGRES_HOST_PORT" \
  POSTGRES_USER="$postgres_user" \
  POSTGRES_PASSWORD="$postgres_password" \
  POSTGRES_DATABASE="$postgres_database" \
  POSTGRES_SCHEMA="$postgres_schema" \
  POSTGRES_SSL="${postgres_ssl:-false}" \
  ADMIN_EMAIL="$admin_email" \
  ADMIN_PASSWORD="$admin_password" \
  E2E_ADMIN_EMAIL="$admin_email" \
  E2E_ADMIN_PASSWORD="$admin_password" \
  E2E_REQUIRE_MISSION_CONTROL_MOCK=true \
  run_playwright_smoke

  log "Mission Control image smoke tests passed"
}

main "$@"
