#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="eg-plugin-oracle-${$}"
ORACLE_IMAGE="${ENTERPRISEGLUE_PLUGIN_TEST_ORACLE_IMAGE:-gvenzl/oracle-xe@sha256:f82bccdf6020d27373fdf0e93046b63eb3f777a0289e329d9839feebaf4555de}"
EXTERNAL="${ENTERPRISEGLUE_PLUGIN_TEST_ORACLE_EXTERNAL:-false}"
STARTED_CONTAINER=false

cleanup() {
  status=$?
  if [[ "$STARTED_CONTAINER" == "true" ]]; then
    if [[ "$status" -ne 0 ]]; then
      docker logs --tail 160 "$CONTAINER_NAME" >&2 || true
    fi
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap cleanup EXIT

if [[ "$EXTERNAL" != "true" && "$EXTERNAL" != "false" ]]; then
  echo "ENTERPRISEGLUE_PLUGIN_TEST_ORACLE_EXTERNAL must be true or false" >&2
  exit 1
fi

ORACLE_HOST="${ORACLE_HOST:-127.0.0.1}"
ORACLE_PORT="${ORACLE_PORT:-1521}"
ORACLE_USER="${ORACLE_USER:-main}"
ORACLE_PASSWORD="${ORACLE_PASSWORD:-OraclePass123}"
ORACLE_SERVICE_NAME="${ORACLE_SERVICE_NAME:-XEPDB1}"
ORACLE_SCHEMA="${ORACLE_SCHEMA:-MAIN}"
ACCEPTANCE_ORACLE_USER="${ENTERPRISEGLUE_PLUGIN_TEST_ORACLE_ACCEPTANCE_USER:-}"
ACCEPTANCE_ORACLE_PASSWORD="${ENTERPRISEGLUE_PLUGIN_TEST_ORACLE_ACCEPTANCE_PASSWORD:-}"
ORACLE_ADMIN_CONTAINER="${ENTERPRISEGLUE_PLUGIN_TEST_ORACLE_CONTAINER:-}"
ORACLE_ADMIN_PASSWORD="${ENTERPRISEGLUE_PLUGIN_TEST_ORACLE_ADMIN_PASSWORD:-}"
ORACLE_RUN_DATABASE_DRILLS="${ENTERPRISEGLUE_PLUGIN_TEST_ORACLE_RUN_DATABASE_DRILLS:-}"

if [[ "$EXTERNAL" == "false" ]]; then
  ORACLE_RUN_DATABASE_DRILLS="${ORACLE_RUN_DATABASE_DRILLS:-true}"
  ORACLE_ADMIN_PASSWORD="${ORACLE_ADMIN_PASSWORD:-$ORACLE_PASSWORD}"
  command -v docker >/dev/null 2>&1 || {
    echo "docker is required for the plugin Oracle drill" >&2
    exit 1
  }
  docker run --rm -d \
    --name "$CONTAINER_NAME" \
    -e ORACLE_PASSWORD="$ORACLE_PASSWORD" \
    -e APP_USER="$ORACLE_USER" \
    -e APP_USER_PASSWORD="$ORACLE_PASSWORD" \
    -p 127.0.0.1::1521 \
    "$ORACLE_IMAGE" >/dev/null
  STARTED_CONTAINER=true
  ORACLE_ADMIN_CONTAINER="$CONTAINER_NAME"

  ready=false
  for _attempt in {1..150}; do
    container_logs="$(docker logs "$CONTAINER_NAME" 2>&1 || true)"
    if grep -q 'DATABASE IS READY TO USE' <<<"$container_logs"; then
      ready=true
      break
    fi
    sleep 2
  done
  if [[ "$ready" != "true" ]]; then
    echo "disposable Oracle did not become ready" >&2
    exit 1
  fi
  ORACLE_PORT="$(
    docker port "$CONTAINER_NAME" 1521/tcp |
      awk -F: 'NR == 1 { print $NF }'
  )"
else
  ORACLE_RUN_DATABASE_DRILLS="${ORACLE_RUN_DATABASE_DRILLS:-false}"
fi

