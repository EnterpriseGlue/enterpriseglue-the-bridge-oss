#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_DIR="infra/docker/compose"
POSTGRES_ENV_FILE=".env.images.postgres"
ORACLE_ENV_FILE=".env.images.oracle"
WAIT_SECONDS=360
SKIP_ORACLE=false
SKIP_EXPOSED=false
SKIP_AUTH=false
FORCE_ORACLE=false
CLEANUP_CMDS=""
FRONTEND_PORT=""
BACKEND_PORT=""

log() { echo "[smoke-images] $*"; }

run_auth_flow_smoke() {
  local base_url="$1"
  local env_file="$2"
  local label="$3"
  local admin_email
  local admin_password
  admin_email="$(env_get "$env_file" ADMIN_EMAIL)"
  admin_password="$(env_get "$env_file" ADMIN_PASSWORD)"

  [[ -n "$admin_email" ]] || error "$label auth check requires ADMIN_EMAIL in $env_file"
  [[ -n "$admin_password" ]] || error "$label auth check requires ADMIN_PASSWORD in $env_file"

  local cookie_jar login_body me_body refresh_body csrf_body logout_body me_after_body bad_body
  cookie_jar="$(mktemp)"
  login_body="$(mktemp)"
  me_body="$(mktemp)"
  refresh_body="$(mktemp)"
  csrf_body="$(mktemp)"
  logout_body="$(mktemp)"
  me_after_body="$(mktemp)"
  bad_body="$(mktemp)"
  register_cleanup "rm -f \"$cookie_jar\" \"$login_body\" \"$me_body\" \"$refresh_body\" \"$csrf_body\" \"$logout_body\" \"$me_after_body\" \"$bad_body\""

  local login_status me_status refresh_status csrf_status logout_status me_after_status bad_status csrf_token
  login_status="$(curl -sS -o "$login_body" -w '%{http_code}' -c "$cookie_jar" -H 'Content-Type: application/json' -X POST "$base_url/api/auth/login" -d "{\"email\":\"$admin_email\",\"password\":\"$admin_password\"}")"
  [[ "$login_status" == "200" ]] || error "$label auth login failed (status $login_status)"

  me_status="$(curl -sS -o "$me_body" -w '%{http_code}' -b "$cookie_jar" "$base_url/api/auth/me")"
  [[ "$me_status" == "200" ]] || error "$label auth /me failed (status $me_status)"

  refresh_status="$(curl -sS -o "$refresh_body" -w '%{http_code}' -b "$cookie_jar" -c "$cookie_jar" -X POST "$base_url/api/auth/refresh")"
  [[ "$refresh_status" == "200" ]] || error "$label auth refresh failed (status $refresh_status)"

  csrf_status="$(curl -sS -o "$csrf_body" -w '%{http_code}' -b "$cookie_jar" -c "$cookie_jar" "$base_url/api/csrf-token")"
  [[ "$csrf_status" == "200" ]] || error "$label CSRF token fetch failed (status $csrf_status)"

  csrf_token="$(sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p' "$csrf_body" | head -n 1)"
  [[ -n "$csrf_token" ]] || error "$label CSRF token missing in response"

  logout_status="$(curl -sS -o "$logout_body" -w '%{http_code}' -b "$cookie_jar" -c "$cookie_jar" -H "X-CSRF-Token: $csrf_token" -H 'Content-Type: application/json' -X POST "$base_url/api/auth/logout" -d '{}')"
  [[ "$logout_status" == "200" ]] || error "$label auth logout failed (status $logout_status)"

  me_after_status="$(curl -sS -o "$me_after_body" -w '%{http_code}' -b "$cookie_jar" "$base_url/api/auth/me")"
  [[ "$me_after_status" == "401" ]] || error "$label auth /me after logout expected 401, got $me_after_status"

  bad_status="$(curl -sS -o "$bad_body" -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$base_url/api/auth/login" -d "{\"email\":\"$admin_email\",\"password\":\"wrong-password\"}")"
  [[ "$bad_status" == "401" || "$bad_status" == "423" ]] || error "$label bad-login expected 401/423, got $bad_status"

  log "OK: $label auth flow"
}
error() { echo "[smoke-images] ERROR: $*"; exit 1; }

