#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_REF="${1:-}"
TRUSTED_REF="${2:-}"
RELEASE_TAG="${3:-}"
[[ "$SOURCE_REF" =~ ^[0-9a-f]{40}$ && "$TRUSTED_REF" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
[[ "$(git -C "$ROOT_DIR" rev-parse HEAD)" == "$TRUSTED_REF" ]] || exit 1
cd "$ROOT_DIR"

# The validator binds the candidate's only four changed release files to this
# protected source. Do not mislabel the checkout HEAD as the merge-group SHA.
OUTPUT_DIR="$ROOT_DIR/.artifacts/release-candidate-toolchain"
PAYLOAD_DIR="$ROOT_DIR/.artifacts/release-candidate-payload"
[[ -d "$PAYLOAD_DIR/packages/plugin" && -d "$PAYLOAD_DIR/packages/host" ]] || exit 1
mkdir -p "$ROOT_DIR/.artifacts"
# Refuse stale evidence rather than leaving a previous success after a retry.
mkdir "$OUTPUT_DIR"
hash_packages() {
  local plugin=("$PAYLOAD_DIR/packages/plugin/"*.tgz)
  local host=("$PAYLOAD_DIR/packages/host/"*.tgz)
  [[ "${#plugin[@]}" -eq 5 && "${#host[@]}" -eq 3 ]] || return 1
  local file digest
  for file in "${plugin[@]}" "${host[@]}"; do
    [[ -f "$file" ]] || return 1
    digest="$(shasum -a 256 "$file" | cut -d' ' -f1)"
    jq -nc --arg path "${file#"$PAYLOAD_DIR/"}" --arg sha256 "$digest" '{path:$path,sha256:$sha256}'
  done
}
hash_packages | jq -s 'sort_by(.path)' > "$OUTPUT_DIR/package-checksums.json"
jq -n --arg candidate "$SOURCE_REF" --arg trusted "$TRUSTED_REF" \
  --arg release "$RELEASE_TAG" --arg run "${GITHUB_RUN_ID:-local}" \
  --arg attempt "${GITHUB_RUN_ATTEMPT:-local}" \
  '{schemaVersion:"enterpriseglue-candidate-toolchain-rehearsal/v1",
    status:"started", sourceRevision:$candidate, trustedSourceRevision:$trusted,
    releaseTag:$release, runId:$run, runAttempt:$attempt,
    publicationPerformed:false}' > "$OUTPUT_DIR/execution.json"

# These are the same bounded commands used by source-level release readiness.
# Do not call that entire gate: candidate staging already built these packages
# and separately qualifies the exact application image digests.
node scripts/publish-plugin-package-set.mjs dry-run "$PAYLOAD_DIR/packages/plugin" \
  2> "$OUTPUT_DIR/plugin-package-dry-run.stderr.log" \
  | tee "$OUTPUT_DIR/plugin-package-dry-run.json"
node scripts/publish-host-package-set.mjs dry-run "$PAYLOAD_DIR/packages/host" \
  2> "$OUTPUT_DIR/host-package-dry-run.stderr.log" \
  | tee "$OUTPUT_DIR/host-package-dry-run.json"
pnpm run test:plugin-toolchain-release:local 2>&1 | tee "$OUTPUT_DIR/toolchain-local.log"
hash_packages | jq -s 'sort_by(.path)' > "$OUTPUT_DIR/package-checksums-after.json"
cmp "$OUTPUT_DIR/package-checksums.json" "$OUTPUT_DIR/package-checksums-after.json"

# Only a normally completed sequence writes passed. Failure/cancellation keeps
# started + partial logs; consumers must also require the workflow job success.
jq --slurpfile artifacts "$OUTPUT_DIR/package-checksums.json" \
  '.status="passed" | .artifacts=$artifacts[0] | .checks={pluginPackageDryRun:true,hostPackageDryRun:true,
  signatures:true,immutableRepull:true,tamperRejection:true,disconnectedImport:true}' \
  "$OUTPUT_DIR/execution.json" > "$OUTPUT_DIR/rehearsal.json"
# The existing signed OCI bundle includes all files below packages/charts, not
# just tarballs. Only deterministic proof belongs in the immutable bundle;
# invocation IDs and registry-dependent dry-run details stay in CI diagnostics.
jq 'del(.runId,.runAttempt)' "$OUTPUT_DIR/rehearsal.json" > "$PAYLOAD_DIR/packages/toolchain-rehearsal.json"