if [[ ! "$ORACLE_PORT" =~ ^[0-9]+$ ]]; then
  echo "Oracle port must be numeric" >&2
  exit 1
fi
if [[ "$ORACLE_RUN_DATABASE_DRILLS" != "true" && "$ORACLE_RUN_DATABASE_DRILLS" != "false" ]]; then
  echo "ENTERPRISEGLUE_PLUGIN_TEST_ORACLE_RUN_DATABASE_DRILLS must be true or false" >&2
  exit 1
fi
if [[ ! "$ORACLE_SERVICE_NAME" =~ ^[A-Za-z][A-Za-z0-9_]{0,127}$ ]]; then
  echo "Oracle service/PDB name is not a safe identifier" >&2
  exit 1
fi
if [[ ! "$ORACLE_SCHEMA" =~ ^[A-Za-z][A-Za-z0-9_]{0,127}$ ]]; then
  echo "Oracle source schema is not a safe identifier" >&2
  exit 1
fi

create_oracle_user() {
  local username="$1"
  local password="$2"
  if [[ ! "$username" =~ ^[A-Za-z][A-Za-z0-9_]{0,127}$ ]]; then
    echo "Oracle fixture user is not a safe identifier" >&2
    return 1
  fi
  docker exec -i "$ORACLE_ADMIN_CONTAINER" sqlplus -s / as sysdba <<SQL
WHENEVER SQLERROR EXIT SQL.SQLCODE
ALTER SESSION SET CONTAINER = ${ORACLE_SERVICE_NAME};
CREATE USER ${username}
  IDENTIFIED BY "${password}"
  DEFAULT TABLESPACE USERS
  QUOTA UNLIMITED ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE TO ${username};
EXIT
SQL
}

run_oracle_data_pump() {
  local executable="$1"
  shift
  printf '%s\n' \
    "system/${ORACLE_ADMIN_PASSWORD}@//localhost:1521/${ORACLE_SERVICE_NAME}" |
    docker exec -i "$ORACLE_ADMIN_CONTAINER" "$executable" "$@"
}

cd "$ROOT_DIR"
DATABASE_TYPE=oracle \
ORACLE_HOST="$ORACLE_HOST" \
ORACLE_PORT="$ORACLE_PORT" \
ORACLE_USER="$ORACLE_USER" \
ORACLE_PASSWORD="$ORACLE_PASSWORD" \
ORACLE_SERVICE_NAME="$ORACLE_SERVICE_NAME" \
ORACLE_SCHEMA="$ORACLE_SCHEMA" \
node ./scripts/check-plugin-platform-oracle.mjs

