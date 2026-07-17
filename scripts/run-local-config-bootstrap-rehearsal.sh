#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${LOCAL_CONFIG_BOOTSTRAP_ENV_FILE:-$root_dir/.env.docker}"
project_name="enterpriseglue-config-bootstrap-${RANDOM}${RANDOM}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/enterpriseglue-config-bootstrap.XXXXXX")"
bundle_path="$temp_dir/local-validation-bundle.json"

if [[ ! -f "$env_file" ]]; then
  echo "[local-config-bootstrap] Environment file does not exist: $env_file" >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "[local-config-bootstrap] Docker is not available." >&2
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

node - "$bundle_path" <<'NODE'
const { writeFileSync } = require('node:fs');
const bundlePath = process.argv[2];
const payload = {
  bundle: {
    apiVersion: 'enterpriseglue.ai/v1alpha1',
    kind: 'EnterpriseGlueConfigBundle',
    metadata: { key: 'local.bootstrap.validation', owner: 'local-rehearsal' },
    tenantKey: 'local',
    mode: 'preview_only',
    settings: {},
    imports: ['./groups.json'],
  },
  files: { './groups.json': { groups: [] } },
};
writeFileSync(bundlePath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
NODE

compose=(
  docker compose
  --project-name "$project_name"
  --project-directory "$root_dir"
  --env-file "$env_file"
  -f "$root_dir/infra/docker/compose/docker-compose.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.config-bundle.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.config-bundle-rehearsal.yml"
)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temp_dir"
}
trap cleanup EXIT

wait_for_validated_backend() {
  local attempts=45
  local container_id status
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    container_id="$("${compose[@]}" ps -q backend)"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
      if [[ "$status" == "healthy" ]]; then
        "${compose[@]}" exec -T backend node -e "const http=require('http');http.get('http://127.0.0.1:'+(process.env.API_PORT||'8787')+'/ready',res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>{try{const payload=JSON.parse(body);const bootstrap=payload.configBootstrap;if(res.statusCode!==200||bootstrap?.mode!=='validate'||bootstrap?.status!=='validated'||bootstrap?.issueCode!==null)throw new Error('unexpected sanitized bootstrap status');console.log('[local-config-bootstrap] backend ready with validated bundle');}catch(error){console.error('[local-config-bootstrap] '+error.message);process.exitCode=1;}});}).on('error',error=>{console.error('[local-config-bootstrap] '+error.message);process.exitCode=1;});"
        return
      fi
    fi
    sleep 2
  done
  echo "[local-config-bootstrap] Disposable backend did not become healthy." >&2
  "${compose[@]}" ps >&2 || true
  return 1
}

echo "[local-config-bootstrap] Starting disposable validation stack ($project_name)"
EG_BACKEND_ENV_FILE="$env_file" \
EG_CONFIG_BUNDLE_HOST_PATH="$bundle_path" \
POSTGRES_HOST_PORT="$postgres_host_port" \
  "${compose[@]}" up --build -d db backend
wait_for_validated_backend

echo "[local-config-bootstrap] Recreating backend to verify validation startup remains deterministic"
EG_BACKEND_ENV_FILE="$env_file" \
EG_CONFIG_BUNDLE_HOST_PATH="$bundle_path" \
POSTGRES_HOST_PORT="$postgres_host_port" \
  "${compose[@]}" up --force-recreate -d backend
wait_for_validated_backend

echo "[local-config-bootstrap] Passed; disposable containers and volume will now be removed."
