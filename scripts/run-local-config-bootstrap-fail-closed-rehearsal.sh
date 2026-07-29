#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${LOCAL_CONFIG_BOOTSTRAP_ENV_FILE:-$root_dir/.env.docker}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/enterpriseglue-config-bootstrap-fail-closed.XXXXXX")"
source_backend_image="$(basename "$root_dir")-backend:latest"

if [[ ! -f "$env_file" ]]; then
  echo "[local-config-bootstrap-fail-closed] Environment file does not exist: $env_file" >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "[local-config-bootstrap-fail-closed] Docker is not available." >&2
  exit 2
fi
if ! docker image inspect "$source_backend_image" >/dev/null 2>&1; then
  echo "[local-config-bootstrap-fail-closed] Local backend image is unavailable: $source_backend_image. Run: pnpm run build" >&2
  exit 2
fi

postgres_host_port="$(node --input-type=module <<'NODE'
import net from 'node:net';
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  process.stdout.write(String(address.port));
  server.close();
});
NODE
)"

cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT

write_valid_bundle() {
  local bundle_path="$1"
  local include_missing_secret="$2"
  node - "$bundle_path" "$include_missing_secret" <<'NODE'
const { writeFileSync } = require('node:fs');
const [bundlePath, includeMissingSecret] = process.argv.slice(2);
const bundle = {
  bundle: {
    apiVersion: 'enterpriseglue.ai/v1beta1',
    kind: 'EnterpriseGlueConfigBundle',
    metadata: { key: 'local.bootstrap.fail-closed', owner: 'local-rehearsal' },
    tenantKey: 'local',
    mode: 'preview_only',
    imports: includeMissingSecret === 'true' ? ['./engines.json'] : [],
  },
  files: includeMissingSecret === 'true' ? {
    './engines.json': {
      engines: [{
        key: 'engine.local.fail-closed',
        name: 'Local fail-closed rehearsal engine',
        type: 'operaton',
        baseUrl: 'https://engine.example.test/engine-rest',
        auth: { type: 'bearer', tokenRef: 'LOCAL_REHEARSAL_MISSING_SECRET' },
      }],
    },
  } : {},
};
writeFileSync(bundlePath, `${JSON.stringify(bundle)}\n`, { mode: 0o600 });
NODE
}

run_case() {
  local case_name="$1"
  local expected_message="$2"
  local expected_hash="$3"
  local require_secret_preflight="$4"
  local bundle_path="$temp_dir/$case_name.json"
  local project_name="enterpriseglue-config-bootstrap-fail-closed-${case_name}-${RANDOM}${RANDOM}"
  local project_backend_image="$project_name-backend:latest"
  local container_id=""

  if [[ "$case_name" == "invalid_json" ]]; then
    printf '{invalid-json\n' > "$bundle_path"
  elif [[ "$case_name" == "unresolved_secret" ]]; then
    write_valid_bundle "$bundle_path" true
  else
    write_valid_bundle "$bundle_path" false
  fi

  local compose=(
    docker compose
    --project-name "$project_name"
    --project-directory "$root_dir"
    --env-file "$env_file"
    -f "$root_dir/infra/docker/compose/docker-compose.yml"
    -f "$root_dir/infra/docker/compose/docker-compose.config-bundle.yml"
    -f "$root_dir/infra/docker/compose/docker-compose.config-bundle-rehearsal.yml"
  )
  run_compose() {
    EG_BACKEND_ENV_FILE="$env_file" \
    EG_CONFIG_BUNDLE_HOST_PATH="$bundle_path" \
    LOCAL_CONFIG_BOOTSTRAP_MODE=validate \
    LOCAL_CONFIG_BOOTSTRAP_EXPECTED_SHA256="$expected_hash" \
    LOCAL_CONFIG_BOOTSTRAP_REQUIRE_SECRET_PREFLIGHT="$require_secret_preflight" \
    POSTGRES_HOST_PORT="$postgres_host_port" \
      "${compose[@]}" "$@"
  }
  finish_case() {
    run_compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    docker image rm "$project_backend_image" >/dev/null 2>&1 || true
  }

  echo "[local-config-bootstrap-fail-closed] Starting disposable $case_name case"
  docker tag "$source_backend_image" "$project_backend_image"
  run_compose up --no-build -d db backend >/dev/null
  for attempt in {1..35}; do
    container_id="$(run_compose ps -q backend)"
    if [[ -n "$container_id" ]]; then
      local health_state
      health_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
      if [[ "$health_state" == "healthy" ]]; then
        finish_case
        echo "[local-config-bootstrap-fail-closed] $case_name unexpectedly became ready." >&2
        return 1
      fi
      if docker logs "$container_id" 2>&1 | grep -Fq "$expected_message"; then
        finish_case
        echo "[local-config-bootstrap-fail-closed] $case_name failed closed with its sanitized diagnostic."
        return 0
      fi
    fi
    sleep 2
  done

  finish_case
  echo "[local-config-bootstrap-fail-closed] $case_name did not expose its expected sanitized failure." >&2
  return 1
}

unset LOCAL_REHEARSAL_MISSING_SECRET
run_case invalid_json 'Configuration bundle could not be read' '' false
run_case hash_mismatch 'Configuration bundle hash verification failed' '0000000000000000000000000000000000000000000000000000000000000000' false
run_case unresolved_secret 'Configuration bundle secret preflight failed' '' true
echo '[local-config-bootstrap-fail-closed] Passed; all disposable stacks were removed.'
