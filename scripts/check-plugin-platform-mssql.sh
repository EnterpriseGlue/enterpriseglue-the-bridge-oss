#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="eg-plugin-mssql-${$}"
MSSQL_IMAGE="${ENTERPRISEGLUE_PLUGIN_TEST_MSSQL_IMAGE:-mcr.microsoft.com/mssql/server@sha256:7c29dfbac885ad7519e219c7fe4aee0e67283e21a10e9c252d13b0fbde1866f8}"
EXTERNAL="${ENTERPRISEGLUE_PLUGIN_TEST_MSSQL_EXTERNAL:-false}"
STARTED_CONTAINER=false

cleanup() {
  status=$?
  if [[ "$STARTED_CONTAINER" == "true" ]]; then
    if [[ "$status" -ne 0 ]]; then
      docker logs --tail 180 "$CONTAINER_NAME" >&2 || true
    fi
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap cleanup EXIT

if [[ "$EXTERNAL" != "true" && "$EXTERNAL" != "false" ]]; then
  echo "ENTERPRISEGLUE_PLUGIN_TEST_MSSQL_EXTERNAL must be true or false" >&2
  exit 1
fi

MSSQL_HOST="${MSSQL_HOST:-127.0.0.1}"
MSSQL_PORT="${MSSQL_PORT:-1433}"
MSSQL_USER="${MSSQL_USER:-sa}"
MSSQL_PASSWORD="${MSSQL_PASSWORD:-Str0ngPlugin!Pass123}"
MSSQL_DATABASE="${MSSQL_DATABASE:-}"
MSSQL_SCHEMA="${MSSQL_SCHEMA:-dbo}"
MSSQL_ENCRYPT="${MSSQL_ENCRYPT:-false}"
MSSQL_TRUST_SERVER_CERTIFICATE="${MSSQL_TRUST_SERVER_CERTIFICATE:-true}"
MSSQL_CREATE_DATABASE=false
MSSQL_RUN_DATABASE_DRILLS="${ENTERPRISEGLUE_PLUGIN_TEST_MSSQL_RUN_DATABASE_DRILLS:-}"

if [[ "$EXTERNAL" == "false" ]]; then
  MSSQL_DATABASE="${MSSQL_DATABASE:-plugin_platform_${$}}"
  MSSQL_CREATE_DATABASE=true
  MSSQL_RUN_DATABASE_DRILLS="${MSSQL_RUN_DATABASE_DRILLS:-true}"
  command -v docker >/dev/null 2>&1 || {
    echo "docker is required for the plugin SQL Server drill" >&2
    exit 1
  }
  docker run --rm -d \
    --platform linux/amd64 \
    --name "$CONTAINER_NAME" \
    -e ACCEPT_EULA=Y \
    -e MSSQL_SA_PASSWORD="$MSSQL_PASSWORD" \
    -e MSSQL_PID=Developer \
    -p 127.0.0.1::1433 \
    "$MSSQL_IMAGE" >/dev/null
  STARTED_CONTAINER=true

  ready=false
  for _attempt in {1..150}; do
    container_logs="$(docker logs "$CONTAINER_NAME" 2>&1 || true)"
    if grep -q 'SQL Server is now ready for client connections' \
      <<<"$container_logs"; then
      ready=true
      break
    fi
    if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" != "true" ]]; then
      echo "disposable SQL Server exited before readiness" >&2
      exit 1
    fi
    sleep 2
  done
  if [[ "$ready" != "true" ]]; then
    echo "disposable SQL Server did not become ready" >&2
    exit 1
  fi
  MSSQL_PORT="$(
    docker port "$CONTAINER_NAME" 1433/tcp |
      awk -F: 'NR == 1 { print $NF }'
  )"
else
  MSSQL_DATABASE="${MSSQL_DATABASE:-master}"
  MSSQL_RUN_DATABASE_DRILLS="${MSSQL_RUN_DATABASE_DRILLS:-false}"
fi

if [[ ! "$MSSQL_PORT" =~ ^[0-9]+$ ]]; then
  echo "SQL Server port must be numeric" >&2
  exit 1
