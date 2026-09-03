#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/.artifacts/release-readiness"
PACKAGE_DIR="$OUTPUT_DIR/packages"
PLUGIN_PACKAGE_DIR="$PACKAGE_DIR/plugin"
HOST_PACKAGE_DIR="$PACKAGE_DIR/host"
SOURCE_REF="$(git -C "$ROOT_DIR" rev-parse HEAD)"
BASE_REF="${RELEASE_READINESS_BASE_REF:-}"

if [[ -z "$BASE_REF" ]]; then
  BASE_REF="$(git -C "$ROOT_DIR" tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)"
fi
git -C "$ROOT_DIR" rev-parse --verify "$BASE_REF^{commit}" >/dev/null

if [[ "$OUTPUT_DIR" != "$ROOT_DIR/.artifacts/release-readiness" ]]; then
  echo "Unsafe release-readiness output directory" >&2
  exit 1
fi
rm -rf "$OUTPUT_DIR"
mkdir -p "$PLUGIN_PACKAGE_DIR" "$HOST_PACKAGE_DIR"

cd "$ROOT_DIR"

bash ./scripts/check-published-package-version-discipline.sh "$BASE_REF"
pnpm run test:ci-contracts
pnpm run test:plugin-toolchain-release-policy

pnpm --filter @enterpriseglue/plugin-sdk run test
pnpm --filter @enterpriseglue/plugin-sdk run build
pnpm --filter @enterpriseglue/plugin-sdk run test:compat
pnpm --filter @enterpriseglue/plugin-runtime run test
pnpm --filter @enterpriseglue/plugin-runtime run build
pnpm --filter @enterpriseglue/plugin-installer run test
pnpm --filter @enterpriseglue/plugin-installer run build
pnpm --filter @enterpriseglue/plugin-manager run test
pnpm --filter @enterpriseglue/plugin-manager run build
pnpm --filter @enterpriseglue/shared run build
pnpm --filter @enterpriseglue/backend-host run build
pnpm --filter @enterpriseglue/frontend-host run build

pnpm --dir packages/enterprise-plugin-api pack --pack-destination "$PLUGIN_PACKAGE_DIR"
pnpm --dir packages/plugin-sdk pack --pack-destination "$PLUGIN_PACKAGE_DIR"
pnpm --dir packages/plugin-runtime pack --pack-destination "$PLUGIN_PACKAGE_DIR"
pnpm --dir packages/plugin-installer pack --pack-destination "$PLUGIN_PACKAGE_DIR"
pnpm --dir packages/plugin-manager pack --pack-destination "$PLUGIN_PACKAGE_DIR"
node scripts/verify-plugin-package-tarballs.mjs "$PLUGIN_PACKAGE_DIR" \
  > "$PLUGIN_PACKAGE_DIR/release-receipt.json"
node scripts/publish-plugin-package-set.mjs plan "$PLUGIN_PACKAGE_DIR" \
  > "$PLUGIN_PACKAGE_DIR/registry-plan.json"
node scripts/publish-plugin-package-set.mjs dry-run "$PLUGIN_PACKAGE_DIR" \
  > "$PLUGIN_PACKAGE_DIR/publication-dry-run.json"

pnpm --dir packages/shared pack --pack-destination "$HOST_PACKAGE_DIR"
pnpm --dir packages/backend-host pack --pack-destination "$HOST_PACKAGE_DIR"
pnpm --dir packages/frontend-host pack --pack-destination "$HOST_PACKAGE_DIR"
node scripts/verify-host-package-tarballs.mjs "$HOST_PACKAGE_DIR" \
  > "$HOST_PACKAGE_DIR/release-receipt.json"
node scripts/publish-host-package-set.mjs plan "$HOST_PACKAGE_DIR" \
  > "$HOST_PACKAGE_DIR/registry-plan.json"
node scripts/publish-host-package-set.mjs dry-run "$HOST_PACKAGE_DIR" \
  > "$HOST_PACKAGE_DIR/publication-dry-run.json"

bash ./scripts/plan-plugin-toolchain-charts.sh "$OUTPUT_DIR/charts"
bash ./scripts/check-plugin-platform-production-images.sh \
  | tee "$OUTPUT_DIR/production-images.log"
pnpm run test:plugin-toolchain-release:local \
  | tee "$OUTPUT_DIR/toolchain-local.log"

jq -n \
  --arg sourceRevision "$SOURCE_REF" \
  --arg baseRef "$BASE_REF" \
  '{
    schemaVersion: "enterpriseglue-release-readiness/v1",
    status: "passed",
    sourceRevision: $sourceRevision,
    comparisonBase: $baseRef,
    publicationPerformed: false,
    packages: {
      plugin: {registryPlan: "packages/plugin/registry-plan.json", dryRun: "packages/plugin/publication-dry-run.json"},
      host: {registryPlan: "packages/host/registry-plan.json", dryRun: "packages/host/publication-dry-run.json"}
    },
    charts: {registryPlan: "charts/plugin-toolchain-chart-plan.json"},
    productionImages: {built: true, vulnerabilityScan: "HIGH,CRITICAL", platforms: ["linux/amd64", "linux/arm64"]},
    toolchainReceiptRehearsal: {signatures: true, immutableRepull: true, disconnectedImport: true}
  }' > "$OUTPUT_DIR/release-readiness.json"

cat "$OUTPUT_DIR/release-readiness.json"
