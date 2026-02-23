#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DEFAULT_ENV_FILE="$SCRIPT_DIR/.env.docker"
SELECTED_DB=""
FORWARD_ARGS=()

is_truthy() {
  local VALUE
  VALUE="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$VALUE" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

normalize_db() {
  local DB
  DB="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$DB" in
    postgres|mysql|mssql|oracle|spanner) echo "$DB" ;;
    *)
      echo "Unsupported --db value: $1" >&2
      exit 1
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)
      [[ $# -lt 2 ]] && { echo "--db requires a value" >&2; exit 1; }
      SELECTED_DB="$(normalize_db "$2")"
      shift 2
      ;;
    --db=*)
      SELECTED_DB="$(normalize_db "${1#*=}")"
      shift
      ;;
    *)
      FORWARD_ARGS+=("$1")
      shift
      ;;
  esac
done

ACTIVE_ENV_FILE="$DEFAULT_ENV_FILE"
# Match env file selection logic from dev.sh so down targets the same DB stack.
if [[ -n "$SELECTED_DB" ]]; then
  ACTIVE_ENV_FILE="$SCRIPT_DIR/.env.docker.$SELECTED_DB"
  TEMPLATE_FILE="$SCRIPT_DIR/.env.docker.$SELECTED_DB.example"
  if [[ ! -f "$ACTIVE_ENV_FILE" && -f "$TEMPLATE_FILE" ]]; then
    cp "$TEMPLATE_FILE" "$ACTIVE_ENV_FILE"
    echo "Created $ACTIVE_ENV_FILE from template."
  fi
elif [[ ! -f "$ACTIVE_ENV_FILE" ]]; then
  FALLBACK_TEMPLATE="$SCRIPT_DIR/.env.docker.postgres.example"
  if [[ -f "$FALLBACK_TEMPLATE" ]]; then
    cp "$FALLBACK_TEMPLATE" "$ACTIVE_ENV_FILE"
    echo "Created $ACTIVE_ENV_FILE from $FALLBACK_TEMPLATE"
  fi
fi

if [[ -f "$ACTIVE_ENV_FILE" ]]; then
  set -a
  source "$ACTIVE_ENV_FILE"
  set +a
fi

if [[ -n "$SELECTED_DB" ]]; then
  DATABASE_TYPE="$SELECTED_DB"
fi

DATABASE_TYPE="${DATABASE_TYPE:-postgres}"
COMPOSE_DIR="infra/docker/compose"

COMPOSE_ARGS=( --project-directory "$SCRIPT_DIR" -f "$COMPOSE_DIR/docker-compose.yml" )
# Add the same DB overlay used at startup to tear down the correct resources.
case "$DATABASE_TYPE" in
  postgres) ;;
  mysql) COMPOSE_ARGS+=( -f "$COMPOSE_DIR/docker-compose.mysql.yml" ) ;;
  mssql) COMPOSE_ARGS+=( -f "$COMPOSE_DIR/docker-compose.mssql.yml" ) ;;
  oracle) COMPOSE_ARGS+=( -f "$COMPOSE_DIR/docker-compose.oracle.yml" ) ;;
  spanner) COMPOSE_ARGS+=( -f "$COMPOSE_DIR/docker-compose.spanner.yml" ) ;;
  *)
    echo "Unsupported DATABASE_TYPE: $DATABASE_TYPE" >&2
    exit 1
    ;;
esac

if [[ "${EG_COMPOSE_CI:-}" != "1" ]] && is_truthy "${EXPOSE_BACKEND:-true}"; then
  COMPOSE_ARGS+=( -f "$COMPOSE_DIR/docker-compose.backend-expose.yml" )
fi
if [[ "${EG_COMPOSE_CI:-}" == "1" ]]; then
  COMPOSE_ARGS+=( -f "$COMPOSE_DIR/docker-compose.ci.yml" )
fi

cd "$SCRIPT_DIR"

if [[ -f "$ACTIVE_ENV_FILE" ]]; then
  EG_BACKEND_ENV_FILE="$ACTIVE_ENV_FILE" \
  EG_FORCE_DATABASE_TYPE="$DATABASE_TYPE" \
  exec docker compose --env-file "$ACTIVE_ENV_FILE" "${COMPOSE_ARGS[@]}" down "${FORWARD_ARGS[@]}"
fi

exec docker compose "${COMPOSE_ARGS[@]}" down "${FORWARD_ARGS[@]}"