fi
if [[ "$MSSQL_RUN_DATABASE_DRILLS" != "true" && "$MSSQL_RUN_DATABASE_DRILLS" != "false" ]]; then
  echo "ENTERPRISEGLUE_PLUGIN_TEST_MSSQL_RUN_DATABASE_DRILLS must be true or false" >&2
  exit 1
fi

cd "$ROOT_DIR"
DATABASE_TYPE=mssql \
MSSQL_HOST="$MSSQL_HOST" \
MSSQL_PORT="$MSSQL_PORT" \
MSSQL_USER="$MSSQL_USER" \
MSSQL_PASSWORD="$MSSQL_PASSWORD" \
MSSQL_DATABASE="$MSSQL_DATABASE" \
MSSQL_SCHEMA="$MSSQL_SCHEMA" \
MSSQL_ENCRYPT="$MSSQL_ENCRYPT" \
MSSQL_TRUST_SERVER_CERTIFICATE="$MSSQL_TRUST_SERVER_CERTIFICATE" \
MSSQL_CREATE_DATABASE="$MSSQL_CREATE_DATABASE" \
node ./scripts/check-plugin-platform-mssql.mjs

if [[ "$MSSQL_RUN_DATABASE_DRILLS" == "true" ]]; then
  RESTORED_MSSQL_DATABASE="plugin_restore_${$}"
  DATABASE_TYPE=mssql \
  MSSQL_HOST="$MSSQL_HOST" \
  MSSQL_PORT="$MSSQL_PORT" \
  MSSQL_USER="$MSSQL_USER" \
  MSSQL_PASSWORD="$MSSQL_PASSWORD" \
  MSSQL_DATABASE="$MSSQL_DATABASE" \
  RESTORED_MSSQL_DATABASE="$RESTORED_MSSQL_DATABASE" \
  MSSQL_SCHEMA="$MSSQL_SCHEMA" \
  MSSQL_ENCRYPT="$MSSQL_ENCRYPT" \
  MSSQL_TRUST_SERVER_CERTIFICATE="$MSSQL_TRUST_SERVER_CERTIFICATE" \
  node ./scripts/check-plugin-platform-mssql-restore.mjs

  MSSQL_LOAD_DATABASE="plugin_load_${$}"
  DATABASE_TYPE=mssql \
  MSSQL_HOST="$MSSQL_HOST" \
  MSSQL_PORT="$MSSQL_PORT" \
  MSSQL_USER="$MSSQL_USER" \
  MSSQL_PASSWORD="$MSSQL_PASSWORD" \
  MSSQL_DATABASE="$MSSQL_LOAD_DATABASE" \
  LOAD_MSSQL_DATABASE="$MSSQL_LOAD_DATABASE" \
  MSSQL_SCHEMA="$MSSQL_SCHEMA" \
  MSSQL_ENCRYPT="$MSSQL_ENCRYPT" \
  MSSQL_TRUST_SERVER_CERTIFICATE="$MSSQL_TRUST_SERVER_CERTIFICATE" \
  node ./scripts/check-plugin-platform-mssql-load.mjs
else
  echo "Skipping SQL Server backup/restore and load drills for an external database"
fi

ACCEPTANCE_MSSQL_SCHEMA="plugin_acceptance_${$}"
DATABASE_TYPE=mssql \
MSSQL_HOST="$MSSQL_HOST" \
MSSQL_PORT="$MSSQL_PORT" \
MSSQL_USER="$MSSQL_USER" \
MSSQL_PASSWORD="$MSSQL_PASSWORD" \
MSSQL_DATABASE="$MSSQL_DATABASE" \
MSSQL_SCHEMA="$ACCEPTANCE_MSSQL_SCHEMA" \
MSSQL_ENCRYPT="$MSSQL_ENCRYPT" \
MSSQL_TRUST_SERVER_CERTIFICATE="$MSSQL_TRUST_SERVER_CERTIFICATE" \
ENTERPRISEGLUE_PLUGIN_ACCEPTANCE_DATABASE_URL="mssql://acceptance" \
pnpm --filter @enterpriseglue/backend-host exec vitest run \
  test/pluginPlatformMultiReplica.acceptance.test.ts
