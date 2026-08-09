#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_DIR="$ROOT_DIR/infra/docker/compose"
MODE="${1:-}"
ACTION="${2:-}"

usage() {
  echo "Usage: $0 <source|images-postgres|images-oracle> <up|down|config> [compose arguments...]" >&2
}

case "$MODE" in
  source)
    ENV_FILE="${EG_DEPLOY_ENV_FILE:-$ROOT_DIR/.local/docker/env/production.env}"
    [[ -n "${EG_DEPLOY_ENV_FILE:-}" || -f "$ENV_FILE" ]] || ENV_FILE="$ROOT_DIR/.env.production"
    COMPOSE_FILES=( -f "$COMPOSE_DIR/docker-compose.prod.yml" )
    DEFAULT_UP_ARGS=( --build )
    ;;
  images-postgres)
    ENV_FILE="${EG_DEPLOY_ENV_FILE:-$ROOT_DIR/.local/docker/env/images.postgres.env}"
    [[ -n "${EG_DEPLOY_ENV_FILE:-}" || -f "$ENV_FILE" ]] || ENV_FILE="$ROOT_DIR/.env.images.postgres"
    COMPOSE_FILES=( -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" )
    DEFAULT_UP_ARGS=( -d )
    ;;
  images-oracle)
    ENV_FILE="${EG_DEPLOY_ENV_FILE:-$ROOT_DIR/.local/docker/env/images.oracle.env}"
    [[ -n "${EG_DEPLOY_ENV_FILE:-}" || -f "$ENV_FILE" ]] || ENV_FILE="$ROOT_DIR/.env.images.oracle"
    COMPOSE_FILES=( -f "$COMPOSE_DIR/docker-compose.prod.yml" -f "$COMPOSE_DIR/docker-compose.oracle.yml" -f "$COMPOSE_DIR/docker-compose.images.yml" )
    DEFAULT_UP_ARGS=( -d )
    ;;
  *)
    usage
    exit 64
    ;;
esac

case "$ACTION" in
  up|down|config) ;;
  *)
    usage
    exit 64
    ;;
esac
shift 2

[[ -f "$ENV_FILE" ]] || { echo "Missing deployment environment file: $ENV_FILE" >&2; exit 1; }

if [[ -n "${EG_CONFIG_BUNDLE_HOST_PATH:-}" ]]; then
  if [[ "$ACTION" == "up" && ! -f "$EG_CONFIG_BUNDLE_HOST_PATH" ]]; then
    echo "EG_CONFIG_BUNDLE_HOST_PATH must reference an existing JSON or ZIP bundle: $EG_CONFIG_BUNDLE_HOST_PATH" >&2
    exit 1
  fi
  COMPOSE_FILES+=( -f "$COMPOSE_DIR/docker-compose.config-bundle.yml" )
fi

export EG_BACKEND_ENV_FILE="$ENV_FILE"
if [[ "$ACTION" == "up" ]]; then
  exec docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" up "${DEFAULT_UP_ARGS[@]}" "$@"
fi
if [[ "$ACTION" == "config" ]]; then
  exec docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" config "$@"
fi
exec docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" down "$@"
