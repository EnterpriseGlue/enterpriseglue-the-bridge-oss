#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-current}"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

PKG_JSON="packages/enterprise-plugin-api/package.json"
FRONTEND_DTS="packages/enterprise-plugin-api/src/frontend.d.ts"
BACKEND_DTS="packages/enterprise-plugin-api/src/backend.d.ts"
FIXTURE_TS="packages/enterprise-plugin-api/fixtures/current-plugin-fixture.ts"

fail=0

assert_file_exists() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "❌ [plugin-api-compat] Missing required file: $file"
    fail=1
  fi
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  local description="$3"
  if ! grep -q "$pattern" "$file"; then
    echo "❌ [plugin-api-compat] Missing ${description} in $file"
    fail=1
  fi
}

assert_file_exists "$PKG_JSON"
assert_file_exists "$FRONTEND_DTS"
assert_file_exists "$BACKEND_DTS"

if [[ "$MODE" != "current" && "$MODE" != "next" ]]; then
  echo "❌ [plugin-api-compat] Unsupported mode: $MODE (use current|next)"
  exit 1
fi

# Baseline contract checks used by both modes.
assert_contains "$FRONTEND_DTS" "componentOverrides" "frontend componentOverrides contract"
assert_contains "$FRONTEND_DTS" "featureOverrides" "frontend featureOverrides contract"
assert_contains "$FRONTEND_DTS" "routes" "frontend routes contract"
assert_contains "$FRONTEND_DTS" "tenantRoutes" "frontend tenantRoutes contract"
assert_contains "$BACKEND_DTS" "registerRoutes" "backend registerRoutes hook"
assert_contains "$BACKEND_DTS" "migrateEnterpriseDatabase" "backend migrateEnterpriseDatabase hook"

if [[ "$MODE" == "current" ]]; then
  assert_contains "$PKG_JSON" '"private": false' "non-private plugin-api package"
  assert_contains "$PKG_JSON" '"version": "0.2.0"' "plugin-api baseline version"

  if ! npm pack --dry-run ./packages/enterprise-plugin-api >/dev/null; then
    echo "❌ [plugin-api-compat] plugin-api npm pack dry-run failed"
    fail=1
  fi
fi

# Layer 1: Fixture compilation — compile typed fixture against contract types.
# If any contract type change breaks the consumer shape, tsc fails here.
assert_file_exists "$FIXTURE_TS"
assert_contains "$FIXTURE_TS" "frontendPluginFixture" "frontend compatibility fixture"
assert_contains "$FIXTURE_TS" "backendPluginFixture" "backend compatibility fixture"
assert_contains "$FIXTURE_TS" "backendContextFixture" "backend context fixture"

echo "▶ Compiling contract fixture with tsc…"
TSC="$ROOT_DIR/backend/node_modules/.bin/tsc"
if [[ ! -x "$TSC" ]]; then
  TSC="$(command -v tsc 2>/dev/null || echo "")"
fi
if [[ -z "$TSC" ]]; then
  echo "⚠ [plugin-api-compat] tsc not found — skipping fixture compilation (run npm ci in backend/ first)"
elif ! "$TSC" -p packages/enterprise-plugin-api/fixtures/tsconfig.json 2>&1; then
  echo "❌ [plugin-api-compat] Fixture compilation failed — contract types are incompatible with consumer fixture"
  fail=1
else
  echo "  ✓ Fixture compiles successfully"
fi

if [[ "$MODE" == "next" ]]; then
  # Additional next-mode checks can go here
  :
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "✅ [plugin-api-compat] Mode '$MODE' passed."
