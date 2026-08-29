#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_REF="${1:-}"
RELEASE_TAG="${2:-}"
OUTPUT_DIR="${3:-}"
CANDIDATE_REPOSITORY="${EG_RELEASE_CANDIDATE_REPOSITORY:-ghcr.io/enterpriseglue/enterpriseglue-oss-release-candidate}"

[[ "$SOURCE_REF" =~ ^[0-9a-f]{40}$ ]] || {
  echo "usage: fetch-release-candidate.sh <source-ref> <vX.Y.Z> <output-directory>" >&2
  exit 1
}
[[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ -n "$OUTPUT_DIR" ]]

mkdir -p "$OUTPUT_DIR"
[[ -z "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]] || {
  echo "Candidate output directory must be empty: $OUTPUT_DIR" >&2
  exit 1
}

tag="sha-$SOURCE_REF"
digest="$(oras resolve "$CANDIDATE_REPOSITORY:$tag")"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]
subject="$CANDIDATE_REPOSITORY@$digest"
cosign verify \
  --certificate-identity "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/.github/workflows/release-candidate-stage.yml@refs/heads/main" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$subject" >/dev/null
oras pull "$subject" --output "$OUTPUT_DIR"
node "$ROOT_DIR/scripts/release-candidate-receipt.mjs" verify \
  --receipt "$OUTPUT_DIR/release-candidate.json" \
  --artifacts "$OUTPUT_DIR" \
  --source-ref "$SOURCE_REF" \
  --release-tag "$RELEASE_TAG" >/dev/null

printf '%s\n' "$subject"
