#!/usr/bin/env sh
set -eu

usage() {
  echo "Usage: $0 <deployment-kit-root> [manager-state-directory]" >&2
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
  exit 64
fi

deployment_root=${1%/}
state_directory=${2:-/opt/enterpriseglue/plugin-manager/state}
config_directory="$deployment_root/config"
compose_directory="$deployment_root/kit/infra/docker/compose"

case "$deployment_root" in /*) ;; *) echo "deployment kit root must be absolute" >&2; exit 1 ;; esac
case "$state_directory" in /*) ;; *) echo "manager state directory must be absolute" >&2; exit 1 ;; esac

test -f "$compose_directory/docker-compose.selfhost.yml" || {
  echo "missing source-free self-host Compose file below $deployment_root/kit" >&2
  exit 1
}
test -f "$compose_directory/docker-compose.plugin-manager.yml" || {
  echo "missing source-free Plugin Manager Compose overlay below $deployment_root/kit" >&2
  exit 1
}

mkdir -p \
  "$config_directory" \
  "$state_directory/releases" \
  "$state_directory/executions" \
  "$state_directory/installer"
chmod 700 "$config_directory" "$state_directory" \
  "$state_directory/releases" "$state_directory/executions" \
  "$state_directory/installer"

if [ "$(id -u)" = "0" ]; then
  chown -R 65532:65532 "$state_directory" "$config_directory"
elif [ ! -w "$state_directory" ]; then
  echo "manager state is not writable; run this preparation as root or grant UID/GID 65532 access" >&2
  exit 1
fi

if [ ! -f "$compose_directory/.env" ]; then
  cp "$compose_directory/.env.example" "$compose_directory/.env"
  chmod 600 "$compose_directory/.env"
  if [ "$(id -u)" = "0" ]; then
    chown 65532:65532 "$compose_directory/.env"
  fi
  echo "created $compose_directory/.env; replace all change_me values before starting"
fi

if [ ! -f "$config_directory/manager-config.json" ]; then
  cp "$config_directory/manager-config.compose_planner.amd64.json.example" \
    "$config_directory/manager-config.json"
  chmod 600 "$config_directory/manager-config.json"
  if [ "$(id -u)" = "0" ]; then
    chown 65532:65532 "$config_directory/manager-config.json"
  fi
  echo "created planner manager-config.json; review digests, architecture, trust, and registry policy"
fi

if command -v docker >/dev/null 2>&1; then
  docker network inspect enterpriseglue-plugin-gateway >/dev/null 2>&1 || \
    docker network create enterpriseglue-plugin-gateway >/dev/null
else
  echo "docker is not available; create enterpriseglue-plugin-gateway before managed installation" >&2
fi

echo "plugin_manager_runtime_prepared"
