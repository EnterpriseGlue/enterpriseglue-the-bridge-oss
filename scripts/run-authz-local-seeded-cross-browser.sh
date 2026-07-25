#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_container_browser() {
  local browser="$1"
  local webkit_base_url="${PLAYWRIGHT_WEBKIT_BASE_URL:-https://localhost:5443}"
  PLAYWRIGHT_CONTAINER_BROWSER="$browser" PLAYWRIGHT_BASE_URL="$webkit_base_url" bash "$repo_root/scripts/run-authz-local-seeded-webkit-container.sh"
}

run_firefox() {
  local execution="${PLAYWRIGHT_FIREFOX_EXECUTION:-auto}"
  case "$execution" in
    native)
      PLAYWRIGHT_BROWSERS=firefox PLAYWRIGHT_WORKERS=1 "$repo_root/scripts/run-authz-local-seeded-smoke.sh"
      ;;
    container)
      run_container_browser firefox
      ;;
    auto)
      if [[ "$(uname)" == "Darwin" ]]; then
        echo "[authz-local-cross-browser] Using the pinned Linux Playwright container for Firefox on macOS."
        run_container_browser firefox
      else
        PLAYWRIGHT_BROWSERS=firefox PLAYWRIGHT_WORKERS=1 "$repo_root/scripts/run-authz-local-seeded-smoke.sh"
      fi
      ;;
    *)
      echo "[authz-local-cross-browser] PLAYWRIGHT_FIREFOX_EXECUTION must be auto, native, or container." >&2
      exit 2
      ;;
  esac
}

run_webkit() {
  local execution="${PLAYWRIGHT_WEBKIT_EXECUTION:-auto}"
  local webkit_base_url="${PLAYWRIGHT_WEBKIT_BASE_URL:-https://localhost:5443}"
  local webkit_ca_file="${PLAYWRIGHT_WEBKIT_LOCAL_CA_FILE:-$repo_root/.local/docker/keycloak-tls/ca.crt}"

  case "$execution" in
    native)
      if [[ ! -f "$webkit_ca_file" ]]; then
        echo "[authz-local-cross-browser] WebKit requires a local TLS CA at $webkit_ca_file (override PLAYWRIGHT_WEBKIT_LOCAL_CA_FILE)." >&2
        exit 2
      fi
      PLAYWRIGHT_BROWSERS=webkit PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_BASE_URL="$webkit_base_url" PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true PLAYWRIGHT_LOCAL_CA_FILE="$webkit_ca_file" "$repo_root/scripts/run-authz-local-seeded-smoke.sh"
      ;;
    container)
      run_container_browser webkit
      ;;
    auto)
      if [[ "$(uname)" == "Darwin" ]]; then
        echo "[authz-local-cross-browser] Using the pinned Linux Playwright container for WebKit on macOS."
        run_container_browser webkit
      else
        if [[ ! -f "$webkit_ca_file" ]]; then
          echo "[authz-local-cross-browser] WebKit requires a local TLS CA at $webkit_ca_file (override PLAYWRIGHT_WEBKIT_LOCAL_CA_FILE)." >&2
          exit 2
        fi
        PLAYWRIGHT_BROWSERS=webkit PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_BASE_URL="$webkit_base_url" PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true PLAYWRIGHT_LOCAL_CA_FILE="$webkit_ca_file" "$repo_root/scripts/run-authz-local-seeded-smoke.sh"
      fi
      ;;
    *)
      echo "[authz-local-cross-browser] PLAYWRIGHT_WEBKIT_EXECUTION must be auto, native, or container." >&2
      exit 2
      ;;
  esac
}

# The seeded fine-grained suite intentionally revokes assignments and group
# memberships. Run each browser in a fresh setup/teardown cycle so one browser
# cannot consume another browser's disposable authorization fixture.
for browser in chromium; do
  echo "[authz-local-cross-browser] Running seeded authorization smoke in ${browser}"
  PLAYWRIGHT_BROWSERS="$browser" PLAYWRIGHT_WORKERS=1 "$repo_root/scripts/run-authz-local-seeded-smoke.sh"
done

echo "[authz-local-cross-browser] Running seeded authorization smoke in firefox"
run_firefox

# WebKit deliberately rejects Secure cookies over HTTP. Use the local TLS
# proxy so this run exercises the same cookie contract as production.
echo "[authz-local-cross-browser] Running seeded authorization smoke in webkit"
run_webkit

node "$repo_root/scripts/write-authz-browser-evidence.mjs"
