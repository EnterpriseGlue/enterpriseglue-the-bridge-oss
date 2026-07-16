#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${PLAYWRIGHT_BASE_URL:-https://localhost:5443}"
ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-.local/docker/keycloak-tls/ca.crt}"

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

if ! curl --fail --silent --show-error --cacert "$ca_file" "$base_url/login" >/dev/null; then
  echo "[local-saml-rehearsal] Frontend is not reachable at $base_url/login." >&2
  exit 2
fi

headless_shell_path="$(pnpm exec playwright install chromium --dry-run 2>/dev/null | awk '/Chrome Headless Shell/{found=1; next} found && /Install location:/{sub(/^.*Install location:[[:space:]]*/, ""); print; exit}')"
if [[ -z "$headless_shell_path" ]] || [[ ! -d "$headless_shell_path" ]] || ! find "$headless_shell_path" -type f -name 'chrome-headless-shell*' -perm -111 -print -quit | grep -q .; then
  echo "[local-saml-rehearsal] Playwright Chromium is not installed for this workspace. Run: pnpm exec playwright install chromium" >&2
  exit 2
fi

LOCAL_SAML_REHEARSAL=true \
PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true \
PLAYWRIGHT_LOCAL_CA_FILE="$ca_file" \
E2E_SEED_USER=false \
pnpm exec playwright test test/e2e/local-saml-rehearsal.spec.ts --config test/e2e/playwright.config.ts
