#!/usr/bin/env bash
set -euo pipefail

subject="${1:-}"
identity="${2:-}"
[[ $# == 2 && "$subject" =~ ^ghcr\.io/enterpriseglue/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ && -n "$identity" ]] || {
  echo 'Expected an immutable EnterpriseGlue OCI subject and its GitHub workflow identity.' >&2
  exit 1
}

export COSIGN_EXPERIMENTAL=1
sign_error="$(mktemp)"
verify_error="$(mktemp)"
trap 'rm -f -- "$sign_error" "$verify_error"' EXIT

sign_subject() {
  cosign sign --yes --registry-referrers-mode=oci-1-1 "$subject" 2>"$sign_error"
}

verify_subject() {
  cosign verify --certificate-identity "$identity" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    "$subject" >/dev/null 2>"$verify_error"
}

signature_missing() {
  local detail
  detail="$(<"$verify_error")"
  [[ "$detail" == 'error during command execution: no signatures found' ||
     "$detail" == $'Error: no signatures found\nerror during command execution: no signatures found' ]]
}

if ! sign_subject; then
  cat "$sign_error" >&2
  # A duplicate log entry is not a registry signature. Reuse proof only when
  # the exact subject verifies, or start one fresh signing process if absent.
  grep -Fq "Error: signing [$subject]: signing digest: signing bundle: error signing bundle: [POST /api/v1/log/entries][409] createLogEntryConflict " "$sign_error" || exit 1
  if verify_subject; then exit 0; fi
  if ! signature_missing; then cat "$verify_error" >&2; exit 1; fi
  sleep 2
  if ! sign_subject; then cat "$sign_error" >&2; exit 1; fi
fi

if verify_subject; then exit 0; fi
if signature_missing; then
  sleep 2
  if verify_subject; then exit 0; fi
fi
cat "$verify_error" >&2
exit 1
