#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="eg-plugin-multi-replica-${$}"
POSTGRES_IMAGE="${ENTERPRISEGLUE_PLUGIN_TEST_POSTGRES_IMAGE:-postgres@sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca}"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || {
  echo "docker is required for the plugin multi-replica acceptance" >&2
  exit 1
}

docker run --rm -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=plugin_acceptance \
  -p 127.0.0.1::5432 \
  "$POSTGRES_IMAGE" >/dev/null

ready=false
for _attempt in {1..30}; do
  if docker exec "$CONTAINER_NAME" \
    pg_isready -U postgres -d plugin_acceptance >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "disposable PostgreSQL did not become ready" >&2
  exit 1
fi

PGPORT="$(
  docker port "$CONTAINER_NAME" 5432/tcp |
    awk -F: 'NR == 1 { print $NF }'
)"
if [[ ! "$PGPORT" =~ ^[0-9]+$ ]]; then
  echo "could not determine disposable PostgreSQL port" >&2
  exit 1
fi

cd "$ROOT_DIR"
ENTERPRISEGLUE_PLUGIN_ACCEPTANCE_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PGPORT}/plugin_acceptance" \
  pnpm --filter @enterpriseglue/backend-host exec vitest run \
  test/pluginPlatformMultiReplica.acceptance.test.ts
