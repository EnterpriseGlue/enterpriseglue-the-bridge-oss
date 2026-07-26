#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${LOCAL_LDAP_APP_URL:-https://localhost:5443}"
ca_file="${LOCAL_LDAP_APP_CA_FILE:-.local/docker/keycloak-tls/ca.crt}"
provider_key="${LOCAL_LDAP_PROVIDER_KEY:-local-openldap}"
directory_host="${LOCAL_LDAP_DIRECTORY_HOST:-host.docker.internal}"
secret_dir="${LOCAL_LDAP_SECRET_DIR:-.local/docker/identity-secrets}"
secret_dir_mode="${LOCAL_LDAP_SECRET_DIRECTORY_MODE:-700}"
secret_file_mode="${LOCAL_LDAP_SECRET_FILE_MODE:-600}"
container_secret_root="${LOCAL_LDAP_CONTAINER_SECRET_ROOT:-/etc/enterpriseglue/local-identity-secrets}"
admin_email="${LOCAL_LDAP_ADMIN_EMAIL:-}"
admin_password="${LOCAL_LDAP_ADMIN_PASSWORD:-}"

is_local_https_url() {
  node --input-type=module - "$1" <<'NODE'
const value = process.argv[2];
try {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.local');
  process.exit(local && url.protocol === 'https:' ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

is_local_directory_host() {
  [[ "$1" == 'host.docker.internal' || "$1" == 'localhost' || "$1" == '127.0.0.1' || "$1" == '::1' || "$1" == *.local ]]
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
  echo 'Set LOCAL_LDAP_ADMIN_EMAIL and LOCAL_LDAP_ADMIN_PASSWORD for an existing local platform administrator.' >&2
  exit 2
fi

if ! is_local_https_url "$base_url"; then
  echo 'LOCAL_LDAP_APP_URL must target localhost, loopback, or a .local HTTPS host.' >&2
  exit 2
fi
if ! is_local_directory_host "$directory_host"; then
  echo 'LOCAL_LDAP_DIRECTORY_HOST must be a Docker-local or loopback host.' >&2
  exit 2
fi
if [[ ! -f "$ca_file" || -z "${EG_LDAP_TEST_CA_CERT_PATH:-}" || ! -f "$EG_LDAP_TEST_CA_CERT_PATH" || -z "${EG_LDAP_TEST_URL:-}" || -z "${EG_LDAP_TEST_BIND_DN:-}" || -z "${EG_LDAP_TEST_ADMIN_PASSWORD:-}" ]]; then
  echo 'The disposable LDAPS fixture is not available. Run this through test:ldap:local-rehearsal.' >&2
  exit 2
fi

if [[ ! "$secret_dir_mode" =~ ^(700|750|755)$ ]] || [[ ! "$secret_file_mode" =~ ^(600|640|644)$ ]]; then
  echo 'LOCAL_LDAP_SECRET_DIRECTORY_MODE must be 700, 750, or 755 and LOCAL_LDAP_SECRET_FILE_MODE must be 600, 640, or 644.' >&2
  exit 2
fi

ldap_port="$(node --input-type=module - "$EG_LDAP_TEST_URL" <<'NODE'
const url = new URL(process.argv[2]);
if (url.protocol !== 'ldaps:' || !url.port) process.exit(1);
process.stdout.write(url.port);
NODE
)"

mkdir -p "$secret_dir"
chmod "$secret_dir_mode" "$secret_dir"
cp "$EG_LDAP_TEST_CA_CERT_PATH" "$secret_dir/local-openldap-ca.crt"
chmod "$secret_file_mode" "$secret_dir/local-openldap-ca.crt"
printf '%s' "$EG_LDAP_TEST_ADMIN_PASSWORD" > "$secret_dir/local-openldap-bind-password"
chmod "$secret_file_mode" "$secret_dir/local-openldap-bind-password"

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
  --arg url "ldaps://${directory_host}:${ldap_port}" \
  --arg bindDn "$EG_LDAP_TEST_BIND_DN" \
  --arg bindPasswordRef "file://${container_secret_root}/local-openldap-bind-password" \
  --arg tlsTrustRef "file://${container_secret_root}/local-openldap-ca.crt" \
  '{key:$key,protocol:"ldap",isEnabled:true,authenticationMode:"direct",configuration:{url:$url,bindDn:$bindDn,bindPasswordRef:$bindPasswordRef,userBaseDn:"ou=people,dc=identity-mock,dc=test",userSearchFilter:"(&(mail={username})(employeeType=active))",userEnumerationFilter:"(&(objectClass=inetOrgPerson)(employeeType=active))",pageSize:1,groupBaseDn:"ou=groups,dc=identity-mock,dc=test",groupIdAttribute:"businessCategory",membershipMode:"group_search",nestedGroups:true,tlsTrustRef:$tlsTrustRef,allowVerifiedEmailLinking:true},sync:{connectorCapability:"ldap_directory"}}')"
all_cookies="$session_cookies;$csrf_cookie"
provider_status="$(curl "${curl_args[@]}" --output /dev/null --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --header "Cookie: $all_cookies" \
  --header "X-CSRF-Token: $csrf_token" \
  --data "$provider_payload" \
  "$base_url/api/identity/providers")"

if [[ "$provider_status" != '200' && "$provider_status" != '201' ]]; then
  echo "Local LDAP provider configuration failed (HTTP $provider_status)." >&2
  exit 1
fi

connection_status="$(curl "${curl_args[@]}" --output /dev/null --write-out '%{http_code}' \
  --request POST \
  --header "Cookie: $all_cookies" \
  --header "X-CSRF-Token: $csrf_token" \
  "$base_url/api/identity/providers/$provider_key/test-connection")"

if [[ "$connection_status" != '200' ]]; then
  echo 'Local LDAP provider connection test failed.' >&2
  exit 1
fi

echo "Configured and connection-tested local LDAP provider '$provider_key'."
