#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER_NAME="eg-plugin-multi-${PPID}-$$"
CONTEXT="kind-$CLUSTER_NAME"
NODE_NAME="${CLUSTER_NAME}-control-plane"
TEMPORARY_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/eg-plugin-kind.XXXXXX")"
HOST_KUBECONFIG="$TEMPORARY_DIRECTORY/host.kubeconfig"
CONTAINER_KUBECONFIG="$TEMPORARY_DIRECTORY/container.kubeconfig"
REFERENCE_TAG="enterpriseglue/reference-health:kubernetes-lifecycle"
SECONDARY_V1_TAG="enterpriseglue/reference-health-secondary:kubernetes-v0.1.0"
SECONDARY_V2_TAG="enterpriseglue/reference-health-secondary:kubernetes-v0.2.0"
SECONDARY_V3_TAG="enterpriseglue/reference-health-secondary:kubernetes-v0.3.0"
SECONDARY_V4_TAG="enterpriseglue/reference-health-secondary:kubernetes-v0.4.0-readiness-fail"
SECONDARY_V5_TAG="enterpriseglue/reference-health-secondary:kubernetes-v0.5.0-crash"
MIGRATION_TAG="enterpriseglue/reference-health-secondary-migration:kubernetes-local"
INSTALLER_TAG="enterpriseglue/plugin-installer:kubernetes-local"
CLUSTER_CREATED=false

