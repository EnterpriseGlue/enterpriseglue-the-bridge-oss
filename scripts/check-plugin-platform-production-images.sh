#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${PLUGIN_PLATFORM_IMAGE_TAG:-plugin-platform-ci}"
BACKEND_IMAGE="${OSS_BACKEND_IMAGE_UNDER_TEST:-enterpriseglue/oss-backend:${TAG}}"
FRONTEND_IMAGE="${OSS_FRONTEND_IMAGE_UNDER_TEST:-enterpriseglue/oss-frontend:${TAG}}"
MANAGER_IMAGE="${OSS_MANAGER_IMAGE_UNDER_TEST:-enterpriseglue/plugin-manager:${TAG}}"
INSTALLER_IMAGE="${OSS_INSTALLER_IMAGE_UNDER_TEST:-enterpriseglue/plugin-installer:${TAG}}"
TRIVY_IMAGE="${PLUGIN_PLATFORM_TRIVY_IMAGE:-aquasec/trivy@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f}"

cd "$ROOT_DIR"

if [[ "${SKIP_PLUGIN_PLATFORM_IMAGE_BUILD:-false}" != "true" ]]; then
  for dockerfile in packages/plugin-installer/Dockerfile packages/plugin-manager/Dockerfile; do
    docker buildx build --quiet \
      --platform linux/amd64,linux/arm64 \
      --target oras \
      --output=type=cacheonly \
      -f "$dockerfile" .
  done
  docker build --quiet -f backend/Dockerfile.prod -t "$BACKEND_IMAGE" .
  docker build --quiet -f frontend/Dockerfile.prod -t "$FRONTEND_IMAGE" .
  docker build --quiet -f packages/plugin-manager/Dockerfile -t "$MANAGER_IMAGE" .
  docker build --quiet -f packages/plugin-installer/Dockerfile -t "$INSTALLER_IMAGE" .
fi

# Importing the host module executes the real production package-resolution
# path without starting the database-backed HTTP server. These values satisfy
# configuration validation only; they do not connect to a database.
docker run --rm --entrypoint node \
  -e JWT_SECRET=test-secret-test-secret-test-secret-1234 \
  -e ADMIN_PASSWORD=plugin-image-test-password \
  -e ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  -e DATABASE_TYPE=postgres \
  -e POSTGRES_HOST=localhost \
  -e POSTGRES_USER=plugin_test \
  -e POSTGRES_PASSWORD=plugin_test \
  -e POSTGRES_DATABASE=plugin_test \
  -e POSTGRES_SCHEMA=plugin_test \
  "$BACKEND_IMAGE" \
  --input-type=module \
  -e 'await import("/app/dist/packages/backend-host/src/plugins/pluginRuntime.js"); console.log("plugin-host-runtime-imported");'

node scripts/check-paid-plugin-image-boundary.mjs \
  --backend-image "$BACKEND_IMAGE" \
  --frontend-image "$FRONTEND_IMAGE" \
  --manager-image "$MANAGER_IMAGE"

docker run --rm --entrypoint node "$MANAGER_IMAGE" \
  --input-type=module \
  -e 'await import("@enterpriseglue/plugin-manager"); console.log("plugin-manager-imported");'

for image in "$INSTALLER_IMAGE" "$MANAGER_IMAGE"; do
  docker run --rm --entrypoint oras "$image" version
  docker run --rm --entrypoint cosign "$image" version
  docker run --rm \
    --volume /var/run/docker.sock:/var/run/docker.sock \
    "$TRIVY_IMAGE" image --quiet --exit-code 1 \
      --severity HIGH,CRITICAL "$image"
done

printf '{"event":"plugin_platform_production_images","status":"passed","backend":"%s","frontend":"%s","installer":"%s","manager":"%s"}\n' \
  "$BACKEND_IMAGE" "$FRONTEND_IMAGE" "$INSTALLER_IMAGE" "$MANAGER_IMAGE"
