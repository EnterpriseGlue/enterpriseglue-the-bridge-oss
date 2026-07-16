#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${PLAYWRIGHT_BASE_URL:-http://localhost:5173}"
browser_e2e_grep="${BROWSER_E2E_GREP:-@identity-lifecycle}"
local_ca_file="${PLAYWRIGHT_LOCAL_CA_FILE:-}"

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
  echo "[browser-e2e] PLAYWRIGHT_BASE_URL must target localhost, loopback, or a .local host; got: $base_url" >&2
  exit 2
fi

curl_args=(--fail --silent --show-error --max-time 5)
if [[ -n "$local_ca_file" ]]; then
  if [[ ! -f "$local_ca_file" ]]; then
    echo "[browser-e2e] PLAYWRIGHT_LOCAL_CA_FILE does not exist: $local_ca_file" >&2
    exit 2
  fi
  curl_args+=(--cacert "$local_ca_file")
fi

if ! curl "${curl_args[@]}" "$base_url/login" >/dev/null; then
  echo "[browser-e2e] Frontend is not reachable at $base_url/login. Start the local frontend or set PLAYWRIGHT_BASE_URL to its local URL." >&2
  exit 2
fi

headless_shell_path="$(pnpm exec playwright install chromium --dry-run 2>/dev/null | awk '/Chrome Headless Shell/{found=1; next} found && /Install location:/{sub(/^.*Install location:[[:space:]]*/, ""); print; exit}')"
if [[ -z "$headless_shell_path" ]] || [[ ! -d "$headless_shell_path" ]] || ! find "$headless_shell_path" -type f -name 'chrome-headless-shell*' -perm -111 -print -quit | grep -q .; then
  echo "[browser-e2e] Playwright Chromium is not installed for this workspace. Run: pnpm exec playwright install chromium" >&2
  exit 2
fi

E2E_SEED_USER=false pnpm exec playwright test --config test/e2e/playwright.config.ts --grep "$browser_e2e_grep"
