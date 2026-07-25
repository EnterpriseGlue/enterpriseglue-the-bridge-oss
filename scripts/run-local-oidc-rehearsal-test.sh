#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${PLAYWRIGHT_BASE_URL:-https://localhost:5443}"
ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-.local/docker/keycloak-tls/ca.crt}"
issuer_url="${LOCAL_OIDC_ISSUER_URL:-https://localhost:8180/realms/enterpriseglue-local}"
admin_env_file="${LOCAL_OIDC_ADMIN_ENV_FILE:-.local/docker/env/oidc-rehearsal.env}"

if [[ ( -z "${LOCAL_OIDC_ADMIN_EMAIL:-}" || -z "${LOCAL_OIDC_ADMIN_PASSWORD:-}" ) && -f "$admin_env_file" ]]; then
  # The optional browser authorization rehearsal needs only the disposable
  # localhost bootstrap administrator. Do not print or persist its password.
  admin_email="$(awk -F= '$1 == "ADMIN_EMAIL" { print substr($0, index($0, "=") + 1); exit }' "$admin_env_file")"
  admin_password="$(awk -F= '$1 == "ADMIN_PASSWORD" { print substr($0, index($0, "=") + 1); exit }' "$admin_env_file")"
  export LOCAL_OIDC_ADMIN_EMAIL="${LOCAL_OIDC_ADMIN_EMAIL:-$admin_email}"
  export LOCAL_OIDC_ADMIN_PASSWORD="${LOCAL_OIDC_ADMIN_PASSWORD:-$admin_password}"
fi

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
  echo "[local-oidc-rehearsal] PLAYWRIGHT_BASE_URL must target localhost, loopback, or a .local host; got: $base_url" >&2
  exit 2
fi

if ! is_local_url "$issuer_url"; then
  echo "[local-oidc-rehearsal] LOCAL_OIDC_ISSUER_URL must target localhost, loopback, or a .local host; got: $issuer_url" >&2
  exit 2
fi

if [[ ! -f "$ca_file" ]]; then
  echo "[local-oidc-rehearsal] PLAYWRIGHT_LOCAL_CA_FILE does not exist: $ca_file" >&2
  exit 2
fi

if ! curl --fail --silent --show-error --cacert "$ca_file" "$base_url/login" >/dev/null; then
  echo "[local-oidc-rehearsal] Frontend is not reachable at $base_url/login." >&2
  exit 2
fi

if ! curl --fail --silent --show-error --cacert "$ca_file" "$base_url/api/auth/branding" >/dev/null; then
  echo "[local-oidc-rehearsal] Backend is not reachable through $base_url/api/auth/branding." >&2
  exit 2
fi

issuer_discovery_url="${issuer_url%/}/.well-known/openid-configuration"
issuer_ready=false
for _ in {1..30}; do
  if curl --fail --silent --max-time 2 --cacert "$ca_file" "$issuer_discovery_url" >/dev/null; then
    issuer_ready=true
    break
  fi
  sleep 1
done

if [[ "$issuer_ready" != true ]]; then
  echo "[local-oidc-rehearsal] Keycloak discovery is unavailable at $issuer_discovery_url." >&2
  echo "[local-oidc-rehearsal] If backend was recreated, recreate Keycloak in the same Compose command or run: docker compose ... up -d --force-recreate keycloak" >&2
  exit 2
fi

# The baseline redirect rehearsal uses this stable provider, while the
# authorization rehearsal creates and removes its own provider through the
# administration UI. Keeping the bootstrap explicit makes this command
# repeatable against a freshly deployed disposable stack.
LOCAL_OIDC_APP_URL="$base_url" \
LOCAL_OIDC_ISSUER_URL="$issuer_url" \
LOCAL_OIDC_CA_FILE="$ca_file" \
LOCAL_OIDC_ADMIN_EMAIL="$LOCAL_OIDC_ADMIN_EMAIL" \
LOCAL_OIDC_ADMIN_PASSWORD="$LOCAL_OIDC_ADMIN_PASSWORD" \
"$PWD/scripts/configure-local-oidc-provider.sh"

headless_shell_path="$(pnpm exec playwright install chromium --dry-run 2>/dev/null | awk '/Chrome Headless Shell/{found=1; next} found && /Install location:/{sub(/^.*Install location:[[:space:]]*/, ""); print; exit}')"
if [[ -z "$headless_shell_path" ]] || [[ ! -d "$headless_shell_path" ]] || ! find "$headless_shell_path" -type f -name 'chrome-headless-shell*' -perm -111 -print -quit | grep -q .; then
  echo "[local-oidc-rehearsal] Playwright Chromium is not installed for this workspace. Run: pnpm exec playwright install chromium" >&2
  exit 2
fi

# Both scenarios deliberately reconcile the same disposable external identity.
# Running them in separate workers makes their session/membership assertions
# race, so keep this stateful acceptance lane serial by default. Callers can
# still override it after supplying isolated identities and fixtures.
PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-1}" \
LOCAL_OIDC_REHEARSAL=true \
LOCAL_OIDC_AUTHORIZATION_REHEARSAL=true \
PLAYWRIGHT_BASE_URL="$base_url" \
PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true \
PLAYWRIGHT_LOCAL_CA_FILE="$ca_file" \
E2E_SEED_USER=false \
pnpm exec playwright test test/e2e/local-oidc-rehearsal.spec.ts test/e2e/local-oidc-mapping-authorization.spec.ts --config test/e2e/playwright.config.ts "$@"