usage() {
  cat <<'EOF'
Usage: bash ./scripts/smoke-images-local.sh [options]

Options:
  --postgres-env <file>   Env file for postgres image deployment (default: .env.images.postgres)
  --oracle-env <file>     Env file for oracle image deployment (default: .env.images.oracle)
  --wait-seconds <n>      Max wait time per stack health check (default: 360)
  --skip-oracle           Skip oracle image smoke
  --skip-exposed          Skip postgres backend-exposed smoke
  --skip-auth             Skip auth flow checks (login/me/refresh/logout)
  --force-oracle          Force oracle smoke even on arm64 hosts (may require emulation)
  -h, --help              Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --postgres-env)
      POSTGRES_ENV_FILE="$2"
      shift 2
      ;;
    --oracle-env)
      ORACLE_ENV_FILE="$2"
      shift 2
      ;;
    --wait-seconds)
      WAIT_SECONDS="$2"
      shift 2
      ;;
    --skip-oracle)
      SKIP_ORACLE=true
      shift
      ;;
    --skip-exposed)
      SKIP_EXPOSED=true
      shift
      ;;
    --skip-auth)
      SKIP_AUTH=true
      shift
      ;;
    --force-oracle)
      FORCE_ORACLE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      error "Unknown option: $1"
      ;;
  esac
done

[[ "$WAIT_SECONDS" =~ ^[0-9]+$ ]] || error "--wait-seconds must be an integer"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

require_file() {
  [[ -f "$1" ]] || error "Missing required file: $1"
}

env_get() {
  local env_file="$1"
  local key="$2"
  awk -F '=' -v k="$key" '$1 == k { print substr($0, index($0, "=") + 1); exit }' "$env_file"
}

is_port_busy() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

choose_port() {
  local preferred="$1"
  local fallback="$2"
  local fallback2="${3:-}"
  local label="$4"

  if ! is_port_busy "$preferred"; then
    printf '%s' "$preferred"
    return
  fi

  if ! is_port_busy "$fallback"; then
    log "$label port $preferred is in use, using fallback $fallback" >&2
    printf '%s' "$fallback"
    return
  fi

  if [[ -n "$fallback2" ]] && ! is_port_busy "$fallback2"; then
    log "$label ports $preferred and $fallback are in use, using fallback $fallback2" >&2
    printf '%s' "$fallback2"
    return
  fi

  if [[ -n "$fallback2" ]]; then
    error "$label ports $preferred, $fallback, and $fallback2 are all in use"
  fi

  error "$label ports $preferred and $fallback are both in use"
}

register_cleanup() {
  CLEANUP_CMDS="$1
${CLEANUP_CMDS}"
}

run_cleanup() {
  local status=$?
  set +u
  while IFS= read -r cmd; do
    if [[ -n "$cmd" ]]; then
      eval "$cmd"
    fi
  done <<< "${CLEANUP_CMDS:-}"
  exit $status
}

trap run_cleanup EXIT

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

compose_down() {
  local env_file="$1"
  shift
  docker compose --env-file "$env_file" "$@" down -v >/dev/null 2>&1 || true
}

run_postgres_internal() {
  log "Smoke: postgres image deployment (same-origin path)"
  local env_file="$ROOT_DIR/$POSTGRES_ENV_FILE"
  require_file "$env_file"

  register_cleanup "FRONTEND_HOST_PORT=$FRONTEND_PORT FRONTEND_URL=http://localhost:$FRONTEND_PORT docker compose --project-directory \"$ROOT_DIR\" --env-file \"$env_file\" -f $COMPOSE_DIR/docker-compose.prod.yml -f $COMPOSE_DIR/docker-compose.images.yml down -v >/dev/null 2>&1 || true"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" FRONTEND_URL="http://localhost:$FRONTEND_PORT" docker compose --project-directory "$ROOT_DIR" --env-file "$env_file" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" up -d
  wait_for_http "http://localhost:$FRONTEND_PORT/login" "$WAIT_SECONDS"
  wait_for_http "http://localhost:$FRONTEND_PORT/health" "$WAIT_SECONDS"
  if [[ "$SKIP_AUTH" != "true" ]]; then
    run_auth_flow_smoke "http://localhost:$FRONTEND_PORT" "$env_file" "postgres same-origin"
  fi
  log "OK: postgres same-origin image smoke"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" FRONTEND_URL="http://localhost:$FRONTEND_PORT" compose_down "$env_file" --project-directory "$ROOT_DIR" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml"
}

