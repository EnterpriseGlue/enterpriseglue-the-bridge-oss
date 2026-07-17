#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${PLAYWRIGHT_BASE_URL:-https://localhost:5443}"
ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-.local/docker/keycloak-tls/ca.crt}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
  echo "[local-ldap-rehearsal] PLAYWRIGHT_BASE_URL must target localhost, loopback, or a .local host; got: $base_url" >&2
  exit 2
fi
if [[ ! -f "$ca_file" ]]; then
  echo "[local-ldap-rehearsal] PLAYWRIGHT_LOCAL_CA_FILE does not exist: $ca_file" >&2
  exit 2
fi
if ! curl --fail --silent --show-error --cacert "$ca_file" "$base_url/login" >/dev/null; then
  echo "[local-ldap-rehearsal] Frontend is not reachable at $base_url/login." >&2
  exit 2
fi

if [[ "${LOCAL_LDAP_FIXTURE_ACTIVE:-}" != 'true' ]]; then
  if [[ -z "${LOCAL_LDAP_ADMIN_EMAIL:-}" || -z "${LOCAL_LDAP_ADMIN_PASSWORD:-}" ]]; then
    if [[ -f "$root_dir/.env.docker" ]]; then
      set -a
      source "$root_dir/.env.docker"
      set +a
    elif [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_PASSWORD:-}" ]] && [[ -f "$root_dir/.local/docker/env/oidc-rehearsal.env" ]]; then
      set -a
      source "$root_dir/.local/docker/env/oidc-rehearsal.env"
      set +a
    fi
  fi
  : "${LOCAL_LDAP_ADMIN_EMAIL:=${ADMIN_EMAIL:-}}"
  : "${LOCAL_LDAP_ADMIN_PASSWORD:=${ADMIN_PASSWORD:-}}"
  export LOCAL_LDAP_ADMIN_EMAIL LOCAL_LDAP_ADMIN_PASSWORD LOCAL_LDAP_FIXTURE_ACTIVE=true
  exec ./scripts/run-ldap-protocol-mock.sh "$0"
fi

if [[ -z "${LOCAL_LDAP_ADMIN_EMAIL:-}" || -z "${LOCAL_LDAP_ADMIN_PASSWORD:-}" || -z "${EG_LDAP_TEST_BROWSER_USER_PASSWORD:-}" ]]; then
  echo '[local-ldap-rehearsal] Local administrator and disposable LDAP fixture inputs are required.' >&2
  exit 2
fi

LOCAL_LDAP_APP_URL="$base_url" \
LOCAL_LDAP_APP_CA_FILE="$ca_file" \
./scripts/configure-local-ldap-provider.sh

headless_shell_path="$(pnpm exec playwright install chromium --dry-run 2>/dev/null | awk '/Chrome Headless Shell/{found=1; next} found && /Install location:/{sub(/^.*Install location:[[:space:]]*/, ""); print; exit}')"
if [[ -z "$headless_shell_path" ]] || [[ ! -d "$headless_shell_path" ]] || ! find "$headless_shell_path" -type f -name 'chrome-headless-shell*' -perm -111 -print -quit | grep -q .; then
  echo '[local-ldap-rehearsal] Playwright Chromium is not installed for this workspace. Run: pnpm exec playwright install chromium' >&2
  exit 2
fi

LOCAL_LDAP_REHEARSAL=true \
PLAYWRIGHT_BASE_URL="$base_url" \
LOCAL_LDAP_TEST_USERNAME='browser-login@identity-mock.test' \
LOCAL_LDAP_TEST_PASSWORD="$EG_LDAP_TEST_BROWSER_USER_PASSWORD" \
PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true \
PLAYWRIGHT_LOCAL_CA_FILE="$ca_file" \
E2E_SEED_USER=false \
pnpm exec playwright test test/e2e/local-ldap-rehearsal.spec.ts --config test/e2e/playwright.config.ts
