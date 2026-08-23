#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${REFERENCE_PLUGIN_IMAGE_UNDER_TEST:-enterpriseglue/reference-health:local}"
TEMP_DIR="$(mktemp -d)"
CONTAINER_NAME="eg-reference-plugin-check-$$"
VOLUME_NAME="eg-reference-plugin-replay-$$"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to verify the reference plugin image" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to create the synthetic invocation key" >&2
  exit 1
fi

if [[ "${REFERENCE_PLUGIN_SKIP_BUILD:-false}" != "true" ]]; then
  docker build \
    -f "$ROOT_DIR/packages/plugin-reference/Dockerfile" \
    -t "$IMAGE" \
    "$ROOT_DIR"
fi

user="$(docker image inspect "$IMAGE" --format '{{.Config.User}}')"
if [[ "$user" != "65532:65532" ]]; then
  echo "Reference plugin image must run as 65532:65532, got: $user" >&2
  exit 1
fi

openssl genpkey -algorithm ED25519 -out "$TEMP_DIR/private.pem" >/dev/null 2>&1
openssl pkey \
  -in "$TEMP_DIR/private.pem" \
  -pubout \
  -out "$TEMP_DIR/public.pem" >/dev/null 2>&1
docker volume create "$VOLUME_NAME" >/dev/null

start_container() {
  docker run -d \
    --name "$CONTAINER_NAME" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
    --mount "type=bind,src=$TEMP_DIR/public.pem,dst=/run/enterpriseglue/plugin-invocation-public.pem,readonly" \
    --mount "type=volume,src=$VOLUME_NAME,dst=/var/lib/enterpriseglue/reference-health" \
    -e ENTERPRISEGLUE_PLUGIN_INVOCATION_PUBLIC_KEY_FILE=/run/enterpriseglue/plugin-invocation-public.pem \
    -p 127.0.0.1::8080 \
    "$IMAGE" >/dev/null
}

wait_for_health() {
  local port=""
  for _ in $(seq 1 40); do
    port="$(docker port "$CONTAINER_NAME" 8080/tcp 2>/dev/null | awk -F: 'NR == 1 { print $NF }')"
    if [[ -n "$port" ]] && curl -fsS "http://127.0.0.1:$port/_plugin/health" >/dev/null 2>&1; then
      printf '%s' "$port"
      return
    fi
    sleep 0.25
  done
  docker logs "$CONTAINER_NAME" >&2 || true
  echo "Reference plugin did not become healthy" >&2
  exit 1
}

now="$(date +%s)"
token="$(
  node --input-type=module - "$ROOT_DIR" "$TEMP_DIR/private.pem" "$now" <<'NODE'
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const [root, privateKeyPath, nowValue] = process.argv.slice(2);
const { signPluginInvocationV1 } = await import(
  pathToFileURL(`${root}/packages/plugin-runtime/dist/gateway.js`).href
);
const now = Number(nowValue);
const privateKey = await readFile(privateKeyPath);
process.stdout.write(
  signPluginInvocationV1(
    {
      iss: 'enterpriseglue-oss',
      aud: 'io.enterpriseglue.reference-health',
      sub: 'synthetic-image-check',
      iat: now,
      exp: now + 30,
      jti: 'reference-image-restart-replay-0001',
      tenantRef: 'synthetic-tenant',
      deploymentRef: 'synthetic-deployment',
      operationId: 'io.enterpriseglue.reference-health.read-status',
      grantedPermissions: ['host.identity.read_safe'],
      correlationId: 'reference-image-check-0001',
    },
    privateKey,
  ),
);
NODE
)"

invoke_status() {
  local port="$1"
  curl -sS \
    -o "$TEMP_DIR/response.json" \
    -w '%{http_code}' \
    -H "x-enterpriseglue-plugin-invocation: $token" \
    "http://127.0.0.1:$port/v1/status"
}

start_container
first_port="$(wait_for_health)"
if [[ "$(invoke_status "$first_port")" != "200" ]]; then
  cat "$TEMP_DIR/response.json" >&2 || true
  docker logs "$CONTAINER_NAME" >&2 || true
  echo "First signed reference-plugin invocation did not succeed" >&2
  exit 1
fi
if ! grep -Fq '"pluginId":"io.enterpriseglue.reference-health"' "$TEMP_DIR/response.json"; then
  echo "Reference plugin returned an unexpected success body" >&2
  exit 1
fi

docker rm -f "$CONTAINER_NAME" >/dev/null
start_container
second_port="$(wait_for_health)"
if [[ "$(invoke_status "$second_port")" != "401" ]]; then
  cat "$TEMP_DIR/response.json" >&2 || true
  docker logs "$CONTAINER_NAME" >&2 || true
  echo "Invocation replay was accepted after the sidecar restarted" >&2
  exit 1
fi

mounts="$(docker inspect "$CONTAINER_NAME" --format '{{json .Mounts}}')"
if [[ "$mounts" == *"docker.sock"* || "$mounts" == *"serviceaccount"* ]]; then
  echo "Reference plugin image received a forbidden host or service-account mount" >&2
  exit 1
fi

echo "Reference plugin image hardening and durable-replay checks passed"
