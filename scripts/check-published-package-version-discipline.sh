#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${1:-origin/main}"

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "[package-version-discipline] Base ref not found: $BASE_REF" >&2
  exit 1
fi

MERGE_BASE="$(git merge-base "$BASE_REF" HEAD)"
if [ -z "$MERGE_BASE" ]; then
  echo "[package-version-discipline] Could not determine merge-base against $BASE_REF" >&2
  exit 1
fi

CHANGED_FILES="$(git diff --name-only "$MERGE_BASE"...HEAD)"
if [ -z "$CHANGED_FILES" ]; then
  echo "[package-version-discipline] No changed files detected."
  exit 0
fi

read_json_version() {
  node - <<'NODE' "$1"
const fs = require('fs')
const path = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'))
process.stdout.write(String(pkg.version || ''))
NODE
}

read_git_json_version() {
  git show "$1" 2>/dev/null | node -e "let data=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => { data += chunk; }); process.stdin.on('end', () => { const pkg = JSON.parse(data || '{}'); process.stdout.write(String(pkg.version || '')); });"
}

version_is_greater() {
  node - <<'NODE' "$1" "$2"
const [oldVersion, newVersion] = process.argv.slice(2)

function parse(version) {
  const core = String(version || '').split('-')[0]
  if (!/^\d+\.\d+\.\d+$/.test(core)) return null
  return core.split('.').map((part) => Number(part))
}

const oldParts = parse(oldVersion)
const newParts = parse(newVersion)
if (!oldParts || !newParts) process.exit(2)

for (let i = 0; i < 3; i += 1) {
  if (newParts[i] > oldParts[i]) process.exit(0)
  if (newParts[i] < oldParts[i]) process.exit(1)
}

process.exit(1)
NODE
}

package_has_relevant_changes() {
  local dir="$1"
  local manifest="$2"
  local workspace_changes

  if echo "$CHANGED_FILES" | grep -E "^${dir}/" | grep -Ev "^${dir}/(Dockerfile(\..*)?|third_party_licenses\.json|README(\.md)?|CHANGELOG\.md|docs/)" >/dev/null; then
    return 0
  fi

  [ -f "$manifest" ] || return 1
  if ! workspace_changes="$(node ./scripts/check-workspace-dependency-version-drift.mjs "$MERGE_BASE" "$manifest")"; then
    return 2
  fi
  [ -n "$workspace_changes" ]
}

failures=0
changed_count=0

check_package() {
  local package_name="$1"
  local dir="$2"
  local manifest="$3"
  local relevance_status=0

  package_has_relevant_changes "$dir" "$manifest" || relevance_status=$?
  if [ "$relevance_status" -eq 1 ]; then
    return 0
  fi
  if [ "$relevance_status" -ne 0 ]; then
    echo "::error file=${manifest}::Could not evaluate packed workspace dependency versions for ${package_name}."
    failures=1
    return 0
  fi

  changed_count=$((changed_count + 1))

  if ! git cat-file -e "${MERGE_BASE}:${manifest}" 2>/dev/null; then
    local initial_version
    initial_version="$(read_json_version "$manifest")"
    if [ -z "$initial_version" ]; then
      echo "::error file=${manifest}::Could not read initial package version for ${package_name}."
      failures=1
      return 0
    fi
    echo "[package-version-discipline] ${package_name}: initial publication ${initial_version}"
    return 0
  fi

  if git diff --quiet "$MERGE_BASE"...HEAD -- "$manifest"; then
    echo "::error file=${manifest}::${package_name} changed without a version bump in ${manifest}. Bump the published package version in the same PR."
    failures=1
    return 0
  fi

  local old_version
  local new_version
  old_version="$(read_git_json_version "${MERGE_BASE}:${manifest}")"
  new_version="$(read_json_version "$manifest")"

  if [ -z "$old_version" ] || [ -z "$new_version" ]; then
    echo "::error file=${manifest}::Could not read package versions for ${package_name}."
    failures=1
    return 0
  fi

  if [ "$old_version" = "$new_version" ]; then
    echo "::error file=${manifest}::${package_name} changed but version stayed at ${new_version}."
    failures=1
    return 0
  fi

  if ! version_is_greater "$old_version" "$new_version"; then
    echo "::error file=${manifest}::${package_name} version must increase (found ${old_version} -> ${new_version})."
    failures=1
    return 0
  fi

  echo "[package-version-discipline] ${package_name}: ${old_version} -> ${new_version}"
}

check_package "@enterpriseglue/shared" "packages/shared" "packages/shared/package.json"
check_package "@enterpriseglue/backend-host" "packages/backend-host" "packages/backend-host/package.json"
check_package "@enterpriseglue/frontend-host" "packages/frontend-host" "packages/frontend-host/package.json"
check_package "@enterpriseglue/enterprise-plugin-api" "packages/enterprise-plugin-api" "packages/enterprise-plugin-api/package.json"
check_package "@enterpriseglue/plugin-sdk" "packages/plugin-sdk" "packages/plugin-sdk/package.json"
check_package "@enterpriseglue/plugin-runtime" "packages/plugin-runtime" "packages/plugin-runtime/package.json"
check_package "@enterpriseglue/plugin-installer" "packages/plugin-installer" "packages/plugin-installer/package.json"
check_package "@enterpriseglue/plugin-manager" "packages/plugin-manager" "packages/plugin-manager/package.json"

if [ "$changed_count" -eq 0 ]; then
  echo "[package-version-discipline] No relevant published OSS package changes detected."
  exit 0
fi

if [ "$failures" -ne 0 ]; then
  echo "[package-version-discipline] Failing because published OSS package changes were not versioned correctly." >&2
  exit 1
fi

echo "[package-version-discipline] Published OSS package version discipline passed."
