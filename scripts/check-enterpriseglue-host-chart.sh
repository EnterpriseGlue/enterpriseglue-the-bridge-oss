#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_DIR="$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-host"
VALUES_FILE="$CHART_DIR/ci-values.yaml"
RENDERED_FILE="$(mktemp)"
OPENSHIFT_FILE="$(mktemp)"
COMBINED_FILE="$(mktemp)"
PROXY_FILE="$(mktemp)"

cleanup() {
  rm -f "$RENDERED_FILE" "$OPENSHIFT_FILE" "$COMBINED_FILE" "$PROXY_FILE"
}
trap cleanup EXIT

command -v helm >/dev/null 2>&1 || { echo "helm is required" >&2; exit 1; }

helm lint "$CHART_DIR" -f "$VALUES_FILE"
helm template enterpriseglue "$CHART_DIR" -f "$VALUES_FILE" >"$RENDERED_FILE"
helm template enterpriseglue "$CHART_DIR" -f "$VALUES_FILE" \
  --set platform=openshift >"$OPENSHIFT_FILE"
helm template enterpriseglue "$CHART_DIR" -f "$VALUES_FILE" \
  --set workers.enabled=false \
  --set database.migration.enabled=false \
  --set database.preflight.enabled=false \
  --set pluginManager.enabled=false >"$COMBINED_FILE"
helm template enterpriseglue "$CHART_DIR" -f "$VALUES_FILE" \
  --set database.connectionProxy.enabled=true \
  --set-string 'database.connectionProxy.image=gcr.io/cloud-sql-connectors/cloud-sql-proxy@sha256:1111111111111111111111111111111111111111111111111111111111111111' \
  --set-json 'database.connectionProxy.args=["--private-ip","project:region:instance"]' \
  --set serviceAccounts.api.automountServiceAccountToken=true \
  --set serviceAccounts.worker.automountServiceAccountToken=true \
  --set serviceAccounts.migration.automountServiceAccountToken=true \
  --set serviceAccounts.preflight.automountServiceAccountToken=true >"$PROXY_FILE"

for expected in \
  "kind: Deployment" \
  "kind: Job" \
  "kind: PodDisruptionBudget" \
  "kind: HorizontalPodAutoscaler" \
  "kind: NetworkPolicy" \
  "kind: Ingress" \
  "app.kubernetes.io/component: api" \
  "app.kubernetes.io/component: worker" \
  "app.kubernetes.io/component: migration" \
  "app.kubernetes.io/component: preflight" \
  "EG_DATABASE_STARTUP_MODE" \
  "value: \"verify\"" \
  "value: \"api\"" \
  "value: \"worker\"" \
  "mode:'apply'" \
  "mode:'verify'" \
  "readOnly: true" \
  "readOnlyRootFilesystem: true" \
  "allowPrivilegeEscalation: false" \
  'drop: ["ALL"]' \
  "runAsNonRoot: true" \
  "automountServiceAccountToken: false" \
  "maxUnavailable: 0" \
  "topologySpreadConstraints:" \
  "helm.sh/resource-policy: keep"; do
  grep -Fq "$expected" "$RENDERED_FILE" || {
    echo "Rendered host chart is missing: $expected" >&2
    exit 1
  }
done

grep -Fq 'image: "ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend@sha256:' "$RENDERED_FILE"
grep -Fq 'image: "ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-frontend@sha256:' "$RENDERED_FILE"

if grep -Eq '^[[:space:]]*(hostNetwork|hostPID|hostIPC|privileged):[[:space:]]*true' "$RENDERED_FILE"; then
  echo "Rendered host chart enables a forbidden privilege or host namespace" >&2
  exit 1
fi
if grep -Eq '^[[:space:]]*(runAsUser|runAsGroup|fsGroup):' "$OPENSHIFT_FILE"; then
  echo "OpenShift must let SecurityContextConstraints allocate identities" >&2
  exit 1
fi
if grep -Fq 'app.kubernetes.io/component: worker' "$COMBINED_FILE"; then
  echo "Combined compatibility profile unexpectedly renders a worker workload" >&2
  exit 1
fi
grep -A4 -F 'name: EG_RUNTIME_ROLE' "$COMBINED_FILE" | grep -Fq 'value: "all"'
grep -A4 -F 'name: EG_DATABASE_STARTUP_MODE' "$COMBINED_FILE" | grep -Fq 'value: "apply"'

test "$(grep -c 'name: database-connection-proxy' "$PROXY_FILE")" -eq 4
test "$(grep -c 'restartPolicy: Always' "$PROXY_FILE")" -eq 2
grep -Fq 'image: "gcr.io/cloud-sql-connectors/cloud-sql-proxy@sha256:1111111111111111111111111111111111111111111111111111111111111111"' "$PROXY_FILE"
grep -Fq -- '- --private-ip' "$PROXY_FILE"
test "$(grep -c 'automountServiceAccountToken: true' "$PROXY_FILE")" -ge 4
test "$(grep -c 'automountServiceAccountToken: false' "$PROXY_FILE")" -ge 1

if helm template enterpriseglue "$CHART_DIR" -f "$VALUES_FILE" \
  --set database.connectionProxy.enabled=true \
  --set-string database.connectionProxy.image=gcr.io/cloud-sql-connectors/cloud-sql-proxy:latest >/dev/null 2>&1; then
  echo "Host chart accepted a mutable database connection proxy image" >&2
  exit 1
fi

# Every rendered Ingress backend must target the frontend Service. Backend and
# Plugin Manager Services are intentionally absent from external routing.
INGRESS_BLOCK="$(sed -n '/^# Source: .*\/ingress.yaml/,$p' "$RENDERED_FILE")"
grep -Fq 'enterpriseglue-enterpriseglue-host-frontend' <<<"$INGRESS_BLOCK"
if grep -Fq 'enterpriseglue-enterpriseglue-host-api' <<<"$INGRESS_BLOCK"; then
  echo "Ingress must not target the API Service directly" >&2
  exit 1
fi

echo "EnterpriseGlue host Helm chart topology and compatibility checks passed"
