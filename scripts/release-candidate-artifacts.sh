#!/usr/bin/env bash
# Sourced by protected staging/promotion jobs. Explicit returns are intentional:
# Bash does not reliably inherit errexit inside command substitutions/functions.

candidate_source_revision() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid candidate source revision' >&2; return 1; }
}

candidate_resolve_optional() {
  local reference="$1" digest errors status
  errors="$(mktemp "${RUNNER_TEMP:?}/candidate-resolve.XXXXXX")" || return 1
  if digest="$(oras resolve "$reference" 2>"$errors")"; then
    rm -- "$errors" || return 1
    [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
    printf '%s' "$digest"
  else
    status=$?
    # Only an explicit missing manifest permits creation. Authentication,
    # transport, and other registry failures must never authorize a push.
    if [[ "$(<"$errors")" == "Error response from registry: failed to resolve digest: $reference: not found" ]]; then
      rm -- "$errors" || return 1
      return 0
    fi
    cat "$errors" >&2
    rm -- "$errors" || return 1
    return "$status"
  fi
}

candidate_compare_chart() {
  local archive="$1" repository="$2" digest="$3" retain="${4:-false}" layer pulled
  [[ "$retain" == false || "$retain" == true ]] || return 1
  layer="$(oras manifest fetch "$repository@$digest" | jq -er '[.layers[] | select(.mediaType == "application/vnd.cncf.helm.chart.content.v1.tar+gzip") | .digest] | if length == 1 then .[0] else error("expected one chart layer") end')" || return 1
  [[ "$layer" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  pulled="$(mktemp "${RUNNER_TEMP:?}/candidate-chart.XXXXXX")" || return 1
  oras blob fetch --output "$pulled" "$repository@$layer" || return 1
  node scripts/helm-chart-archive.mjs compare "$archive" "$pulled" >&2 || return 1
  if [[ "$retain" == true ]]; then
    # The signed bundle must retain these exact OCI bytes, not an equivalent
    # local repack with different timestamps on a later retry.
    cp -- "$pulled" "$archive" || return 1
  fi
  rm -- "$pulled" || return 1
}

stage_chart() {
  local archive="$1" chart="$2" version="$3" repository public_repository existing public_digest digest
  candidate_source_revision "${SOURCE_REF:-}" || return 1
  case "$chart" in
    enterpriseglue-host|enterpriseglue-plugin-runtime|enterpriseglue-plugin-installer-rbac|enterpriseglue-plugin-manager) ;;
    *) echo 'Unexpected candidate chart name' >&2; return 1 ;;
  esac
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || return 1
  repository="ghcr.io/enterpriseglue/release-candidates/charts/$SOURCE_REF/$chart"
  public_repository="ghcr.io/enterpriseglue/charts/$chart"
  existing="$(candidate_resolve_optional "$repository:$version")" || return 1
  if [[ -n "$existing" ]]; then
    candidate_compare_chart "$archive" "$repository" "$existing" true || return 1
    digest="$existing"
  else
    public_digest="$(candidate_resolve_optional "$public_repository:$version")" || return 1
    if [[ -n "$public_digest" ]]; then
      # Preserve the public digest of an unchanged semantic version, including
      # its original archive metadata, rather than repacking a different digest.
      candidate_compare_chart "$archive" "$public_repository" "$public_digest" true || return 1
      oras cp -r "$public_repository@$public_digest" "$repository:$version" >&2 || return 1
    else
      helm push "$archive" "oci://${repository%/*}" >&2 || return 1
    fi
    digest="$(oras resolve "$repository:$version")" || return 1
    [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
    [[ -z "$public_digest" || "$digest" == "$public_digest" ]] || return 1
    candidate_compare_chart "$archive" "$repository" "$digest" true || return 1
  fi
  printf '%s@%s' "$repository" "$digest"
}

stage_image() {
  local tag="$1" dockerfile="$2" version="$3" digest
  candidate_source_revision "${SOURCE_REF:-}" || return 1
  case "$tag" in
    "ghcr.io/enterpriseglue/plugin-installer:$version-$SOURCE_REF"|"ghcr.io/enterpriseglue/plugin-manager:$version-$SOURCE_REF") ;;
    *) echo 'Unexpected candidate image reference' >&2; return 1 ;;
  esac
  digest="$(candidate_resolve_optional "$tag")" || return 1
  if [[ -z "$digest" ]]; then
    docker buildx build --pull --push --platform linux/amd64,linux/arm64 \
      --provenance=mode=max --sbom=true --file "$dockerfile" \
      --label "org.opencontainers.image.source=$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" \
      --label "org.opencontainers.image.revision=$SOURCE_REF" \
      --label "org.opencontainers.image.version=$version" --tag "$tag" . >&2 || return 1
    digest="$(oras resolve "$tag")" || return 1
  fi
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  printf '%s@%s' "${tag%:*}" "$digest"
}

candidate_chart_subject() {
  local receipt="$1" key="$2" chart source_revision subject
  case "$key" in
    hostChart) chart=enterpriseglue-host ;;
    runtimeChart) chart=enterpriseglue-plugin-runtime ;;
    installerRbacChart) chart=enterpriseglue-plugin-installer-rbac ;;
    managerChart) chart=enterpriseglue-plugin-manager ;;
    *) echo 'Unexpected candidate chart key' >&2; return 1 ;;
  esac
  source_revision="$(jq -er '.sourceRevision' "$receipt")" || return 1
  candidate_source_revision "$source_revision" || return 1
  subject="$(jq -er --arg key "$key" '.subjects[$key].subject' "$receipt")" || return 1
  [[ "${subject%@*}" == "ghcr.io/enterpriseglue/release-candidates/charts/$source_revision/$chart" ]] || return 1
  [[ "${subject##*@}" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$subject"
}
