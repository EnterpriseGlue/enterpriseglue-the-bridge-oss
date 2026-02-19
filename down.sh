#!/bin/bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ENV_FILE="$SCRIPT_DIR/.env.docker"

is_truthy() {
  local VALUE
  VALUE="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$VALUE" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

EXPOSE_BACKEND="${EXPOSE_BACKEND:-true}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

COMPOSE_ARGS=( -f docker-compose.yml )
if [[ "${EG_COMPOSE_CI:-}" != "1" ]] && is_truthy "${EXPOSE_BACKEND:-true}"; then
  COMPOSE_ARGS+=( -f docker-compose.backend-expose.yml )
fi
if [[ "${EG_COMPOSE_CI:-}" == "1" ]]; then
  COMPOSE_ARGS+=( -f docker-compose.ci.yml )
fi

cd "$SCRIPT_DIR"

if [[ -f "$ENV_FILE" ]]; then
  exec docker compose --env-file .env.docker "${COMPOSE_ARGS[@]}" down "$@"
fi

exec docker compose "${COMPOSE_ARGS[@]}" down "$@"
