#!/usr/bin/env bash
set -Eeuo pipefail

# Runs the ordinary localhost OIDC browser rehearsal with a separate Keycloak
# client whose claims intentionally resemble Entra ID: immutable group IDs,
# tenant/object IDs, and an app role. This is a compatibility profile, not a
# claim that Keycloak emulates Microsoft Entra ID.

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export LOCAL_OIDC_PROVIDER_KEY="${LOCAL_ENTRA_OIDC_PROVIDER_KEY:-local-keycloak-entra}"
export LOCAL_OIDC_CLIENT_ID="${LOCAL_ENTRA_OIDC_CLIENT_ID:-enterpriseglue-local-entra}"
export LOCAL_OIDC_TEST_USERNAME="${LOCAL_ENTRA_OIDC_TEST_USERNAME:-entra-operator}"
export LOCAL_OIDC_TEST_PASSWORD="${LOCAL_ENTRA_OIDC_TEST_PASSWORD:-local-entra-operator}"
export LOCAL_OIDC_ENTITLEMENT_TYPE="${LOCAL_ENTRA_OIDC_ENTITLEMENT_TYPE:-role}"
export LOCAL_OIDC_ENTITLEMENT_ID="${LOCAL_ENTRA_OIDC_ENTITLEMENT_ID:-enterpriseglue.engine_operator}"
export LOCAL_OIDC_DIRECTORY_TENANT_ID="${LOCAL_ENTRA_OIDC_DIRECTORY_TENANT_ID:-11111111-2222-3333-4444-555555555555}"

exec "$root_dir/scripts/run-local-oidc-rehearsal-test.sh" "$@"
