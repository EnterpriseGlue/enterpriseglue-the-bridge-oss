#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$#" -gt 0 ]]; then
  test_files=("$@")
else
  # Identity-provider and mapping administration is just as security-sensitive
  # as Access Control, so retain both surfaces in the release accessibility lane.
  test_files=(
    test/e2e/access-control-accessibility.spec.ts
    test/e2e/identity-administration-accessibility.spec.ts
  )
fi

run_container_browser() {
  local browser="$1"
  local base_url="${PLAYWRIGHT_WEBKIT_BASE_URL:-https://localhost:5443}"
  PLAYWRIGHT_CONTAINER_SUITE=accessibility PLAYWRIGHT_CONTAINER_BROWSER="$browser" PLAYWRIGHT_BASE_URL="$base_url" bash "$repo_root/scripts/run-authz-local-seeded-webkit-container.sh"
}

run_firefox() {
  local execution="${PLAYWRIGHT_FIREFOX_EXECUTION:-auto}"
  case "$execution" in
    native)
      PLAYWRIGHT_BROWSERS=firefox PLAYWRIGHT_WORKERS=1 E2E_SEED_USER=false corepack pnpm exec playwright test "${test_files[@]}" --config test/e2e/playwright.config.ts
      ;;
    container)
      run_container_browser firefox
      ;;
    auto)
      if [[ "$(uname)" == "Darwin" ]]; then
        echo "[authz-accessibility] Using the pinned Linux Playwright container for Firefox on macOS."
        run_container_browser firefox
      else
        PLAYWRIGHT_BROWSERS=firefox PLAYWRIGHT_WORKERS=1 E2E_SEED_USER=false corepack pnpm exec playwright test "${test_files[@]}" --config test/e2e/playwright.config.ts
      fi
      ;;
    *)
      echo "[authz-accessibility] PLAYWRIGHT_FIREFOX_EXECUTION must be auto, native, or container." >&2
      exit 2
      ;;
  esac
}

run_webkit() {
  local execution="${PLAYWRIGHT_WEBKIT_EXECUTION:-auto}"
  local base_url="${PLAYWRIGHT_WEBKIT_BASE_URL:-https://localhost:5443}"
  local ca_file="${PLAYWRIGHT_WEBKIT_LOCAL_CA_FILE:-$repo_root/.local/docker/keycloak-tls/ca.crt}"
  local webkit_tls_args=()
  if [[ "$base_url" == https://* ]]; then
    if [[ ! -f "$ca_file" ]]; then
      echo "[authz-accessibility] WebKit requires the local TLS CA at $ca_file." >&2
      exit 2
    fi
    webkit_tls_args=(PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true PLAYWRIGHT_LOCAL_CA_FILE="$ca_file")
  fi
  case "$execution" in
    native)
      env PLAYWRIGHT_BROWSERS=webkit PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_BASE_URL="$base_url" E2E_SEED_USER=false "${webkit_tls_args[@]}" \
        corepack pnpm exec playwright test "${test_files[@]}" --config test/e2e/playwright.config.ts
      ;;
    container)
      run_container_browser webkit
      ;;
    auto)
      if [[ "$(uname)" == "Darwin" ]]; then
        echo "[authz-accessibility] Using the pinned Linux Playwright container for WebKit on macOS."
        run_container_browser webkit
      else
        env PLAYWRIGHT_BROWSERS=webkit PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_BASE_URL="$base_url" E2E_SEED_USER=false "${webkit_tls_args[@]}" \
          corepack pnpm exec playwright test "${test_files[@]}" --config test/e2e/playwright.config.ts
      fi
      ;;
    *)
      echo "[authz-accessibility] PLAYWRIGHT_WEBKIT_EXECUTION must be auto, native, or container." >&2
      exit 2
      ;;
  esac
}

for browser in chromium; do
  echo "[authz-accessibility] Running Access Control and Identity Administration accessibility checks in ${browser}"
  PLAYWRIGHT_BROWSERS="$browser" PLAYWRIGHT_WORKERS=1 E2E_SEED_USER=false corepack pnpm exec playwright test "${test_files[@]}" --config test/e2e/playwright.config.ts
done

echo "[authz-accessibility] Running Access Control and Identity Administration accessibility checks in firefox"
run_firefox
echo "[authz-accessibility] Running Access Control and Identity Administration accessibility checks in webkit"
run_webkit

node "$repo_root/scripts/write-authz-accessibility-evidence.mjs"
