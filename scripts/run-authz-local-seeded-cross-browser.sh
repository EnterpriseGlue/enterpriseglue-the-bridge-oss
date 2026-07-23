#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The seeded fine-grained suite intentionally revokes assignments and group
# memberships. Run each browser in a fresh setup/teardown cycle so one browser
# cannot consume another browser's disposable authorization fixture.
for browser in chromium firefox webkit; do
  echo "[authz-local-cross-browser] Running seeded authorization smoke in ${browser}"
  if [[ "$browser" == "webkit" ]]; then
    # WebKit deliberately rejects Secure cookies over HTTP. Use the local TLS
    # proxy so this run exercises the same cookie contract as production.
    webkit_base_url="${PLAYWRIGHT_WEBKIT_BASE_URL:-https://localhost:5443}"
    webkit_ca_file="${PLAYWRIGHT_WEBKIT_LOCAL_CA_FILE:-$repo_root/.local/docker/keycloak-tls/ca.crt}"
    if [[ ! -f "$webkit_ca_file" ]]; then
      echo "[authz-local-cross-browser] WebKit requires a local TLS CA at $webkit_ca_file (override PLAYWRIGHT_WEBKIT_LOCAL_CA_FILE)." >&2
      exit 2
    fi
    PLAYWRIGHT_BROWSERS="$browser" PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_BASE_URL="$webkit_base_url" PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true PLAYWRIGHT_LOCAL_CA_FILE="$webkit_ca_file" "$repo_root/scripts/run-authz-local-seeded-smoke.sh"
  else
    PLAYWRIGHT_BROWSERS="$browser" PLAYWRIGHT_WORKERS=1 "$repo_root/scripts/run-authz-local-seeded-smoke.sh"
  fi
done

node "$repo_root/scripts/write-authz-browser-evidence.mjs"
