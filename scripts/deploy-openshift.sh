#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENSHIFT_ROOT_DIR="$ROOT_DIR/infra/kubernetes/openshift"
OPENSHIFT_OVERLAY="${OPENSHIFT_OVERLAY:-prod}"
OPENSHIFT_KUSTOMIZE_DIR="$OPENSHIFT_ROOT_DIR/kustomize/overlays/$OPENSHIFT_OVERLAY"

log() { echo "[openshift-deploy] $*"; }
warn() { echo "[openshift-deploy] WARN: $*"; }
error() { echo "[openshift-deploy] ERROR: $*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || error "Missing required env var: $name"
}

print_arch_summary() {
  log "Cluster node architectures:"
  oc get nodes -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.nodeInfo.architecture}{"\n"}{end}' || true
}

create_or_update_pull_secret() {
  if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
    log "Applying ghcr-pull-secret from GHCR_USERNAME/GHCR_TOKEN"
    oc -n "$OPENSHIFT_NAMESPACE" create secret docker-registry ghcr-pull-secret \
      --docker-server="${REGISTRY_SERVER:-ghcr.io}" \
      --docker-username="$GHCR_USERNAME" \
      --docker-password="$GHCR_TOKEN" \
      --dry-run=client -o yaml | oc -n "$OPENSHIFT_NAMESPACE" apply -f -
  else
    warn "GHCR_USERNAME/GHCR_TOKEN not provided. Assuming ghcr-pull-secret already exists in namespace."
  fi
}

apply_runtime_secret() {
  require_env JWT_SECRET
  require_env ADMIN_EMAIL
  require_env ADMIN_PASSWORD
  require_env ENCRYPTION_KEY

  require_env POSTGRES_USER
  require_env POSTGRES_PASSWORD

  if [[ "$DATABASE_TYPE" == "oracle" ]]; then
    require_env ORACLE_USER
    require_env ORACLE_PASSWORD
  fi

  cat <<EOF | oc -n "$OPENSHIFT_NAMESPACE" apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: enterpriseglue-secrets
  labels:
    app.kubernetes.io/name: enterpriseglue
    app.kubernetes.io/part-of: enterpriseglue
type: Opaque
stringData:
  JWT_SECRET: "$JWT_SECRET"
  ADMIN_EMAIL: "$ADMIN_EMAIL"
  ADMIN_PASSWORD: "$ADMIN_PASSWORD"
  ENCRYPTION_KEY: "$ENCRYPTION_KEY"
  POSTGRES_USER: "$POSTGRES_USER"
  POSTGRES_PASSWORD: "$POSTGRES_PASSWORD"
  ORACLE_USER: "${ORACLE_USER:-enterpriseglue}"
  ORACLE_PASSWORD: "${ORACLE_PASSWORD:-oracle}"
EOF
}

apply_runtime_config() {
  cat <<EOF | oc -n "$OPENSHIFT_NAMESPACE" apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: enterpriseglue-config
  labels:
    app.kubernetes.io/name: enterpriseglue
    app.kubernetes.io/part-of: enterpriseglue
data:
  NODE_ENV: "production"
  API_PORT: "8787"
  FRONTEND_URL: "https://${OPENSHIFT_ROUTE_HOST}"
  API_BASE_URL: ""
  DATABASE_TYPE: "$DATABASE_TYPE"

  POSTGRES_HOST: "${POSTGRES_HOST:-postgresql}"
  POSTGRES_PORT: "${POSTGRES_PORT:-5432}"
  POSTGRES_DATABASE: "${POSTGRES_DATABASE:-enterpriseglue}"
  POSTGRES_SCHEMA: "${POSTGRES_SCHEMA:-main}"

  ORACLE_HOST: "${ORACLE_HOST:-oracle-db}"
  ORACLE_PORT: "${ORACLE_PORT:-1521}"
  ORACLE_SERVICE_NAME: "${ORACLE_SERVICE_NAME:-XEPDB1}"
  ORACLE_SCHEMA: "${ORACLE_SCHEMA:-ENTERPRISEGLUE}"

  GIT_REPOS_PATH: "/app/data/repos"
  GIT_DEFAULT_BRANCH: "${GIT_DEFAULT_BRANCH:-main}"
  EXPOSE_BACKEND: "false"
EOF
}

apply_base_manifests() {
  oc -n "$OPENSHIFT_NAMESPACE" apply -k "$OPENSHIFT_KUSTOMIZE_DIR"
}

set_images_and_route() {
  oc -n "$OPENSHIFT_NAMESPACE" set image deployment/enterpriseglue-backend \
    backend="$BACKEND_IMAGE"

  oc -n "$OPENSHIFT_NAMESPACE" set image deployment/enterpriseglue-frontend \
    frontend="$FRONTEND_IMAGE"

  oc -n "$OPENSHIFT_NAMESPACE" patch route enterpriseglue --type=merge \
    -p "{\"spec\":{\"host\":\"$OPENSHIFT_ROUTE_HOST\"}}"
}

wait_for_rollout() {
  oc -n "$OPENSHIFT_NAMESPACE" rollout status deployment/enterpriseglue-backend --timeout=300s
  oc -n "$OPENSHIFT_NAMESPACE" rollout status deployment/enterpriseglue-frontend --timeout=300s
}

verify_health() {
  local health_url="https://${OPENSHIFT_ROUTE_HOST}/health"
  if [[ "${SKIP_EXTERNAL_HEALTHCHECK:-false}" == "true" ]]; then
    warn "Skipping external health check because SKIP_EXTERNAL_HEALTHCHECK=true"
    return
  fi

  log "Checking route health: $health_url"
  if ! curl -fsS "$health_url" >/dev/null; then
    warn "Could not verify route health from this machine. Check route reachability from your network."
  else
    log "Route health check passed"
  fi
}

main() {
  require_cmd oc
  require_cmd curl

  require_env OPENSHIFT_NAMESPACE
  require_env OPENSHIFT_ROUTE_HOST
  require_env BACKEND_IMAGE
  require_env FRONTEND_IMAGE

  DATABASE_TYPE="${DATABASE_TYPE:-postgres}"

  if [[ ! -d "$OPENSHIFT_KUSTOMIZE_DIR" ]]; then
    error "Missing OpenShift overlay directory: $OPENSHIFT_KUSTOMIZE_DIR"
  fi

  log "Using namespace: $OPENSHIFT_NAMESPACE"
  log "Using backend image: $BACKEND_IMAGE"
  log "Using frontend image: $FRONTEND_IMAGE"
  log "Using route host: $OPENSHIFT_ROUTE_HOST"
  log "Using database type: $DATABASE_TYPE"
  log "Using OpenShift overlay: $OPENSHIFT_OVERLAY"

  oc whoami >/dev/null
  oc project "$OPENSHIFT_NAMESPACE" >/dev/null

  print_arch_summary
  create_or_update_pull_secret
  apply_base_manifests
  apply_runtime_secret
  apply_runtime_config
  set_images_and_route
  wait_for_rollout
  verify_health

  log "Deployment complete"
}

main "$@"
