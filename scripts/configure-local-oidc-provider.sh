#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${LOCAL_OIDC_APP_URL:-https://localhost:5443}"
issuer_url="${LOCAL_OIDC_ISSUER_URL:-https://localhost:8180/realms/enterpriseglue-local}"
provider_key="${LOCAL_OIDC_PROVIDER_KEY:-local-keycloak-oidc}"
client_id="${LOCAL_OIDC_CLIENT_ID:-enterpriseglue-local}"
callback_url="${LOCAL_OIDC_CALLBACK_URL:-${base_url%/}/api/auth/identity/callback}"
ca_file="${LOCAL_OIDC_CA_FILE:-.local/docker/keycloak-tls/ca.crt}"
admin_email="${LOCAL_OIDC_ADMIN_EMAIL:-}"
admin_password="${LOCAL_OIDC_ADMIN_PASSWORD:-}"

is_local_url() {
  node --input-type=module - "$1" <<'NODE'
const value = process.argv[2];
try {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.local');
  process.exit(local ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

require_https_local_url() {
  local value="$1"
  local label="$2"
  if ! is_local_url "$value"; then
    echo "$label must target localhost, loopback, or a .local host; got: $value" >&2
    exit 2
  fi
  if [[ "$value" != https://* ]]; then
    echo "$label must use HTTPS; got: $value" >&2
    exit 2
  fi
}

cookie_values() {
  awk '
    tolower($0) ~ /^set-cookie:/ {
      value = $0
      sub(/^[^:]*:[[:space:]]*/, "", value)
      sub(/;.*/, "", value)
      if (value ~ /^(accessToken|refreshToken|csrf_secret)=/) print value
    }'
}

header_value() {
  local header="$1"
  awk -v expected="$header" '
    tolower($0) ~ "^" tolower(expected) ":[[:space:]]*" {
      value = $0
      sub(/^[^:]*:[[:space:]]*/, "", value)
      sub(/\r$/, "", value)
      print value
      exit
    }'
}

if [[ -z "$admin_email" || -z "$admin_password" ]]; then
  echo "Set LOCAL_OIDC_ADMIN_EMAIL and LOCAL_OIDC_ADMIN_PASSWORD for an existing local platform administrator." >&2
  exit 2
fi

require_https_local_url "$base_url" 'LOCAL_OIDC_APP_URL'
require_https_local_url "$issuer_url" 'LOCAL_OIDC_ISSUER_URL'
require_https_local_url "$callback_url" 'LOCAL_OIDC_CALLBACK_URL'

if [[ ! -f "$ca_file" ]]; then
  echo "LOCAL_OIDC_CA_FILE does not exist: $ca_file" >&2
  exit 2
fi

curl_args=(--fail --silent --show-error --max-time 15 --cacert "$ca_file")
login_payload="$(jq -nc --arg email "$admin_email" --arg password "$admin_password" '{email:$email,password:$password}')"
login_headers="$(curl "${curl_args[@]}" --dump-header - --output /dev/null --header 'Content-Type: application/json' --data "$login_payload" "$base_url/api/auth/login")"
session_cookies="$(printf '%s\n' "$login_headers" | cookie_values | paste -sd ';' -)"

if [[ -z "$session_cookies" || "$session_cookies" != *'accessToken='* ]]; then
  echo 'Local administrator login did not establish an access session.' >&2
  exit 1
fi

csrf_headers="$(curl "${curl_args[@]}" --dump-header - --output /dev/null --header "Cookie: $session_cookies" "$base_url/api/csrf-token")"
csrf_token="$(printf '%s\n' "$csrf_headers" | header_value 'x-csrf-token')"
csrf_cookie="$(printf '%s\n' "$csrf_headers" | cookie_values | awk '/^csrf_secret=/{print; exit}')"

if [[ -z "$csrf_token" || -z "$csrf_cookie" ]]; then
  echo 'Unable to obtain the local CSRF token required for provider configuration.' >&2
  exit 1
fi

provider_payload="$(jq -nc \
  --arg key "$provider_key" \
  --arg issuerUrl "$issuer_url" \
  --arg clientId "$client_id" \
  --arg callbackUrl "$callback_url" \
  '{key:$key,protocol:"oidc",isEnabled:true,authenticationMode:"direct",configuration:{issuerUrl:$issuerUrl,clientId:$clientId,callbackUrl:$callbackUrl,scopes:["openid","profile","email"],groupClaim:"groups",expectedAudience:$clientId,allowVerifiedEmailLinking:true},sync:{triggers:["login","manual"],requiredForLogin:true,incompleteEntitlements:"fail_closed",connectorCapability:"claim_only",scheduled:false}}')"
all_cookies="$session_cookies;$csrf_cookie"
provider_status="$(curl "${curl_args[@]}" --output /dev/null --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --header "Cookie: $all_cookies" \
  --header "X-CSRF-Token: $csrf_token" \
  --data "$provider_payload" \
  "$base_url/api/identity/providers")"

if [[ "$provider_status" != '200' && "$provider_status" != '201' ]]; then
  echo "Local OIDC provider configuration failed (HTTP $provider_status)." >&2
  exit 1
fi

connection_status="$(curl "${curl_args[@]}" --output /dev/null --write-out '%{http_code}' \
  --request POST \
  --header "Cookie: $all_cookies" \
  --header "X-CSRF-Token: $csrf_token" \
  "$base_url/api/identity/providers/$provider_key/test-connection")"

if [[ "$connection_status" != '200' ]]; then
  echo "Local OIDC provider connection test failed (HTTP $connection_status)." >&2
  exit 1
fi

echo "Configured and connection-tested local OIDC provider '$provider_key'."
