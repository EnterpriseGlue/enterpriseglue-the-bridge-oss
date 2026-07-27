#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="eg-plugin-spanner-${$}"
SPANNER_IMAGE="${ENTERPRISEGLUE_PLUGIN_TEST_SPANNER_IMAGE:-gcr.io/cloud-spanner-emulator/emulator@sha256:34bd3a614f89422bdade0c10e1f4a29832c02c13f48ea83abf578e302143bf6e}"
EXTERNAL="${ENTERPRISEGLUE_PLUGIN_TEST_SPANNER_EXTERNAL:-false}"
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
  echo "ENTERPRISEGLUE_PLUGIN_TEST_SPANNER_EXTERNAL must be true or false" >&2
  exit 1
fi

SPANNER_PROJECT_ID="${SPANNER_PROJECT_ID:-test-project}"
SPANNER_INSTANCE_ID="${SPANNER_INSTANCE_ID:-plugin-test-${$}}"
SPANNER_DATABASE_ID="${SPANNER_DATABASE_ID:-plugin-test-${$}}"
SPANNER_CREATE_DATABASE="${SPANNER_CREATE_DATABASE:-false}"
SPANNER_RUN_DATABASE_DRILLS="${ENTERPRISEGLUE_PLUGIN_TEST_SPANNER_RUN_DATABASE_DRILLS:-}"

if [[ "$EXTERNAL" == "false" ]]; then
  command -v docker >/dev/null 2>&1 || {
    echo "docker is required for the plugin Spanner drill" >&2
    exit 1
  }
  docker run --rm -d \
    --name "$CONTAINER_NAME" \
    -p 127.0.0.1::9010 \
    "$SPANNER_IMAGE" >/dev/null
  STARTED_CONTAINER=true

  ready=false
  for _attempt in {1..120}; do
    container_logs="$(docker logs "$CONTAINER_NAME" 2>&1 || true)"
    if grep -q 'Cloud Spanner Emulator running' <<<"$container_logs"; then
      ready=true
      break
    fi
    if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" != "true" ]]; then
      echo "disposable Spanner emulator exited before readiness" >&2
      exit 1
    fi
    sleep 1
  done
  if [[ "$ready" != "true" ]]; then
    echo "disposable Spanner emulator did not become ready" >&2
    exit 1
  fi
  SPANNER_GRPC_PORT="$(
    docker port "$CONTAINER_NAME" 9010/tcp |
      awk -F: 'NR == 1 { print $NF }'
  )"
  SPANNER_EMULATOR_HOST="127.0.0.1:${SPANNER_GRPC_PORT}"
  SPANNER_CREATE_DATABASE=true
  SPANNER_RUN_DATABASE_DRILLS="${SPANNER_RUN_DATABASE_DRILLS:-true}"
else
  SPANNER_RUN_DATABASE_DRILLS="${SPANNER_RUN_DATABASE_DRILLS:-false}"
fi

if [[ "$SPANNER_CREATE_DATABASE" != "true" && "$SPANNER_CREATE_DATABASE" != "false" ]]; then
  echo "SPANNER_CREATE_DATABASE must be true or false" >&2
  exit 1
fi
if [[ -z "${SPANNER_EMULATOR_HOST:-}" && "$SPANNER_CREATE_DATABASE" == "true" ]]; then
  echo "SPANNER_CREATE_DATABASE=true is reserved for the emulator drill" >&2
  exit 1
fi
if [[ "$SPANNER_RUN_DATABASE_DRILLS" != "true" && "$SPANNER_RUN_DATABASE_DRILLS" != "false" ]]; then
  echo "ENTERPRISEGLUE_PLUGIN_TEST_SPANNER_RUN_DATABASE_DRILLS must be true or false" >&2
  exit 1
fi

