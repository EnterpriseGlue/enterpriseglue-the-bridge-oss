#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
admin_env_file="${LOCAL_SAML_ADMIN_ENV_FILE:-$root_dir/.local/docker/env/oidc-rehearsal.env}"

load_local_admin_credentials() {
  if [[ -n "${LOCAL_SAML_ADMIN_EMAIL:-}" && -n "${LOCAL_SAML_ADMIN_PASSWORD:-}" ]]; then
    return
  fi
  if [[ -f "$admin_env_file" ]]; then
    # Prefer the currently selected disposable TLS stack. Its env file can use
    # non-default published ports and is ignored by Git.
    set -a
    source "$admin_env_file"
    set +a
  elif [[ -f "$root_dir/.env.docker" ]]; then
    set -a
    source "$root_dir/.env.docker"
    set +a
  fi
  : "${LOCAL_SAML_ADMIN_EMAIL:=${ADMIN_EMAIL:-}}"
  : "${LOCAL_SAML_ADMIN_PASSWORD:=${ADMIN_PASSWORD:-}}"
}

# Load the selected disposable stack before computing any network defaults.
# Its frontend, Keycloak, and CA ports may differ from the developer-stack
# defaults; mixing its administrator credentials with another local stack
# produces an opaque authentication failure before the browser flow starts.
load_local_admin_credentials
base_url="${PLAYWRIGHT_BASE_URL:-${FRONTEND_URL:-https://localhost:${KEYCLOAK_HTTPS_FRONTEND_PORT:-5443}}}"
ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-${KEYCLOAK_TLS_DIR:-.local/docker/keycloak-tls}/ca.crt}"

is_local_url() {
  node --input-type=module - "$1" <<'NODE'
const value = process.argv[2];
try {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.local');
  process.exit(local ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

if ! is_local_url "$base_url"; then
  echo "[local-saml-rehearsal] PLAYWRIGHT_BASE_URL must target localhost, loopback, or a .local host; got: $base_url" >&2
  exit 2
fi

if [[ ! -f "$ca_file" ]]; then
  echo "[local-saml-rehearsal] PLAYWRIGHT_LOCAL_CA_FILE does not exist: $ca_file" >&2
  exit 2
fi

if [[ -z "${LOCAL_SAML_ADMIN_EMAIL:-}" || -z "${LOCAL_SAML_ADMIN_PASSWORD:-}" ]]; then
  echo '[local-saml-rehearsal] Local administrator credentials are required to refresh the disposable SAML provider.' >&2
  exit 2
fi

issuer_url="${LOCAL_SAML_ISSUER_URL:-https://localhost:${KEYCLOAK_HOST_PORT:-8180}/realms/enterpriseglue-local}"
signing_certificate_file="${LOCAL_SAML_SIGNING_CERT_FILE:-$root_dir/.local/docker/identity-secrets/keycloak-saml-signing.crt}"
if ! is_local_url "$issuer_url"; then
  echo "[local-saml-rehearsal] LOCAL_SAML_ISSUER_URL must target localhost, loopback, or a .local host; got: $issuer_url" >&2
  exit 2
fi

if ! curl --fail --silent --show-error --cacert "$ca_file" "$base_url/login" >/dev/null; then
  echo "[local-saml-rehearsal] Frontend is not reachable at $base_url/login." >&2
  exit 2
fi

LOCAL_SAML_ADMIN_EMAIL="$LOCAL_SAML_ADMIN_EMAIL" \
LOCAL_SAML_ADMIN_PASSWORD="$LOCAL_SAML_ADMIN_PASSWORD" \
LOCAL_SAML_APP_URL="$base_url" \
LOCAL_SAML_ISSUER_URL="$issuer_url" \
LOCAL_SAML_CA_FILE="$ca_file" \
LOCAL_SAML_SIGNING_CERT_FILE="$signing_certificate_file" \
"$root_dir/scripts/configure-local-saml-provider.sh"

headless_shell_path="$(pnpm exec playwright install chromium --dry-run 2>/dev/null | awk '/Chrome Headless Shell/{found=1; next} found && /Install location:/{sub(/^.*Install location:[[:space:]]*/, ""); print; exit}')"
if [[ -z "$headless_shell_path" ]] || [[ ! -d "$headless_shell_path" ]] || ! find "$headless_shell_path" -type f -name 'chrome-headless-shell*' -perm -111 -print -quit | grep -q .; then
  echo "[local-saml-rehearsal] Playwright Chromium is not installed for this workspace. Run: pnpm exec playwright install chromium" >&2
  exit 2
fi

LOCAL_SAML_REHEARSAL=true \
PLAYWRIGHT_BASE_URL="$base_url" \
PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true \
PLAYWRIGHT_LOCAL_CA_FILE="$ca_file" \
E2E_SEED_USER=false \
pnpm exec playwright test test/e2e/local-saml-rehearsal.spec.ts --config test/e2e/playwright.config.ts
