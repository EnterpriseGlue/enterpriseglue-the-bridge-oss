#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT_DIR/packages/plugin-installer/package.json').version")"
PORT="${EG_PLUGIN_TOOLCHAIN_TEST_REGISTRY_PORT:-5002}"
REGISTRY="127.0.0.1:$PORT"
REGISTRY_NAME="eg-plugin-toolchain-${PPID}-$$"
TARGET_PORT="${EG_PLUGIN_TOOLCHAIN_TEST_TARGET_REGISTRY_PORT:-5003}"
TARGET_REGISTRY="127.0.0.1:$TARGET_PORT"
TARGET_REGISTRY_NAME="eg-plugin-toolchain-target-${PPID}-$$"
ZOT_IMAGE="${EG_PLUGIN_TOOLCHAIN_ZOT_IMAGE:-ghcr.io/project-zot/zot-minimal@sha256:892f2a5a63dd99bdf85320fee5448506119328a6d5e1a2d14d4db876be595236}"
INSTALLER_LOCAL_IMAGE="enterpriseglue/plugin-installer:toolchain-oci-local"
WORK="$(mktemp -d "$ROOT_DIR/.plugin-toolchain-oci-local.XXXXXX")"
CHART_OUTPUT="$WORK/charts"
REPRO_OUTPUT="$WORK/charts-repro"
PULL_OUTPUT="$WORK/pulled"
COSIGN_PREFIX="$WORK/toolchain-cosign"
COSIGN_SIGNING_CONFIG="$WORK/cosign-signing-config.json"
BUNDLE="$WORK/toolchain-airgap"
TAMPERED_BUNDLE="$WORK/toolchain-airgap-tampered"
TAMPERED_UTILITY_BUNDLE="$WORK/toolchain-airgap-utility-tampered"
AIRGAP_RECEIPT="$WORK/toolchain-airgap-import-receipt.json"
registry_started=false
target_registry_started=false
export COSIGN_EXPERIMENTAL=1

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

cleanup() {
  if [ "$registry_started" = true ]; then
    docker rm -f "$REGISTRY_NAME" >/dev/null 2>&1 || true
  fi
  if [ "$target_registry_started" = true ]; then
    docker rm -f "$TARGET_REGISTRY_NAME" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

for command in docker helm oras cosign curl jq node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for the local plugin-toolchain OCI drill" >&2
    exit 1
  fi
done

RUNTIME_CHART_VERSION="$(
  sed -n 's/^version:[[:space:]]*//p' \
    "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-runtime/Chart.yaml"
)"
RBAC_CHART_VERSION="$(
  sed -n 's/^version:[[:space:]]*//p' \
    "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac/Chart.yaml"
)"
if [ "$VERSION" != "$RUNTIME_CHART_VERSION" ] || [ "$VERSION" != "$RBAC_CHART_VERSION" ]; then
  echo "Installer and chart versions must move together" >&2
  exit 1
fi

docker build --quiet \
  --file "$ROOT_DIR/packages/plugin-installer/Dockerfile" \
  --tag "$INSTALLER_LOCAL_IMAGE" \
  "$ROOT_DIR"

docker run --detach \
  --name "$REGISTRY_NAME" \
  --pull=never \
  --publish "127.0.0.1:$PORT:5000" \
  "$ZOT_IMAGE" >/dev/null
registry_started=true

for attempt in $(seq 1 60); do
  if curl --fail --silent "http://$REGISTRY/v2/" >/dev/null; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "Disposable plugin-toolchain registry did not become ready" >&2
    exit 1
  fi
  sleep 0.25
done

mkdir -p \
  "$CHART_OUTPUT" \
  "$REPRO_OUTPUT" \
  "$PULL_OUTPUT/runtime" \
  "$PULL_OUTPUT/rbac"
SOURCE_DATE_EPOCH="$(git -C "$ROOT_DIR" show -s --format=%ct HEAD)"
export SOURCE_DATE_EPOCH
helm package "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-runtime" \
  --destination "$CHART_OUTPUT" >/dev/null
helm package "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac" \
  --destination "$CHART_OUTPUT" >/dev/null
