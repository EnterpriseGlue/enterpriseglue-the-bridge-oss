#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-}"
record="${2:-}"
phase="${3:-result}"
repository="${EG_PUBLICATION_REPOSITORY:-ghcr.io/enterpriseglue/enterpriseglue-oss-release-publication}"
identity_prefix="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY"
identity_prefix="${identity_prefix//./\\.}"
identity_pattern="^$identity_prefix/\\.github/workflows/(release-please|release-publication-reconcile)\\.yml@refs/heads/main$"
if [[ "$repository" != ghcr.io/enterpriseglue/enterpriseglue-oss-release-publication ]]; then
  [[ "${EG_PUBLICATION_CANARY:-false}" == true ]]
  [[ "$repository" == ghcr.io/enterpriseglue/enterpriseglue-release-canary-publication ]]
  [[ "$GITHUB_WORKFLOW" == 'Release Canary' ]]
  identity_pattern="^$identity_prefix/\\.github/workflows/release-canary\\.yml@refs/heads/.*$"
else
  [[ "$GITHUB_REF" == refs/heads/main ]]
fi
resolve_existing() {
  local reference="$1" error_file result
  error_file="$(mktemp)"
  if result="$(oras resolve "$reference" 2>"$error_file")"; then
    rm -f "$error_file"
    printf '%s\n' "$result"
  elif grep -Eqi 'manifest unknown|MANIFEST_UNKNOWN|404 Not Found|NAME_UNKNOWN' "$error_file" ||
    grep -Fxq "Error response from registry: failed to resolve digest: $reference: not found" "$error_file"; then
    rm -f "$error_file"
  else
    cat "$error_file" >&2
    rm -f "$error_file"
    return 1
  fi
}
verify_subject() {
  cosign verify --certificate-identity-regexp "$identity_pattern" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com "$1" >/dev/null
}
if [[ "$mode" == load ]]; then
  source_ref="$record"
  [[ "$source_ref" =~ ^[0-9a-f]{40}$ ]]
  output="$phase"
  mkdir -p "$output"
  [[ -z "$(find "$output" -mindepth 1 -maxdepth 1 -print -quit)" ]]
  digest="$(oras resolve "$repository:identity-sha-$source_ref")"
  verify_subject "$repository@$digest"
  oras pull "$repository@$digest" --output "$output" >&2
  node "$root/scripts/release-publication-record.mjs" verify --record "$output/publication.json"
  [[ "$(jq -r '.identity.sourceRef' "$output/publication.json")" == "$source_ref" ]]
elif [[ "$mode" == save ]]; then
  node "$root/scripts/release-publication-record.mjs" verify --record "$record"
  if [[ "$repository" == ghcr.io/enterpriseglue/enterpriseglue-oss-release-publication ]]; then
    jq -e '.canary == null' "$record" >/dev/null
  else
    jq -e '.canary.fixture == true and .canary.publicationPerformed == false' "$record" >/dev/null
  fi
  source_ref="$(jq -er '.identity.sourceRef' "$record")"
  [[ "$phase" =~ ^[a-z0-9-]+$ ]]
  [[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  cp "$record" "$work/publication.json"
  tag="identity-sha-$source_ref"
  digest="$(resolve_existing "$repository:$tag")"
  if [[ -n "$digest" ]]; then
    verify_subject "$repository@$digest"
    mkdir -p "$work/existing"
    oras pull "$repository@$digest" --output "$work/existing" >&2
    node "$root/scripts/release-publication-record.mjs" compare --existing "$work/existing/publication.json" --proposed "$record"
  else
    # The identity is write-once. Observation attempts have separate immutable tags.
    (cd "$work" && oras push "$repository:$tag" --artifact-type application/vnd.enterpriseglue.release-publication.v1 \
      publication.json:application/vnd.enterpriseglue.release-publication.v1+json >&2)
    digest="$(oras resolve "$repository:$tag")"
    cosign sign --yes --registry-referrers-mode=oci-1-1 "$repository@$digest" >&2
    verify_subject "$repository@$digest"
  fi
  if [[ "$phase" == pre-tag ]]; then
    jq '.state = "publishing"' "$work/publication.json" > "$work/publishing.json"
    mv "$work/publishing.json" "$work/publication.json"
  fi
  attempt_tag="attempt-sha-$source_ref-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$phase"
  existing="$(resolve_existing "$repository:$attempt_tag")"
  if [[ -n "$existing" ]]; then
    verify_subject "$repository@$existing"
    mkdir -p "$work/attempt"
    oras pull "$repository@$existing" --output "$work/attempt" >&2
    cmp "$work/publication.json" "$work/attempt/publication.json"
  else
    (cd "$work" && oras push "$repository:$attempt_tag" --artifact-type application/vnd.enterpriseglue.release-publication.v1 \
      publication.json:application/vnd.enterpriseglue.release-publication.v1+json >&2)
    existing="$(oras resolve "$repository:$attempt_tag")"
    cosign sign --yes --registry-referrers-mode=oci-1-1 "$repository@$existing" >&2
    verify_subject "$repository@$existing"
  fi
  printf '%s\n' "$repository@$existing"
else
  echo 'Usage: release-publication-record-store.sh save <record> [phase] | load <source-sha> <empty-output-directory>' >&2
  exit 1
fi
