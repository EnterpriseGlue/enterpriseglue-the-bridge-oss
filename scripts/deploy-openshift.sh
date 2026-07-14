#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENSHIFT_ROOT_DIR="$ROOT_DIR/infra/kubernetes/openshift"
OPENSHIFT_OVERLAY="${OPENSHIFT_OVERLAY:-prod}"
OPENSHIFT_KUSTOMIZE_DIR="$OPENSHIFT_ROOT_DIR/kustomize/overlays/$OPENSHIFT_OVERLAY"
CONFIG_BUNDLE_HASH=""
CONFIG_BUNDLE_CONTAINER_PATH=""

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

validate_secret_source() {
  case "${OPENSHIFT_SECRET_SOURCE:-environment}" in
    external)
      oc -n "$OPENSHIFT_NAMESPACE" get secret enterpriseglue-secrets >/dev/null 2>&1 || \
        error "OPENSHIFT_SECRET_SOURCE=external requires the externally managed enterpriseglue-secrets Secret"
      if [[ "${EG_CONFIG_SECRET_PROVIDER:-env}" == "file" ]]; then
        oc -n "$OPENSHIFT_NAMESPACE" get secret enterpriseglue-config-secrets >/dev/null 2>&1 || \
          error "File-backed config references require the externally managed enterpriseglue-config-secrets Secret"
      fi
      log "Externally managed Secret preflight passed"
      ;;
    environment)
      if [[ "${EG_CONFIG_SECRET_PROVIDER:-env}" == "file" ]]; then
        [[ -n "${EG_CONFIG_SECRETS_DIR:-}" && -d "$EG_CONFIG_SECRETS_DIR" ]] || \
          error "File-backed config references require an existing EG_CONFIG_SECRETS_DIR"
      fi
      ;;
    *) error "OPENSHIFT_SECRET_SOURCE must be environment or external" ;;
  esac
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
  case "${OPENSHIFT_SECRET_SOURCE:-environment}" in
    external)
      oc -n "$OPENSHIFT_NAMESPACE" get secret enterpriseglue-secrets >/dev/null 2>&1 || \
        error "OPENSHIFT_SECRET_SOURCE=external requires the externally managed enterpriseglue-secrets Secret"
      log "Using externally managed enterpriseglue-secrets; deployment will not overwrite it"
      return
      ;;
    environment) ;;
    *) error "OPENSHIFT_SECRET_SOURCE must be environment or external" ;;
  esac

  require_env JWT_SECRET
  require_env ADMIN_EMAIL
  require_env ADMIN_PASSWORD
  require_env ENCRYPTION_KEY

  if [[ -z "${POSTGRES_URL:-}" ]]; then
    require_env POSTGRES_USER
    require_env POSTGRES_PASSWORD
  fi

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
  POSTGRES_URL: "${POSTGRES_URL:-}"
  POSTGRES_USER: "${POSTGRES_USER:-}"
  POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:-}"
  ORACLE_CONNECTION_STRING: "${ORACLE_CONNECTION_STRING:-}"
  ORACLE_USER: "${ORACLE_USER:-enterpriseglue}"
  ORACLE_PASSWORD: "${ORACLE_PASSWORD:-oracle}"
EOF
}