if [[ "$ORACLE_RUN_DATABASE_DRILLS" == "true" ]]; then
  if [[ -z "$ORACLE_ADMIN_CONTAINER" ]]; then
    echo "Oracle database drills require service-container authority" >&2
    exit 1
  fi
  if [[ -z "$ORACLE_ADMIN_PASSWORD" || ! "$ORACLE_ADMIN_PASSWORD" =~ ^[A-Za-z0-9._!#-]+$ ]]; then
    echo "Oracle database drills require a connection-string-safe admin password" >&2
    exit 1
  fi
  RESTORED_ORACLE_USER="PLUGINREST${$}"
  RESTORED_ORACLE_PASSWORD="PluginRestore123"
  LOAD_ORACLE_USER="PLUGINLOAD${$}"
  LOAD_ORACLE_PASSWORD="PluginLoad123"
  create_oracle_user "$RESTORED_ORACLE_USER" "$RESTORED_ORACLE_PASSWORD"
  create_oracle_user "$LOAD_ORACLE_USER" "$LOAD_ORACLE_PASSWORD"

  ORACLE_DUMP_FILE="eg-plugin-platform-${$}.dmp"
  run_oracle_data_pump expdp \
    "schemas=$ORACLE_SCHEMA" \
    directory=DATA_PUMP_DIR \
    "dumpfile=$ORACLE_DUMP_FILE" \
    "logfile=eg-plugin-platform-export-${$}.log" \
    reuse_dumpfiles=yes \
    exclude=STATISTICS
  run_oracle_data_pump impdp \
    directory=DATA_PUMP_DIR \
    "dumpfile=$ORACLE_DUMP_FILE" \
    "logfile=eg-plugin-platform-import-${$}.log" \
    "remap_schema=${ORACLE_SCHEMA}:${RESTORED_ORACLE_USER}" \
    exclude=USER \
    exclude=GRANT \
    exclude=SYSTEM_GRANT \
    exclude=ROLE_GRANT \
    exclude=DEFAULT_ROLE \
    exclude=TABLESPACE_QUOTA \
    exclude=STATISTICS

  DATABASE_TYPE=oracle \
  ORACLE_HOST="$ORACLE_HOST" \
  ORACLE_PORT="$ORACLE_PORT" \
  ORACLE_USER="$RESTORED_ORACLE_USER" \
  ORACLE_PASSWORD="$RESTORED_ORACLE_PASSWORD" \
  ORACLE_SERVICE_NAME="$ORACLE_SERVICE_NAME" \
  ORACLE_SCHEMA="$RESTORED_ORACLE_USER" \
  node ./scripts/check-plugin-platform-oracle-restore.mjs

  DATABASE_TYPE=oracle \
  ORACLE_HOST="$ORACLE_HOST" \
  ORACLE_PORT="$ORACLE_PORT" \
  ORACLE_USER="$LOAD_ORACLE_USER" \
  ORACLE_PASSWORD="$LOAD_ORACLE_PASSWORD" \
  ORACLE_SERVICE_NAME="$ORACLE_SERVICE_NAME" \
  ORACLE_SCHEMA="$LOAD_ORACLE_USER" \
  node ./scripts/check-plugin-platform-oracle-load.mjs
else
  echo "Skipping Oracle Data Pump recovery and load drills for an unauthorized external database"
fi

if [[ -n "$ORACLE_ADMIN_CONTAINER" && -z "$ACCEPTANCE_ORACLE_USER" && -z "$ACCEPTANCE_ORACLE_PASSWORD" ]]; then
  ACCEPTANCE_ORACLE_USER="PLUGINACC${$}"
  ACCEPTANCE_ORACLE_PASSWORD="PluginAccept123"
  create_oracle_user \
    "$ACCEPTANCE_ORACLE_USER" \
    "$ACCEPTANCE_ORACLE_PASSWORD"
fi

if [[ -n "$ACCEPTANCE_ORACLE_USER" || -n "$ACCEPTANCE_ORACLE_PASSWORD" ]]; then
  if [[ -z "$ACCEPTANCE_ORACLE_USER" || -z "$ACCEPTANCE_ORACLE_PASSWORD" ]]; then
    echo "Both Oracle acceptance user and password must be supplied" >&2
    exit 1
  fi
  if [[ ! "$ACCEPTANCE_ORACLE_USER" =~ ^[A-Za-z][A-Za-z0-9_]{0,127}$ ]]; then
    echo "Oracle acceptance user is not a safe identifier" >&2
    exit 1
  fi
  ACCEPTANCE_ORACLE_SCHEMA="$(
    printf '%s' "$ACCEPTANCE_ORACLE_USER" |
      tr '[:lower:]' '[:upper:]'
  )"
  DATABASE_TYPE=oracle \
  ORACLE_HOST="$ORACLE_HOST" \
  ORACLE_PORT="$ORACLE_PORT" \
  ORACLE_USER="$ACCEPTANCE_ORACLE_USER" \
  ORACLE_PASSWORD="$ACCEPTANCE_ORACLE_PASSWORD" \
  ORACLE_SERVICE_NAME="$ORACLE_SERVICE_NAME" \
  ORACLE_SCHEMA="$ACCEPTANCE_ORACLE_SCHEMA" \
  ENTERPRISEGLUE_PLUGIN_ACCEPTANCE_DATABASE_URL="oracle://acceptance" \
  pnpm --filter @enterpriseglue/backend-host exec vitest run \
    test/pluginPlatformMultiReplica.acceptance.test.ts
else
  echo "Skipping Oracle multi-replica acceptance: no isolated acceptance user or service-container authority was supplied"
fi