run_postgres_exposed() {
  log "Smoke: postgres image deployment (backend exposed path)"
  local env_file="$ROOT_DIR/$POSTGRES_ENV_FILE"
  require_file "$env_file"
  local tmp_env="$ROOT_DIR/.env.images.postgres.smoke.tmp"

  register_cleanup "rm -f \"$tmp_env\""
  awk '
    BEGIN { updated = 0 }
    /^EXPOSE_BACKEND=/ { print "EXPOSE_BACKEND=true"; updated = 1; next }
    /^BACKEND_HOST_PORT=/ { print "BACKEND_HOST_PORT='"$BACKEND_PORT"'"; next }
    { print }
    END {
      if (!updated) print "EXPOSE_BACKEND=true"
      print "BACKEND_HOST_PORT='"$BACKEND_PORT"'"
    }
  ' "$env_file" > "$tmp_env"

  register_cleanup "FRONTEND_HOST_PORT=$FRONTEND_PORT FRONTEND_URL=http://localhost:$FRONTEND_PORT BACKEND_HOST_PORT=$BACKEND_PORT docker compose --project-directory \"$ROOT_DIR\" --env-file \"$tmp_env\" -f $COMPOSE_DIR/docker-compose.prod.yml -f $COMPOSE_DIR/docker-compose.images.yml -f $COMPOSE_DIR/docker-compose.backend-expose.yml down -v >/dev/null 2>&1 || true"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" FRONTEND_URL="http://localhost:$FRONTEND_PORT" BACKEND_HOST_PORT="$BACKEND_PORT" docker compose --project-directory "$ROOT_DIR" --env-file "$tmp_env" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.backend-expose.yml" up -d
  wait_for_http "http://localhost:$FRONTEND_PORT/health" "$WAIT_SECONDS"
  wait_for_http "http://localhost:$BACKEND_PORT/health" "$WAIT_SECONDS"
  if [[ "$SKIP_AUTH" != "true" ]]; then
    run_auth_flow_smoke "http://localhost:$FRONTEND_PORT" "$tmp_env" "postgres backend-exposed"
    run_auth_flow_smoke "http://localhost:$BACKEND_PORT" "$tmp_env" "postgres backend-direct"
  fi
  log "OK: postgres backend-exposed image smoke"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" FRONTEND_URL="http://localhost:$FRONTEND_PORT" BACKEND_HOST_PORT="$BACKEND_PORT" compose_down "$tmp_env" --project-directory "$ROOT_DIR" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" -f "$COMPOSE_DIR/docker-compose.backend-expose.yml"
  rm -f "$tmp_env"
}

run_oracle_internal() {
  log "Smoke: oracle image deployment (same-origin path)"
  local env_file="$ROOT_DIR/$ORACLE_ENV_FILE"
  require_file "$env_file"

  register_cleanup "FRONTEND_HOST_PORT=$FRONTEND_PORT FRONTEND_URL=http://localhost:$FRONTEND_PORT docker compose --project-directory \"$ROOT_DIR\" --env-file \"$env_file\" -f $COMPOSE_DIR/docker-compose.prod.yml -f $COMPOSE_DIR/docker-compose.oracle.yml -f $COMPOSE_DIR/docker-compose.images.yml down -v >/dev/null 2>&1 || true"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" FRONTEND_URL="http://localhost:$FRONTEND_PORT" docker compose --project-directory "$ROOT_DIR" --env-file "$env_file" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.oracle.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" up -d
  wait_for_http "http://localhost:$FRONTEND_PORT/login" "$WAIT_SECONDS"
  wait_for_http "http://localhost:$FRONTEND_PORT/health" "$WAIT_SECONDS"
  if [[ "$SKIP_AUTH" != "true" ]]; then
    run_auth_flow_smoke "http://localhost:$FRONTEND_PORT" "$env_file" "oracle same-origin"
  fi
  log "OK: oracle same-origin image smoke"
  FRONTEND_HOST_PORT="$FRONTEND_PORT" FRONTEND_URL="http://localhost:$FRONTEND_PORT" compose_down "$env_file" --project-directory "$ROOT_DIR" -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.oracle.yml" -f "$COMPOSE_DIR/docker-compose.images.yml"
}

main() {
  require_cmd docker
  require_cmd curl
  require_cmd lsof

  FRONTEND_PORT="$(choose_port 8080 18080 28080 frontend)"
  BACKEND_PORT="$(choose_port 8787 18787 28787 backend)"

  local_arch="$(uname -m)"
  if [[ "$FORCE_ORACLE" != "true" && ("$local_arch" == "arm64" || "$local_arch" == "aarch64") ]]; then
    if [[ "$SKIP_ORACLE" != "true" ]]; then
      log "Oracle smoke auto-skipped on $local_arch host. Use --force-oracle to run it under emulation."
      SKIP_ORACLE=true
    fi
  fi

  cd "$ROOT_DIR"

  run_postgres_internal
  if [[ "$SKIP_EXPOSED" != "true" ]]; then
    run_postgres_exposed
  fi

  if [[ "$SKIP_ORACLE" != "true" ]]; then
    run_oracle_internal
  fi

  log "All requested image smoke checks passed"
}

main "$@"