apply_config_reference_secret() {
  [[ "${EG_CONFIG_SECRET_PROVIDER:-env}" == "file" ]] || return

  if [[ "${OPENSHIFT_SECRET_SOURCE:-environment}" == "external" ]]; then
    oc -n "$OPENSHIFT_NAMESPACE" get secret enterpriseglue-config-secrets >/dev/null 2>&1 || \
      error "File-backed config references require the externally managed enterpriseglue-config-secrets Secret"
    log "Using externally managed enterpriseglue-config-secrets; deployment will not overwrite it"
    return
  fi

  [[ -n "${EG_CONFIG_SECRETS_DIR:-}" ]] || \
    error "EG_CONFIG_SECRETS_DIR is required when EG_CONFIG_SECRET_PROVIDER=file and OPENSHIFT_SECRET_SOURCE=environment"
  [[ -d "$EG_CONFIG_SECRETS_DIR" ]] || error "EG_CONFIG_SECRETS_DIR does not exist: $EG_CONFIG_SECRETS_DIR"
  local secret_file found_secret_file=false
  for secret_file in "$EG_CONFIG_SECRETS_DIR"/*; do
    if [[ -f "$secret_file" ]]; then
      found_secret_file=true
      break
    fi
  done
  [[ "$found_secret_file" == "true" ]] || error "EG_CONFIG_SECRETS_DIR must contain at least one secret file"

  log "Applying file-backed configuration references from a separate Secret"
  oc -n "$OPENSHIFT_NAMESPACE" create secret generic enterpriseglue-config-secrets \
    --from-file="$EG_CONFIG_SECRETS_DIR" \
    --dry-run=client -o yaml | oc -n "$OPENSHIFT_NAMESPACE" apply -f -
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
  POSTGRES_SSL: "${POSTGRES_SSL:-false}"
  POSTGRES_SSL_REJECT_UNAUTHORIZED: "${POSTGRES_SSL_REJECT_UNAUTHORIZED:-false}"

  ORACLE_HOST: "${ORACLE_HOST:-oracle-db}"
  ORACLE_PORT: "${ORACLE_PORT:-1521}"
  ORACLE_SERVICE_NAME: "${ORACLE_SERVICE_NAME:-XEPDB1}"
  ORACLE_SCHEMA: "${ORACLE_SCHEMA:-ENTERPRISEGLUE}"

  GIT_REPOS_PATH: "/app/data/repos"
  GIT_DEFAULT_BRANCH: "${GIT_DEFAULT_BRANCH:-main}"
  EXPOSE_BACKEND: "false"
  EG_CONFIG_BUNDLE_PATH: "$CONFIG_BUNDLE_CONTAINER_PATH"
  EG_CONFIG_BOOTSTRAP_MODE: "${EG_CONFIG_BOOTSTRAP_MODE:-disabled}"
  EG_CONFIG_EXPECTED_SHA256: "$CONFIG_BUNDLE_HASH"
  EG_CONFIG_EXPECTED_TENANT_SCOPE: "${EG_CONFIG_EXPECTED_TENANT_SCOPE:-platform}"
  EG_CONFIG_FAIL_CLOSED: "${EG_CONFIG_FAIL_CLOSED:-true}"
  EG_CONFIG_REQUIRE_SECRET_PREFLIGHT: "${EG_CONFIG_REQUIRE_SECRET_PREFLIGHT:-false}"
  EG_CONFIG_MAX_BYTES: "${EG_CONFIG_MAX_BYTES:-1048576}"
  EG_CONFIG_SECRET_PROVIDER: "${EG_CONFIG_SECRET_PROVIDER:-env}"
  EG_CONFIG_SECRET_FILE_ROOT: "/var/run/secrets/enterpriseglue"
EOF
}

prepare_config_bundle() {
  if [[ -z "${EG_CONFIG_BUNDLE_FILE:-}" ]]; then
    [[ "${EG_CONFIG_BOOTSTRAP_MODE:-disabled}" == "disabled" ]] || \
      error "EG_CONFIG_BOOTSTRAP_MODE requires EG_CONFIG_BUNDLE_FILE"
    log "No EG_CONFIG_BUNDLE_FILE configured; bootstrap bundle remains disabled"
    return
  fi
  [[ -f "$EG_CONFIG_BUNDLE_FILE" ]] || error "EG_CONFIG_BUNDLE_FILE does not exist: $EG_CONFIG_BUNDLE_FILE"
  [[ "$OPENSHIFT_OVERLAY" != "dev" ]] || error "EG_CONFIG_BUNDLE_FILE requires a staging or prod overlay with the config-bundle component"
  [[ "${EG_CONFIG_BOOTSTRAP_MODE:-disabled}" == "validate" || "${EG_CONFIG_BOOTSTRAP_MODE:-disabled}" == "apply" ]] || \
    error "EG_CONFIG_BOOTSTRAP_MODE must be validate or apply when EG_CONFIG_BUNDLE_FILE is set"

  CONFIG_BUNDLE_HASH="$(node -e "const fs=require('fs'); const crypto=require('crypto'); process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$EG_CONFIG_BUNDLE_FILE")"
  if [[ -n "${EG_CONFIG_EXPECTED_SHA256:-}" && "$CONFIG_BUNDLE_HASH" != "$EG_CONFIG_EXPECTED_SHA256" ]]; then
    error "EG_CONFIG_EXPECTED_SHA256 does not match EG_CONFIG_BUNDLE_FILE"
  fi
  CONFIG_BUNDLE_CONTAINER_PATH="/etc/enterpriseglue/config/bundle.json"
}

validate_manifests() {
  local rendered
  rendered="$(oc kustomize "$OPENSHIFT_KUSTOMIZE_DIR")" || error "Unable to render OpenShift Kustomize overlay"
  printf '%s\n' "$rendered" | oc -n "$OPENSHIFT_NAMESPACE" apply --dry-run=client -f - >/dev/null || \
    error "OpenShift manifests failed client-side validation"

  if [[ -n "${EG_CONFIG_BUNDLE_FILE:-}" ]]; then
    [[ "$rendered" == *"mountPath: /etc/enterpriseglue/config"* ]] || \
      error "Selected overlay does not project the configuration bundle"
    [[ "$rendered" == *"name: enterpriseglue-config-bundle"* ]] || \
      error "Selected overlay does not reference enterpriseglue-config-bundle"
    [[ "$rendered" == *"name: enterpriseglue-config-secrets"* ]] || \
      error "Selected overlay does not reference enterpriseglue-config-secrets"
  fi
  log "OpenShift manifest validation passed"
}

apply_config_bundle() {
  [[ -n "${EG_CONFIG_BUNDLE_FILE:-}" ]] || return

  log "Applying configuration bundle ConfigMap (sha256=${CONFIG_BUNDLE_HASH})"
  oc -n "$OPENSHIFT_NAMESPACE" create configmap enterpriseglue-config-bundle \
    --from-file=bundle.json="$EG_CONFIG_BUNDLE_FILE" \
    --dry-run=client -o yaml | oc -n "$OPENSHIFT_NAMESPACE" apply -f -
  oc -n "$OPENSHIFT_NAMESPACE" patch deployment enterpriseglue-backend --type=merge \
    -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"enterpriseglue.ai/config-bundle-sha256\":\"$CONFIG_BUNDLE_HASH\"}}}}}"
}

annotate_secret_versions() {
  local runtime_secret_version config_secret_version="none"
  runtime_secret_version="$(oc -n "$OPENSHIFT_NAMESPACE" get secret enterpriseglue-secrets -o jsonpath='{.metadata.resourceVersion}')"
  if [[ "${EG_CONFIG_SECRET_PROVIDER:-env}" == "file" ]]; then
    config_secret_version="$(oc -n "$OPENSHIFT_NAMESPACE" get secret enterpriseglue-config-secrets -o jsonpath='{.metadata.resourceVersion}')"
  fi
  oc -n "$OPENSHIFT_NAMESPACE" patch deployment enterpriseglue-backend --type=merge \
    -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"enterpriseglue.ai/runtime-secret-resource-version\":\"$runtime_secret_version\",\"enterpriseglue.ai/config-secret-resource-version\":\"$config_secret_version\"}}}}}"
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
  require_cmd node

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
  prepare_config_bundle
  validate_manifests
  validate_secret_source
  create_or_update_pull_secret
  apply_base_manifests
  apply_runtime_secret
  apply_config_reference_secret
  apply_runtime_config
  # Runtime ConfigMap values must exist before this hash annotation triggers a
  # new backend pod. Otherwise a rollout can start with stale bootstrap mode.
  apply_config_bundle
  annotate_secret_versions
  set_images_and_route
  wait_for_rollout
  verify_health

  log "Deployment complete"
}

main "$@"
