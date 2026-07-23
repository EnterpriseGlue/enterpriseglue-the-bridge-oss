#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${PLAYWRIGHT_BASE_URL:-https://localhost:5443}"
api_url="${ENGINE_TENANCY_API_URL:-http://localhost:8787}"
ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-.local/docker/keycloak-tls/ca.crt}"
env_file="${ENGINE_TENANCY_LOCAL_ENV_FILE:-.local/docker/env/docker.env}"

is_local_url() {
  node --input-type=module - "$1" <<'NODE'
const value = process.argv[2];
try {
  const hostname = new URL(value).hostname;
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local');
  process.exit(local ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

if ! is_local_url "$base_url" || ! is_local_url "$api_url"; then
  echo "[engine-tenancy-evidence] Browser and API URLs must target localhost, loopback, or a .local host." >&2
  exit 2
fi

if [[ ! -f "$env_file" ]]; then
  echo "[engine-tenancy-evidence] Local Docker environment file does not exist: $env_file" >&2
  exit 2
fi

if [[ ! -f "$ca_file" ]]; then
  echo "[engine-tenancy-evidence] Local CA file does not exist: $ca_file" >&2
  exit 2
fi

if ! curl --fail --silent --show-error --max-time 5 "$api_url/ready" >/dev/null; then
  echo "[engine-tenancy-evidence] Backend readiness check failed at $api_url/ready." >&2
  exit 2
fi

if ! curl --fail --silent --show-error --max-time 5 --cacert "$ca_file" "$base_url/login" >/dev/null; then
  echo "[engine-tenancy-evidence] TLS frontend is unavailable at $base_url/login." >&2
  exit 2
fi

headless_shell_path="$(pnpm exec playwright install chromium --dry-run 2>/dev/null | awk '/Chrome Headless Shell/{found=1; next} found && /Install location:/{sub(/^.*Install location:[[:space:]]*/, ""); print; exit}')"
if [[ -z "$headless_shell_path" ]] || [[ ! -d "$headless_shell_path" ]] || ! find "$headless_shell_path" -type f -name 'chrome-headless-shell*' -perm -111 -print -quit | grep -q .; then
  echo "[engine-tenancy-evidence] Playwright Chromium is not installed. Run: pnpm exec playwright install chromium" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

# Docker uses the service hostname internally; the guarded host-side fixture
# setup connects through the published database port instead.
export POSTGRES_HOST=127.0.0.1
export POSTGRES_PORT="${POSTGRES_HOST_PORT:-5432}"
export POSTGRES_DATABASE="${POSTGRES_DATABASE:-${POSTGRES_DB:-enterpriseglue}}"
export E2E_API_BASE_URL="$api_url"
export E2E_SEED_USER=true
export E2E_DIRECT_DB_CLEANUP=true
export ENGINE_TENANCY_LOCAL_EVIDENCE=true
export PLAYWRIGHT_BASE_URL="$base_url"
export PLAYWRIGHT_LOCAL_CA_FILE="$ca_file"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true
export PLAYWRIGHT_WORKERS=1

pnpm run test:engine-tenancy:enforcement