helm package "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-runtime" \
  --destination "$REPRO_OUTPUT" >/dev/null
helm package "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac" \
  --destination "$REPRO_OUTPUT" >/dev/null

RUNTIME_ARCHIVE="$CHART_OUTPUT/enterpriseglue-plugin-runtime-$VERSION.tgz"
RBAC_ARCHIVE="$CHART_OUTPUT/enterpriseglue-plugin-installer-rbac-$VERSION.tgz"
RUNTIME_SHA="$(sha256_file "$RUNTIME_ARCHIVE")"
RBAC_SHA="$(sha256_file "$RBAC_ARCHIVE")"
test "$RUNTIME_SHA" = "$(sha256_file "$REPRO_OUTPUT/$(basename "$RUNTIME_ARCHIVE")")"
test "$RBAC_SHA" = "$(sha256_file "$REPRO_OUTPUT/$(basename "$RBAC_ARCHIVE")")"

helm push --plain-http "$RUNTIME_ARCHIVE" \
  "oci://$REGISTRY/enterpriseglue/charts" >/dev/null
helm push --plain-http "$RBAC_ARCHIVE" \
  "oci://$REGISTRY/enterpriseglue/charts" >/dev/null

INSTALLER_TAG="$REGISTRY/enterpriseglue/plugin-installer:$VERSION-local"
docker tag "$INSTALLER_LOCAL_IMAGE" "$INSTALLER_TAG"
docker push "$INSTALLER_TAG" >/dev/null

INSTALLER_DIGEST="$(oras resolve --plain-http "$INSTALLER_TAG")"
RUNTIME_TAG="$REGISTRY/enterpriseglue/charts/enterpriseglue-plugin-runtime:$VERSION"
RBAC_TAG="$REGISTRY/enterpriseglue/charts/enterpriseglue-plugin-installer-rbac:$VERSION"
RUNTIME_DIGEST="$(oras resolve --plain-http "$RUNTIME_TAG")"
RBAC_DIGEST="$(oras resolve --plain-http "$RBAC_TAG")"
INSTALLER_REFERENCE="${INSTALLER_TAG%:*}@$INSTALLER_DIGEST"
RUNTIME_REFERENCE="${RUNTIME_TAG%:*}@$RUNTIME_DIGEST"
RBAC_REFERENCE="${RBAC_TAG%:*}@$RBAC_DIGEST"

for digest in "$INSTALLER_DIGEST" "$RUNTIME_DIGEST" "$RBAC_DIGEST"; do
  if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "Toolchain subject did not resolve to a SHA-256 digest" >&2
    exit 1
  fi
done

COSIGN_PASSWORD='' cosign generate-key-pair \
  --output-key-prefix "$COSIGN_PREFIX" >/dev/null
cosign signing-config create --out "$COSIGN_SIGNING_CONFIG"
for subject in "$INSTALLER_REFERENCE" "$RUNTIME_REFERENCE" "$RBAC_REFERENCE"; do
  COSIGN_PASSWORD='' cosign sign --yes \
    --key "$COSIGN_PREFIX.key" \
    --signing-config "$COSIGN_SIGNING_CONFIG" \
    --allow-http-registry \
    --registry-referrers-mode=oci-1-1 \
    "$subject" >/dev/null
  cosign verify \
    --key "$COSIGN_PREFIX.pub" \
    --allow-http-registry \
    --insecure-ignore-tlog \
    "$subject" >/dev/null
done

RUNTIME_LAYER_DIGEST="$(
  oras manifest fetch --plain-http "$RUNTIME_REFERENCE" |
    jq -er '
      [.layers[]
        | select(.mediaType == "application/vnd.cncf.helm.chart.content.v1.tar+gzip")
        | .digest]
      | if length == 1 then .[0] else error("expected exactly one Helm chart layer") end
    '
)"
RBAC_LAYER_DIGEST="$(
  oras manifest fetch --plain-http "$RBAC_REFERENCE" |
    jq -er '
      [.layers[]
        | select(.mediaType == "application/vnd.cncf.helm.chart.content.v1.tar+gzip")
        | .digest]
      | if length == 1 then .[0] else error("expected exactly one Helm chart layer") end
    '
)"
PULLED_RUNTIME="$PULL_OUTPUT/runtime/$(basename "$RUNTIME_ARCHIVE")"
PULLED_RBAC="$PULL_OUTPUT/rbac/$(basename "$RBAC_ARCHIVE")"
oras blob fetch --plain-http \
  --output "$PULLED_RUNTIME" \
  "${RUNTIME_REFERENCE%@*}@$RUNTIME_LAYER_DIGEST"
