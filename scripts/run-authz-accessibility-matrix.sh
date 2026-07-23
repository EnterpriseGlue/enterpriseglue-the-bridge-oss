#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_file="${1:-test/e2e/access-control-accessibility.spec.ts}"

for browser in chromium firefox webkit; do
  echo "[authz-accessibility] Running Access Control accessibility checks in ${browser}"
  if [[ "$browser" == "webkit" ]]; then
    webkit_base_url="${PLAYWRIGHT_WEBKIT_BASE_URL:-https://localhost:5443}"
    webkit_ca_file="${PLAYWRIGHT_WEBKIT_LOCAL_CA_FILE:-$repo_root/.local/docker/keycloak-tls/ca.crt}"
    if [[ ! -f "$webkit_ca_file" ]]; then
      echo "[authz-accessibility] WebKit requires the local TLS CA at $webkit_ca_file." >&2
      exit 2
    fi
    PLAYWRIGHT_BROWSERS="$browser" \
      PLAYWRIGHT_WORKERS=1 \
      PLAYWRIGHT_BASE_URL="$webkit_base_url" \
      PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true \
      PLAYWRIGHT_LOCAL_CA_FILE="$webkit_ca_file" \
      E2E_SEED_USER=false \
      pnpm exec playwright test "$test_file" \
        --config test/e2e/playwright.config.ts
  else
    PLAYWRIGHT_BROWSERS="$browser" \
      PLAYWRIGHT_WORKERS=1 \
      E2E_SEED_USER=false \
      pnpm exec playwright test "$test_file" \
        --config test/e2e/playwright.config.ts
  fi
done

node "$repo_root/scripts/write-authz-accessibility-evidence.mjs"
