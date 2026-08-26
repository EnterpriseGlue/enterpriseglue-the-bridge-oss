#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/.artifacts/release-readiness/charts}"
PLAN_FILE="$OUTPUT_DIR/plugin-toolchain-chart-plan.json"
PLAN_ROWS="$OUTPUT_DIR/plugin-toolchain-chart-plan.jsonl"
REPRO_DIR="$OUTPUT_DIR/repro"
PULLED_DIR="$OUTPUT_DIR/published"

for command in helm oras jq node git; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required for the plugin-toolchain chart plan" >&2
    exit 1
  }
done

mkdir -p "$OUTPUT_DIR" "$REPRO_DIR" "$PULLED_DIR"
: > "$PLAN_ROWS"

SOURCE_REF="$(git -C "$ROOT_DIR" rev-parse HEAD)"
SOURCE_DATE_EPOCH="$(git -C "$ROOT_DIR" show -s --format=%ct "$SOURCE_REF")"
export SOURCE_DATE_EPOCH

INSTALLER_VERSION="$(node -p "require('$ROOT_DIR/packages/plugin-installer/package.json').version")"
MANAGER_VERSION="$(node -p "require('$ROOT_DIR/packages/plugin-manager/package.json').version")"
RUNTIME_VERSION="$(sed -n 's/^version:[[:space:]]*//p' "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-runtime/Chart.yaml")"
RBAC_VERSION="$(sed -n 's/^version:[[:space:]]*//p' "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac/Chart.yaml")"
MANAGER_CHART_VERSION="$(sed -n 's/^version:[[:space:]]*//p' "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-manager/Chart.yaml")"

[[ "$INSTALLER_VERSION" == "$RUNTIME_VERSION" ]]
[[ "$INSTALLER_VERSION" == "$RBAC_VERSION" ]]
[[ "$MANAGER_VERSION" == "$MANAGER_CHART_VERSION" ]]

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

plan_chart() {
  local chart_dir="$1"
  local repository="$2"
  local version="$3"
  local name archive repro_archive candidate_sha existing status published_archive layer

  name="$(basename "$chart_dir")"
  helm package "$chart_dir" --destination "$OUTPUT_DIR" >/dev/null
  helm package "$chart_dir" --destination "$REPRO_DIR" >/dev/null
  archive="$OUTPUT_DIR/$name-$version.tgz"
  repro_archive="$REPRO_DIR/$name-$version.tgz"
  test -f "$archive"
  test -f "$repro_archive"
  node "$ROOT_DIR/scripts/helm-chart-archive.mjs" compare "$archive" "$repro_archive"
  candidate_sha="$(sha256_file "$archive")"

  existing="$(oras resolve "$repository:$version" 2>/dev/null || true)"
  status="publish-new-version"
  if [[ -n "$existing" ]]; then
    [[ "$existing" =~ ^sha256:[0-9a-f]{64}$ ]]
    layer="$(
      oras manifest fetch "$repository@$existing" |
        jq -er '[.layers[] | select(.mediaType == "application/vnd.cncf.helm.chart.content.v1.tar+gzip") | .digest] | if length == 1 then .[0] else error("expected one chart layer") end'
    )"
    published_archive="$PULLED_DIR/$name-$version.tgz"
    oras blob fetch --output "$published_archive" "$repository@$layer" >/dev/null
    node "$ROOT_DIR/scripts/helm-chart-archive.mjs" compare "$archive" "$published_archive"
    status="reuse-canonically-identical"
  fi

  jq -cn \
    --arg name "$name" \
    --arg repository "$repository" \
    --arg version "$version" \
    --arg status "$status" \
    --arg candidateSha256 "$candidate_sha" \
    --arg publishedDigest "$existing" \
    '{name: $name, repository: $repository, version: $version, status: $status, candidateSha256: $candidateSha256, publishedDigest: (if $publishedDigest == "" then null else $publishedDigest end)}' \
    >> "$PLAN_ROWS"
}

plan_chart \
  "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-runtime" \
  "ghcr.io/enterpriseglue/charts/enterpriseglue-plugin-runtime" \
  "$RUNTIME_VERSION"
plan_chart \
  "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac" \
  "ghcr.io/enterpriseglue/charts/enterpriseglue-plugin-installer-rbac" \
  "$RBAC_VERSION"
plan_chart \
  "$ROOT_DIR/infra/kubernetes/helm/enterpriseglue-plugin-manager" \
  "ghcr.io/enterpriseglue/charts/enterpriseglue-plugin-manager" \
  "$MANAGER_CHART_VERSION"

jq -s \
  --arg sourceRevision "$SOURCE_REF" \
  '{schemaVersion: "enterpriseglue-plugin-toolchain-chart-plan/v1", sourceRevision: $sourceRevision, charts: .}' \
  "$PLAN_ROWS" > "$PLAN_FILE"
jq -e '.charts | length == 3' "$PLAN_FILE" >/dev/null
cat "$PLAN_FILE"
