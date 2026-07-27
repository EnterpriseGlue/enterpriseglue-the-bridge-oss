#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_DIR="$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-runtime"
RBAC_CHART_DIR="$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac"
VALUES_FILE="$CHART_DIR/ci-values.yaml"
RENDERED_FILE="$(mktemp)"
OPENSHIFT_RENDERED_FILE="$(mktemp)"
RBAC_RENDERED_FILE="$(mktemp)"

cleanup() {
  rm -f "$RENDERED_FILE" "$OPENSHIFT_RENDERED_FILE" "$RBAC_RENDERED_FILE"
}
trap cleanup EXIT

if ! command -v helm >/dev/null 2>&1; then
  echo "helm is required to validate the plugin runtime chart" >&2
  exit 1
fi

helm lint "$CHART_DIR" -f "$VALUES_FILE"
helm lint "$RBAC_CHART_DIR"
helm template enterpriseglue-plugins "$CHART_DIR" -f "$VALUES_FILE" >"$RENDERED_FILE"
helm template enterpriseglue-plugins "$CHART_DIR" -f "$VALUES_FILE" \
  --set platform=openshift >"$OPENSHIFT_RENDERED_FILE"
helm template enterpriseglue-plugin-installer-rbac "$RBAC_CHART_DIR" \
  --namespace enterpriseglue-plugins >"$RBAC_RENDERED_FILE"

require_text() {
  local expected="$1"
  if ! grep -Fq "$expected" "$RENDERED_FILE"; then
    echo "Rendered chart is missing required security property: $expected" >&2
    exit 1
  fi
}

require_text "kind: NetworkPolicy"
require_text "kind: ServiceAccount"
require_text "automountServiceAccountToken: false"
require_text "runAsNonRoot: true"
require_text "readOnlyRootFilesystem: true"
require_text "allowPrivilegeEscalation: false"
require_text 'drop: ["ALL"]'
require_text "seccompProfile:"
require_text "type: RuntimeDefault"
require_text "runAsUser: 65532"
require_text "runAsGroup: 65532"
require_text "fsGroup: 65532"
require_text "helm.sh/resource-policy: keep"
require_text "eg-plugin-io-enterpriseglue-reference-schema-2-data"
require_text 'type: ClusterIP'
require_text "SIGNED_CONFIG_FILE"
require_text "/etc/enterpriseglue/plugin-config"
require_text "enterpriseglue-plugin-config-files"
require_text "2532d0d288e03534c714be124577058e--example-signed-config.json"

if grep -Eq '^[[:space:]]*(automountServiceAccountToken|allowPrivilegeEscalation|privileged|hostNetwork|hostPID|hostIPC):[[:space:]]*true([[:space:]]|$)' "$RENDERED_FILE"; then
  echo "Rendered chart enables a forbidden privilege or host namespace" >&2
  exit 1
fi

if grep -Eq '^[[:space:]]*(kind:[[:space:]]*Secret|secretKeyRef:)' "$RENDERED_FILE"; then
  echo "Plugin chart must pass opaque secret references, not mount or render raw secrets" >&2
  exit 1
fi

if grep -Eq '^[[:space:]]*(runAsUser|runAsGroup|fsGroup):' "$OPENSHIFT_RENDERED_FILE"; then
  echo "OpenShift profile must let SecurityContextConstraints assign the UID/GID" >&2
  exit 1
fi

for expected in \
  "runAsNonRoot: true" \
  "readOnlyRootFilesystem: true" \
  "allowPrivilegeEscalation: false" \
  "seccompProfile:" \
  "type: RuntimeDefault"; do
  if ! grep -Fq "$expected" "$OPENSHIFT_RENDERED_FILE"; then
    echo "OpenShift profile is missing required security property: $expected" >&2
    exit 1
  fi
done

while IFS= read -r image_line; do
  image_ref="${image_line#*:}"
  image_ref="${image_ref//\"/}"
  image_ref="${image_ref//[[:space:]]/}"
  if [[ "$image_ref" != *@sha256:* ]]; then
    echo "Plugin backend images must be pinned by digest: $image_ref" >&2
    exit 1
  fi
done < <(grep -E '^[[:space:]]+image:[[:space:]]' "$RENDERED_FILE")

for expected in \
  "kind: ServiceAccount" \
  "kind: Role" \
  "kind: RoleBinding" \
  "resources: [deployments/scale]" \
  "resources: [pods]"; do
  if ! grep -Fq "$expected" "$RBAC_RENDERED_FILE"; then
    echo "Installer RBAC chart is missing: $expected" >&2
    exit 1
  fi
done

for forbidden in \
  "kind: ClusterRole" \
  "kind: ClusterRoleBinding" \
  "secrets" \
  "pods/exec" \
  "pods/log" \
  "roles" \
  "rolebindings"; do
  if grep -Fq "$forbidden" "$RBAC_RENDERED_FILE"; then
    echo "Installer RBAC chart contains forbidden authority: $forbidden" >&2
    exit 1
  fi
done

echo "Plugin runtime Helm chart security checks passed"
