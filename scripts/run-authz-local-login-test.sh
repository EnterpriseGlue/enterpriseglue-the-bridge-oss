#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${PLAYWRIGHT_BASE_URL:-http://localhost:5173}"
local_ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-}"

if [[ "$#" -eq 0 ]]; then
  echo "[authz-local-login] Provide one or more Playwright test paths." >&2
  exit 64
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
  echo "[authz-local-login] PLAYWRIGHT_BASE_URL must target localhost, loopback, or a .local host; got: $base_url" >&2
  exit 2
fi

if [[ -z "${E2E_USER:-}" || -z "${E2E_PASSWORD:-}" ]]; then
  echo "[authz-local-login] E2E_USER and E2E_PASSWORD are required. Supply disposable local credentials; they are never printed." >&2
  exit 2
fi

curl_args=(--fail --silent --show-error --max-time 5)
playwright_https_args=()
if [[ -n "$local_ca_file" ]]; then
  if [[ ! -f "$local_ca_file" ]]; then
    echo "[authz-local-login] PLAYWRIGHT_LOCAL_CA_FILE does not exist: $local_ca_file" >&2
    exit 2
  fi
  curl_args+=(--cacert "$local_ca_file")
  # Playwright does not import the disposable local CA. This runner only
  # accepts loopback targets, so certificate-error handling stays local-only.
  playwright_https_args=(PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true)
fi

if ! curl "${curl_args[@]}" "$base_url/login" >/dev/null; then
  echo "[authz-local-login] Frontend is not reachable at $base_url/login. Start the local frontend or set PLAYWRIGHT_BASE_URL to its local URL." >&2
  exit 2
fi

headless_shell_path="$(pnpm exec playwright install chromium --dry-run 2>/dev/null | awk '/Chrome Headless Shell/{found=1; next} found && /Install location:/{sub(/^.*Install location:[[:space:]]*/, ""); print; exit}')"
if [[ -z "$headless_shell_path" ]] || [[ ! -d "$headless_shell_path" ]] || ! find "$headless_shell_path" -type f -name 'chrome-headless-shell*' -perm -111 -print -quit | grep -q .; then
  echo "[authz-local-login] Playwright Chromium is not installed for this workspace. Run: pnpm exec playwright install chromium" >&2
  exit 2
fi

# Avoid mutating the local database: this smoke uses an existing disposable account.
env E2E_SEED_USER=false "${playwright_https_args[@]}" pnpm exec playwright test "$@" --config test/e2e/playwright.config.ts