oras blob fetch --plain-http \
  --output "$PULLED_RBAC" \
  "${RBAC_REFERENCE%@*}@$RBAC_LAYER_DIGEST"
test "$RUNTIME_SHA" = "$(sha256_file "$PULLED_RUNTIME")"
test "$RBAC_SHA" = "$(sha256_file "$PULLED_RBAC")"

jq -n \
  --arg version "$VERSION" \
  --arg sourceRevision "$(git -C "$ROOT_DIR" rev-parse HEAD)" \
  --arg installer "$INSTALLER_REFERENCE" \
  --arg runtimeChart "$RUNTIME_REFERENCE" \
  --arg runtimeChartSha256 "$RUNTIME_SHA" \
  --arg rbacChart "$RBAC_REFERENCE" \
  --arg rbacChartSha256 "$RBAC_SHA" \
  '{
    schemaVersion: "enterpriseglue-plugin-toolchain-release/v1",
    version: $version,
    sourceRevision: $sourceRevision,
    installer: $installer,
    runtimeChart: {
      subject: $runtimeChart,
      archiveSha256: $runtimeChartSha256
    },
    installerRbacChart: {
      subject: $rbacChart,
      archiveSha256: $rbacChartSha256
    },
    customerCiRequired: false,
    customerBuildRequired: false
  }' > "$WORK/release.json"

jq -e \
  '.schemaVersion == "enterpriseglue-plugin-toolchain-release/v1"
    and .customerCiRequired == false
    and .customerBuildRequired == false
    and (.installer | contains("@sha256:"))
    and (.runtimeChart.subject | contains("@sha256:"))
    and (.installerRbacChart.subject | contains("@sha256:"))' \
  "$WORK/release.json" >/dev/null

EG_PLUGIN_TOOLCHAIN_AIRGAP_GENERATED_AT="$(
  date -u -r "$SOURCE_DATE_EPOCH" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null ||
    date -u -d "@$SOURCE_DATE_EPOCH" '+%Y-%m-%dT%H:%M:%SZ'
)" node "$ROOT_DIR/scripts/plugin-toolchain-airgap.mjs" export \
  --release "$WORK/release.json" \
  --output "$BUNDLE" \
  --source-plain-http >/dev/null

COSIGN_PASSWORD='' cosign sign-blob --yes \
  --key "$COSIGN_PREFIX.key" \
  --signing-config "$COSIGN_SIGNING_CONFIG" \
  --bundle "$BUNDLE/toolchain-airgap.sigstore.json" \
  "$BUNDLE/toolchain-airgap.json" >/dev/null

cp -R "$BUNDLE" "$TAMPERED_BUNDLE"
printf 'tampered' >> "$TAMPERED_BUNDLE/artifacts/installer.oci.tar"
if node "$ROOT_DIR/scripts/plugin-toolchain-airgap.mjs" import \
  --bundle "$TAMPERED_BUNDLE" \
  --target-prefix "$TARGET_REGISTRY/enterpriseglue" \
  --key "$COSIGN_PREFIX.pub" \
  --insecure-ignore-tlog \
  --target-plain-http >/dev/null 2>"$WORK/tamper-error.log"; then
  echo "Tampered generic toolchain air-gap archive was accepted" >&2
  exit 1
fi
grep -q 'OCI archive hash or size is invalid' "$WORK/tamper-error.log"

