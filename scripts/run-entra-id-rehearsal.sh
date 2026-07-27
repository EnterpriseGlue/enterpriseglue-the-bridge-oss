#!/usr/bin/env bash
set -Eeuo pipefail

# This is deliberately opt-in. It signs in to Microsoft Entra ID and mutates
# the supplied EnterpriseGlue test environment only through its normal UI/API
# paths. It is never a production or customer-tenant runner.

if [[ "${ENTRA_ID_REHEARSAL_ENABLED:-false}" != 'true' ]]; then
  echo '[entra-id-rehearsal] Skipped. Set ENTRA_ID_REHEARSAL_ENABLED=true for a dedicated test tenant.'
  exit 0
fi

if [[ "${ENTRA_ID_REHEARSAL_TEST_TENANT:-false}" != 'true' ]]; then
  echo '[entra-id-rehearsal] ENTRA_ID_REHEARSAL_TEST_TENANT=true is required; production and customer tenants are prohibited.' >&2
  exit 2
fi

if [[ "${ENTRA_ID_REHEARSAL_ALLOW_EXTERNAL:-false}" != 'true' ]]; then
  echo '[entra-id-rehearsal] ENTRA_ID_REHEARSAL_ALLOW_EXTERNAL=true is required before contacting Microsoft Entra ID.' >&2
  exit 2
fi

required=(
  ENTRA_ID_REHEARSAL_BASE_URL
  ENTRA_ID_REHEARSAL_TENANT_ID
  ENTRA_ID_REHEARSAL_CLIENT_ID
  ENTRA_ID_REHEARSAL_PLATFORM_ADMIN_EMAIL
  ENTRA_ID_REHEARSAL_PLATFORM_ADMIN_PASSWORD
  ENTRA_ID_REHEARSAL_USERNAME
  ENTRA_ID_REHEARSAL_PASSWORD
  ENTRA_ID_REHEARSAL_ENGINE_BASE_URL
)
for variable in "${required[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "[entra-id-rehearsal] $variable is required when the rehearsal is enabled." >&2
    exit 2
  fi
done

if ! node --input-type=module - "$ENTRA_ID_REHEARSAL_BASE_URL" <<'NODE'
const value = process.argv[2];
let url;
try { url = new URL(value); } catch { process.exit(2); }
process.exit(url.protocol === 'https:' ? 0 : 2);
NODE
then
  echo '[entra-id-rehearsal] ENTRA_ID_REHEARSAL_BASE_URL must be an HTTPS dedicated test environment.' >&2
  exit 2
fi

headless_shell_path="$(pnpm exec playwright install chromium --dry-run 2>/dev/null | awk '/Chrome Headless Shell/{found=1; next} found && /Install location:/{sub(/^.*Install location:[[:space:]]*/, ""); print; exit}')"
if [[ -z "$headless_shell_path" ]] || [[ ! -d "$headless_shell_path" ]] || ! find "$headless_shell_path" -type f -name 'chrome-headless-shell*' -perm -111 -print -quit | grep -q .; then
  echo '[entra-id-rehearsal] Playwright Chromium is not installed. Run: pnpm exec playwright install chromium' >&2
  exit 2
fi

issuer_url="https://login.microsoftonline.com/${ENTRA_ID_REHEARSAL_TENANT_ID}/v2.0"

PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-1}" \
PLAYWRIGHT_BASE_URL="$ENTRA_ID_REHEARSAL_BASE_URL" \
PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${ENTRA_ID_REHEARSAL_IGNORE_HTTPS_ERRORS:-false}" \
E2E_SEED_USER=false \
ENTRA_ID_REHEARSAL_TEST_TENANT=true \
OIDC_REHEARSAL_ENABLED=true \
OIDC_REHEARSAL_PROFILE=entra-id \
OIDC_REHEARSAL_ADMIN_EMAIL="$ENTRA_ID_REHEARSAL_PLATFORM_ADMIN_EMAIL" \
OIDC_REHEARSAL_ADMIN_PASSWORD="$ENTRA_ID_REHEARSAL_PLATFORM_ADMIN_PASSWORD" \
OIDC_REHEARSAL_ISSUER_URL="$issuer_url" \
OIDC_REHEARSAL_CLIENT_ID="$ENTRA_ID_REHEARSAL_CLIENT_ID" \
OIDC_REHEARSAL_CLIENT_SECRET_REF="${ENTRA_ID_REHEARSAL_CLIENT_SECRET_REF:-}" \
OIDC_REHEARSAL_DIRECTORY_TENANT_ID="$ENTRA_ID_REHEARSAL_TENANT_ID" \
OIDC_REHEARSAL_SCOPES="${ENTRA_ID_REHEARSAL_SCOPES:-openid profile email}" \
OIDC_REHEARSAL_USERNAME="$ENTRA_ID_REHEARSAL_USERNAME" \
OIDC_REHEARSAL_PASSWORD="$ENTRA_ID_REHEARSAL_PASSWORD" \
OIDC_REHEARSAL_ENTITLEMENT_TYPE="${ENTRA_ID_REHEARSAL_ENTITLEMENT_TYPE:-role}" \
OIDC_REHEARSAL_ENTITLEMENT_ID="${ENTRA_ID_REHEARSAL_ENTITLEMENT_ID:-enterpriseglue.engine_operator}" \
OIDC_REHEARSAL_ENGINE_BASE_URL="$ENTRA_ID_REHEARSAL_ENGINE_BASE_URL" \
OIDC_REHEARSAL_ENGINE_TYPE="${ENTRA_ID_REHEARSAL_ENGINE_TYPE:-camunda7}" \
pnpm exec playwright test test/e2e/local-oidc-mapping-authorization.spec.ts --config test/e2e/playwright.config.ts "$@"