cleanup() {
  if [[ "$CLUSTER_CREATED" == "true" ]]; then
    kind delete cluster --name "$CLUSTER_NAME" >/dev/null 2>&1 || true
  fi
  rm -f "$HOST_KUBECONFIG" "$CONTAINER_KUBECONFIG"
  rmdir "$TEMPORARY_DIRECTORY" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for command_name in docker kind kubectl helm pnpm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required for local Kubernetes plugin acceptance" >&2
    exit 2
  fi
done

cd "$ROOT_DIR"

if [[ "${EG_PLUGIN_SKIP_IMAGE_BUILD:-false}" != "true" ]]; then
  docker build \
    --file packages/plugin-reference/Dockerfile \
    --tag "$REFERENCE_TAG" \
    .
  docker build \
    --file packages/plugin-reference/fixtures/secondary-lifecycle/Dockerfile \
    --build-arg SECONDARY_PLUGIN_VERSION=0.1.0 \
    --tag "$SECONDARY_V1_TAG" \
    .
  docker build \
    --file packages/plugin-reference/fixtures/secondary-lifecycle/Dockerfile \
    --build-arg SECONDARY_PLUGIN_VERSION=0.2.0 \
    --tag "$SECONDARY_V2_TAG" \
    .
  docker build \
    --file packages/plugin-reference/fixtures/secondary-lifecycle/Dockerfile \
    --build-arg SECONDARY_PLUGIN_VERSION=0.3.0 \
    --tag "$SECONDARY_V3_TAG" \
    .
  docker build \
    --file packages/plugin-reference/fixtures/secondary-lifecycle/Dockerfile \
    --build-arg SECONDARY_PLUGIN_VERSION=0.4.0 \
    --build-arg SECONDARY_PLUGIN_MODE=readiness-fail \
    --tag "$SECONDARY_V4_TAG" \
    .
  docker build \
    --file packages/plugin-reference/fixtures/secondary-lifecycle/Dockerfile \
    --build-arg SECONDARY_PLUGIN_VERSION=0.5.0 \
    --build-arg SECONDARY_PLUGIN_MODE=crash \
    --tag "$SECONDARY_V5_TAG" \
    .
  docker build \
    --file packages/plugin-reference/fixtures/secondary-lifecycle/Dockerfile.migration \
    --tag "$MIGRATION_TAG" \
    .
  docker build \
    --file packages/plugin-installer/Dockerfile \
    --tag "$INSTALLER_TAG" \
    .
fi

kind create cluster \
  --name "$CLUSTER_NAME" \
  --kubeconfig "$HOST_KUBECONFIG"
CLUSTER_CREATED=true
cp "$HOST_KUBECONFIG" "$CONTAINER_KUBECONFIG"
kubectl \
  --kubeconfig "$CONTAINER_KUBECONFIG" \
  config set-cluster "$CONTEXT" \
  --server="https://${NODE_NAME}:6443" \
  >/dev/null

kind load docker-image "$REFERENCE_TAG" --name "$CLUSTER_NAME"
kind load docker-image "$SECONDARY_V1_TAG" --name "$CLUSTER_NAME"
kind load docker-image "$SECONDARY_V2_TAG" --name "$CLUSTER_NAME"
kind load docker-image "$SECONDARY_V3_TAG" --name "$CLUSTER_NAME"
kind load docker-image "$SECONDARY_V4_TAG" --name "$CLUSTER_NAME"
kind load docker-image "$SECONDARY_V5_TAG" --name "$CLUSTER_NAME"
kind load docker-image "$MIGRATION_TAG" --name "$CLUSTER_NAME"
kind load docker-image "$INSTALLER_TAG" --name "$CLUSTER_NAME"

REFERENCE_ID="$(docker image inspect "$REFERENCE_TAG" --format '{{.Id}}')"
SECONDARY_V1_ID="$(docker image inspect "$SECONDARY_V1_TAG" --format '{{.Id}}')"
SECONDARY_V2_ID="$(docker image inspect "$SECONDARY_V2_TAG" --format '{{.Id}}')"
SECONDARY_V3_ID="$(docker image inspect "$SECONDARY_V3_TAG" --format '{{.Id}}')"
SECONDARY_V4_ID="$(docker image inspect "$SECONDARY_V4_TAG" --format '{{.Id}}')"
SECONDARY_V5_ID="$(docker image inspect "$SECONDARY_V5_TAG" --format '{{.Id}}')"
MIGRATION_ID="$(docker image inspect "$MIGRATION_TAG" --format '{{.Id}}')"
INSTALLER_ID="$(docker image inspect "$INSTALLER_TAG" --format '{{.Id}}')"
REFERENCE_DIGEST_REF="docker.io/enterpriseglue/reference-health@$REFERENCE_ID"
SECONDARY_V1_DIGEST_REF="docker.io/enterpriseglue/reference-health-secondary@$SECONDARY_V1_ID"
SECONDARY_V2_DIGEST_REF="docker.io/enterpriseglue/reference-health-secondary@$SECONDARY_V2_ID"
SECONDARY_V3_DIGEST_REF="docker.io/enterpriseglue/reference-health-secondary@$SECONDARY_V3_ID"
SECONDARY_V4_DIGEST_REF="docker.io/enterpriseglue/reference-health-secondary@$SECONDARY_V4_ID"
SECONDARY_V5_DIGEST_REF="docker.io/enterpriseglue/reference-health-secondary@$SECONDARY_V5_ID"
MIGRATION_DIGEST_REF="docker.io/enterpriseglue/reference-health-secondary-migration@$MIGRATION_ID"
INSTALLER_DIGEST_REF="docker.io/enterpriseglue/plugin-installer@$INSTALLER_ID"

# `kind load docker-image` imports a local tag. The lifecycle contract accepts
# only repository@digest, so add an equivalent local containerd alias instead
# of weakening manifests to mutable tags or pulling from a public registry.
docker exec "$NODE_NAME" \
  ctr -n k8s.io images tag \
  "docker.io/$REFERENCE_TAG" \
  "$REFERENCE_DIGEST_REF" \
  >/dev/null
docker exec "$NODE_NAME" \
  ctr -n k8s.io images tag \
  "docker.io/$SECONDARY_V1_TAG" \
  "$SECONDARY_V1_DIGEST_REF" \
  >/dev/null
docker exec "$NODE_NAME" \
  ctr -n k8s.io images tag \
  "docker.io/$SECONDARY_V2_TAG" \
  "$SECONDARY_V2_DIGEST_REF" \
  >/dev/null
docker exec "$NODE_NAME" \
  ctr -n k8s.io images tag \
  "docker.io/$SECONDARY_V3_TAG" \
  "$SECONDARY_V3_DIGEST_REF" \
  >/dev/null
docker exec "$NODE_NAME" \
  ctr -n k8s.io images tag \
  "docker.io/$SECONDARY_V4_TAG" \
  "$SECONDARY_V4_DIGEST_REF" \
  >/dev/null
docker exec "$NODE_NAME" \
  ctr -n k8s.io images tag \
  "docker.io/$SECONDARY_V5_TAG" \
  "$SECONDARY_V5_DIGEST_REF" \
  >/dev/null
docker exec "$NODE_NAME" \
  ctr -n k8s.io images tag \
  "docker.io/$MIGRATION_TAG" \
  "$MIGRATION_DIGEST_REF" \
  >/dev/null
docker exec "$NODE_NAME" \
  ctr -n k8s.io images tag \
  "docker.io/$INSTALLER_TAG" \
  "$INSTALLER_DIGEST_REF" \
  >/dev/null

EG_PLUGIN_TEST_KUBECONFIG="$HOST_KUBECONFIG" \
EG_PLUGIN_TEST_CONTAINER_KUBECONFIG="$CONTAINER_KUBECONFIG" \
EG_PLUGIN_TEST_KUBE_CONTEXT="$CONTEXT" \
EG_PLUGIN_TEST_REFERENCE_IMAGE="$REFERENCE_DIGEST_REF" \
EG_PLUGIN_TEST_SECONDARY_V1_IMAGE="$SECONDARY_V1_DIGEST_REF" \
EG_PLUGIN_TEST_SECONDARY_V2_IMAGE="$SECONDARY_V2_DIGEST_REF" \
EG_PLUGIN_TEST_SECONDARY_V3_IMAGE="$SECONDARY_V3_DIGEST_REF" \
EG_PLUGIN_TEST_SECONDARY_V4_IMAGE="$SECONDARY_V4_DIGEST_REF" \
EG_PLUGIN_TEST_SECONDARY_V5_IMAGE="$SECONDARY_V5_DIGEST_REF" \
EG_PLUGIN_TEST_MIGRATION_IMAGE="$MIGRATION_DIGEST_REF" \
EG_PLUGIN_TEST_INSTALLER_IMAGE="$INSTALLER_DIGEST_REF" \
EG_PLUGIN_KUBERNETES_NETWORK=kind \
pnpm run test:plugin-platform:kubernetes-lifecycle