SPANNER_RECOVERY_DATABASE_ID="${SPANNER_RECOVERY_DATABASE_ID:-plugin-restore-${$}}"
SPANNER_LOAD_DATABASE_ID="${SPANNER_LOAD_DATABASE_ID:-plugin-load-${$}}"
SPANNER_ACCEPTANCE_DATABASE_ID="${SPANNER_ACCEPTANCE_DATABASE_ID:-plugin-accept-${$}}"
SOURCE_SPANNER_DATABASE_ID="$SPANNER_DATABASE_ID"
MAIN_RECOVERY_DATABASE_ID="$SPANNER_RECOVERY_DATABASE_ID"
MAIN_LOAD_DATABASE_ID="$SPANNER_LOAD_DATABASE_ID"
MAIN_ACCEPTANCE_DATABASE_ID="$SPANNER_ACCEPTANCE_DATABASE_ID"
if [[ "$SPANNER_RUN_DATABASE_DRILLS" == "false" ]]; then
  MAIN_RECOVERY_DATABASE_ID=""
  MAIN_LOAD_DATABASE_ID=""
  MAIN_ACCEPTANCE_DATABASE_ID=""
fi

cd "$ROOT_DIR"
DATABASE_TYPE=spanner \
SPANNER_PROJECT_ID="$SPANNER_PROJECT_ID" \
SPANNER_INSTANCE_ID="$SPANNER_INSTANCE_ID" \
SPANNER_DATABASE_ID="$SPANNER_DATABASE_ID" \
SPANNER_CREATE_DATABASE="$SPANNER_CREATE_DATABASE" \
SPANNER_EMULATOR_HOST="${SPANNER_EMULATOR_HOST:-}" \
SPANNER_RECOVERY_DATABASE_ID="$MAIN_RECOVERY_DATABASE_ID" \
SPANNER_LOAD_DATABASE_ID="$MAIN_LOAD_DATABASE_ID" \
SPANNER_ACCEPTANCE_DATABASE_ID="$MAIN_ACCEPTANCE_DATABASE_ID" \
node ./scripts/check-plugin-platform-spanner.mjs

if [[ "$SPANNER_RUN_DATABASE_DRILLS" == "true" ]]; then
  DATABASE_TYPE=spanner \
  SPANNER_PROJECT_ID="$SPANNER_PROJECT_ID" \
  SPANNER_INSTANCE_ID="$SPANNER_INSTANCE_ID" \
  SPANNER_SOURCE_DATABASE_ID="$SOURCE_SPANNER_DATABASE_ID" \
  SPANNER_DATABASE_ID="$SPANNER_RECOVERY_DATABASE_ID" \
  SPANNER_EMULATOR_HOST="${SPANNER_EMULATOR_HOST:-}" \
  node ./scripts/check-plugin-platform-spanner-recovery.mjs

  DATABASE_TYPE=spanner \
  SPANNER_PROJECT_ID="$SPANNER_PROJECT_ID" \
  SPANNER_INSTANCE_ID="$SPANNER_INSTANCE_ID" \
  SPANNER_DATABASE_ID="$SPANNER_LOAD_DATABASE_ID" \
  SPANNER_EMULATOR_HOST="${SPANNER_EMULATOR_HOST:-}" \
  node ./scripts/check-plugin-platform-spanner-load.mjs

  DATABASE_TYPE=spanner \
  SPANNER_PROJECT_ID="$SPANNER_PROJECT_ID" \
  SPANNER_INSTANCE_ID="$SPANNER_INSTANCE_ID" \
  SPANNER_DATABASE_ID="$SPANNER_ACCEPTANCE_DATABASE_ID" \
  SPANNER_EMULATOR_HOST="${SPANNER_EMULATOR_HOST:-}" \
  ENTERPRISEGLUE_PLUGIN_ACCEPTANCE_DATABASE_URL="spanner://acceptance" \
  pnpm --filter @enterpriseglue/backend-host exec vitest run \
    test/pluginPlatformMultiReplica.acceptance.test.ts
else
  echo "Skipping Spanner snapshot-copy, load, and multi-replica drills for an unauthorized external database"
fi
