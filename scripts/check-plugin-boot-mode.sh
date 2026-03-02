#!/usr/bin/env bash
# check-plugin-boot-mode.sh — lightweight structural smoke for OSS/EE plugin boot paths.
# Usage: bash scripts/check-plugin-boot-mode.sh [oss|ee]
set -euo pipefail

MODE="${1:-oss}"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

fail=0

assert_file() {
  if [[ ! -f "$1" ]]; then
    echo "❌ [plugin-boot] Missing: $1"
    fail=1
  fi
}

assert_contains() {
  if ! grep -q "$2" "$1" 2>/dev/null; then
    echo "❌ [plugin-boot] Missing pattern '$2' in $1"
    fail=1
  fi
}

# ── OSS mode ──────────────────────────────────────────────
if [[ "$MODE" == "oss" ]]; then
  echo "▶ Checking OSS plugin boot path…"

  # Backend loader exists and handles missing plugin gracefully
  LOADER="packages/backend-host/src/enterprise/loadEnterpriseBackendPlugin.ts"
  assert_file "$LOADER"
  assert_contains "$LOADER" "noopPlugin"
  assert_contains "$LOADER" "isMissingEnterprisePlugin"
  assert_contains "$LOADER" "assertValidPluginShape"

  # Frontend loader exists and returns empty plugin when missing
  FE_LOADER="packages/frontend-host/src/enterprise/loadEnterpriseFrontendPlugin.ts"
  assert_file "$FE_LOADER"
  assert_contains "$FE_LOADER" "emptyPlugin"

  # Server wires up plugin diagnostics
  assert_contains "packages/backend-host/src/server.ts" "enterprisePluginLoaded"
  assert_contains "packages/backend-host/src/server.ts" "Backend plugin status"

  # Extension slot fallback exists for engines route
  assert_contains "packages/frontend-host/src/routes/index.tsx" "engines-page"
  assert_contains "packages/frontend-host/src/routes/index.tsx" "ExtensionPage"

  # Plugin API contract files present
  assert_file "packages/enterprise-plugin-api/src/frontend.d.ts"
  assert_file "packages/enterprise-plugin-api/src/backend.d.ts"

# ── EE mode ───────────────────────────────────────────────
elif [[ "$MODE" == "ee" ]]; then
  echo "▶ Checking EE plugin boot path…"

  # EE frontend plugin entry exists and exports plugin object
  FE_ENTRY="packages/enterprise-frontend/src/index.ts"
  assert_file "$FE_ENTRY"
  assert_contains "$FE_ENTRY" "enterpriseFrontendPlugin"
  assert_contains "$FE_ENTRY" "componentOverrides"
  assert_contains "$FE_ENTRY" "featureOverrides"

  # EE backend plugin entry exists and exports hooks
  BE_ENTRY="packages/enterprise-backend/src/index.ts"
  assert_file "$BE_ENTRY"
  assert_contains "$BE_ENTRY" "enterpriseBackendPlugin"
  assert_contains "$BE_ENTRY" "registerRoutes"
  assert_contains "$BE_ENTRY" "migrateEnterpriseDatabase"

  # EE engines override component exists
  assert_file "packages/enterprise-frontend/src/features/engines/EEEnginesPage.tsx"

  # Multi-tenant feature registers the override
  MT="packages/enterprise-frontend/src/features/multi-tenant/index.ts"
  assert_file "$MT"
  assert_contains "$MT" "engines-page"
  assert_contains "$MT" "EEEnginesPage"

  # Plugin API contract files present and aligned
  assert_file "packages/enterprise-plugin-api/src/frontend.d.ts"
  assert_file "packages/enterprise-plugin-api/src/backend.d.ts"

else
  echo "❌ [plugin-boot] Unknown mode: $MODE (use oss|ee)"
  exit 1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "✅ [plugin-boot] Mode '$MODE' structural smoke passed."
