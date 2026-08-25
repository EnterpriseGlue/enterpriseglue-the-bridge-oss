#!/usr/bin/env sh
set -eu

usage() {
  echo "Usage: $0 <deployment-kit-root> [--managed] [--route-origin URL]" >&2
}

if [ "$#" -lt 1 ]; then
  usage
  exit 64
fi

deployment_root=${1%/}
shift
managed=false
route_origin=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --managed)
      managed=true
      shift
      ;;
    --route-origin)
      [ "$#" -ge 2 ] || { usage; exit 64; }
      route_origin=$2
      shift 2
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

compose_directory="$deployment_root/kit/infra/docker/compose"
environment_file="$compose_directory/.env"
manager_overlay="$compose_directory/docker-compose.plugin-manager.yml"
selfhost_compose="$compose_directory/docker-compose.selfhost.yml"

test -f "$environment_file" || { echo "deployment_doctor_failed: missing $environment_file" >&2; exit 1; }
test -f "$manager_overlay" || { echo "deployment_doctor_failed: missing manager overlay" >&2; exit 1; }
test -f "$selfhost_compose" || { echo "deployment_doctor_failed: missing self-host Compose file" >&2; exit 1; }

# The file is deployment-owned and is the same file Docker Compose consumes.
# shellcheck disable=SC1090
set -a
. "$environment_file"
set +a

digest_pattern='^([^[:space:]@]+)@sha256:[a-f0-9]{64}$'
for variable in EG_BACKEND_IMAGE_REF EG_FRONTEND_IMAGE_REF EG_PLUGIN_MANAGER_IMAGE; do
  eval "value=\${$variable:-}"
  printf '%s\n' "$value" | grep -Eq "$digest_pattern" || {
    echo "deployment_doctor_failed: $variable must be an immutable repository@sha256 reference" >&2
    exit 1
  }
done

: "${EG_PLUGIN_MANAGER_CONFIG_DIRECTORY:?deployment_doctor_failed: EG_PLUGIN_MANAGER_CONFIG_DIRECTORY is required}"
: "${EG_PLUGIN_MANAGER_STATE_SOURCE:?deployment_doctor_failed: EG_PLUGIN_MANAGER_STATE_SOURCE is required}"
: "${EG_PLUGIN_MANAGER_STATE_DIRECTORY:?deployment_doctor_failed: EG_PLUGIN_MANAGER_STATE_DIRECTORY is required}"
: "${EG_PLUGIN_DEPLOYMENT_DIRECTORY:?deployment_doctor_failed: EG_PLUGIN_DEPLOYMENT_DIRECTORY is required}"

test -d "$EG_PLUGIN_MANAGER_CONFIG_DIRECTORY" || { echo "deployment_doctor_failed: manager config directory is missing" >&2; exit 1; }
test -d "$EG_PLUGIN_MANAGER_STATE_SOURCE" || { echo "deployment_doctor_failed: manager state source is missing" >&2; exit 1; }
test -d "$EG_PLUGIN_DEPLOYMENT_DIRECTORY" || { echo "deployment_doctor_failed: deployment directory is missing" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "deployment_doctor_failed: docker is required" >&2; exit 1; }

docker run --rm \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --volume "$deployment_root:/deployment:ro" \
  --entrypoint node \
  "$EG_PLUGIN_MANAGER_IMAGE" \
  /deployment/scripts/verify-deployment-kit.mjs /deployment

if [ "$managed" = true ]; then
  [ "$EG_PLUGIN_MANAGER_STATE_SOURCE" = "$EG_PLUGIN_MANAGER_STATE_DIRECTORY" ] || {
    echo "deployment_doctor_failed: managed Compose requires identical absolute state source and container paths" >&2
    exit 1
  }
  docker network inspect enterpriseglue-plugin-gateway >/dev/null 2>&1 || {
    echo "deployment_doctor_failed: enterpriseglue-plugin-gateway does not exist" >&2
    exit 1
  }
  profile=plugins-managed
else
  profile=plugins-planner
fi

docker compose \
  --project-directory "$deployment_root" \
  --env-file "$environment_file" \
  -f "$selfhost_compose" \
  -f "$manager_overlay" \
  --profile "$profile" \
  config --quiet

if [ -n "$route_origin" ]; then
  "$deployment_root/kit/infra/cdn/plugin-routing/check-plugin-route.sh" "$route_origin"
fi

echo "plugin_deployment_doctor_ok"