cp -R "$BUNDLE" "$TAMPERED_UTILITY_BUNDLE"
printf 'tampered' >> "$TAMPERED_UTILITY_BUNDLE/toolchain-airgap.mjs"
if node "$ROOT_DIR/scripts/plugin-toolchain-airgap.mjs" import \
  --bundle "$TAMPERED_UTILITY_BUNDLE" \
  --target-prefix "$TARGET_REGISTRY/enterpriseglue" \
  --key "$COSIGN_PREFIX.pub" \
  --insecure-ignore-tlog \
  --target-plain-http >/dev/null 2>"$WORK/utility-tamper-error.log"; then
  echo "Tampered generic toolchain air-gap utility was accepted" >&2
  exit 1
fi
grep -q 'utility differs from the signed manifest' \
  "$WORK/utility-tamper-error.log"

docker rm -f "$REGISTRY_NAME" >/dev/null
registry_started=false
if curl --fail --silent "http://$REGISTRY/v2/" >/dev/null 2>&1; then
  echo "Source registry remained reachable during disconnected import" >&2
  exit 1
fi

docker run --detach \
  --name "$TARGET_REGISTRY_NAME" \
  --pull=never \
  --publish "127.0.0.1:$TARGET_PORT:5000" \
  "$ZOT_IMAGE" >/dev/null
target_registry_started=true
for attempt in $(seq 1 60); do
  if curl --fail --silent "http://$TARGET_REGISTRY/v2/" >/dev/null; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "Disposable target registry did not become ready" >&2
    exit 1
  fi
  sleep 0.25
done

node "$ROOT_DIR/scripts/plugin-toolchain-airgap.mjs" import \
  --bundle "$BUNDLE" \
  --target-prefix "$TARGET_REGISTRY/enterpriseglue" \
  --key "$COSIGN_PREFIX.pub" \
  --insecure-ignore-tlog \
  --target-plain-http \
  --receipt "$AIRGAP_RECEIPT" >/dev/null

TARGET_INSTALLER_REFERENCE="$(
  jq -er '.artifacts[] | select(.role == "installer") | .target' \
    "$AIRGAP_RECEIPT"
)"
TARGET_RUNTIME_REFERENCE="$(
  jq -er '.artifacts[] | select(.role == "runtimeChart") | .target' \
    "$AIRGAP_RECEIPT"
)"
TARGET_RBAC_REFERENCE="$(
  jq -er '.artifacts[] | select(.role == "installerRbacChart") | .target' \
    "$AIRGAP_RECEIPT"
)"
jq -e \
  '.schemaVersion == "enterpriseglue-plugin-toolchain-airgap-import/v1"
    and .sourceRegistryAccessed == false
    and .customerCiRequired == false
    and .customerBuildRequired == false
    and (.artifacts | length == 3)
    and all(.artifacts[]; .signatureVerified == true)' \
  "$AIRGAP_RECEIPT" >/dev/null

docker pull "$TARGET_INSTALLER_REFERENCE" >/dev/null
docker run --rm --entrypoint oras "$TARGET_INSTALLER_REFERENCE" version >/dev/null
docker run --rm --entrypoint cosign "$TARGET_INSTALLER_REFERENCE" version >/dev/null
docker run --rm --entrypoint helm "$TARGET_INSTALLER_REFERENCE" version --short >/dev/null
docker run --rm --entrypoint kubectl "$TARGET_INSTALLER_REFERENCE" version --client >/dev/null

jq -n \
  --arg status passed \
  --arg version "$VERSION" \
  --arg installer "$TARGET_INSTALLER_REFERENCE" \
  --arg runtimeChart "$TARGET_RUNTIME_REFERENCE" \
  --arg rbacChart "$TARGET_RBAC_REFERENCE" \
  '{
    status: $status,
    version: $version,
    installer: $installer,
    runtimeChart: $runtimeChart,
    installerRbacChart: $rbacChart,
    signaturesVerified: true,
    deterministicChartsVerified: true,
    digestRepullVerified: true,
    bundledToolsExecuted: true,
    signedAirgapBundleVerified: true,
    tamperedAirgapArchiveRejected: true,
    tamperedAirgapUtilityRejected: true,
    sourceRegistryOfflineDuringImport: true,
    disconnectedRegistryImportVerified: true,
    customerCiRequired: false
  }'
