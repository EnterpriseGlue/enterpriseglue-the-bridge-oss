#!/usr/bin/env bash
set -euo pipefail

# Starts a short-lived, TLS-verified LDAP directory for an explicitly supplied
# test command. The generated CA, bind password, user password, host port, and
# Compose project name never enter the repository or normal test environment.

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$root_dir/test/identity-mocks/docker-compose.ldap.yml"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/enterpriseglue-ldap-protocol.XXXXXX")"
container_cert_dir="$tmp_dir/server-certs"
client_ca_cert="$tmp_dir/ldap-client-ca.crt"
project="enterpriseglue-ldap-$RANDOM-$RANDOM"
domain="identity-mock.test"
base_dn="dc=identity-mock,dc=test"
bind_dn="cn=admin,$base_dn"
ready_timeout_seconds="${EG_LDAP_TEST_READY_TIMEOUT_SECONDS:-90}"
docker_network="${EG_LDAP_TEST_DOCKER_NETWORK:-}"
docker_network_alias="${EG_LDAP_TEST_DOCKER_ALIAS:-openldap}"

if ! [[ "$ready_timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo 'EG_LDAP_TEST_READY_TIMEOUT_SECONDS must be a positive whole number.' >&2
  exit 2
fi

random_secret() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))"
}

cleanup() {
  # The upstream OpenLDAP image adjusts ownership of its mounted certificate
  # directory. Restore the host runner's ownership before Compose removes the
  # container so this disposable directory never becomes an undeletable CI
  # artifact on Linux.
  docker compose -p "$project" -f "$compose_file" exec -T --user root openldap \
    sh -c "chown -R $(id -u):$(id -g) /container/service/slapd/assets/certs" >/dev/null 2>&1 || true
  docker compose -p "$project" -f "$compose_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

export EG_LDAP_TEST_DOMAIN="$domain"
export EG_LDAP_TEST_ADMIN_PASSWORD="$(random_secret)"
export EG_LDAP_TEST_CONFIG_PASSWORD="$(random_secret)"
mkdir -p "$container_cert_dir"
export EG_LDAP_TEST_CERT_DIR="$container_cert_dir"
export EG_LDAP_TEST_USER_PASSWORD="$(random_secret)"
export EG_LDAP_TEST_SECOND_USER_PASSWORD="$(random_secret)"
export EG_LDAP_TEST_DISABLED_USER_PASSWORD="$(random_secret)"
export EG_LDAP_TEST_BROWSER_USER_PASSWORD="$(random_secret)"

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 \
  -keyout "$container_cert_dir/ldap.key" -out "$container_cert_dir/ldap.crt" \
  -subj '/CN=localhost' -addext "subjectAltName=DNS:localhost,DNS:host.docker.internal,DNS:${docker_network_alias},IP:127.0.0.1" >/dev/null 2>&1
chmod 600 "$container_cert_dir/ldap.key"
# Keep a host-owned client trust copy outside the mount that OpenLDAP mutates.
# It is a public CA certificate, but it remains private to this temporary run.
cp "$container_cert_dir/ldap.crt" "$client_ca_cert"
chmod 600 "$client_ca_cert"

if ! docker compose -p "$project" -f "$compose_file" up --detach --wait; then
  docker compose -p "$project" -f "$compose_file" logs --no-color >&2 || true
  exit 1
fi

# CI may run the application in a separate Compose project. Attach this
# disposable directory fixture directly to that project's network so the
# backend reaches LDAPS by service DNS rather than via a host-published port.
# Normal developer runs leave this unset and retain the loopback-only mapping.
if [[ -n "$docker_network" ]]; then
  ldap_container_id="$(docker compose -p "$project" -f "$compose_file" ps -q openldap)"
  if [[ -z "$ldap_container_id" ]] || ! docker network inspect "$docker_network" >/dev/null 2>&1; then
    echo 'LDAP test harness could not attach to the requested Docker network.' >&2
    exit 1
  fi
  if ! docker network connect --alias "$docker_network_alias" "$docker_network" "$ldap_container_id"; then
    echo 'LDAP test harness could not attach its fixture to the requested Docker network.' >&2
    exit 1
  fi
fi

for _attempt in $(seq 1 "$ready_timeout_seconds"); do
  if docker compose -p "$project" -f "$compose_file" exec -T openldap \
    env LDAPTLS_REQCERT=never ldapsearch -x -H ldaps://localhost -b '' -s base >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker compose -p "$project" -f "$compose_file" exec -T openldap \
  env LDAPTLS_REQCERT=never ldapsearch -x -H ldaps://localhost -b '' -s base >/dev/null; then
  echo "LDAP test harness did not expose LDAPS within ${ready_timeout_seconds} seconds." >&2
  docker compose -p "$project" -f "$compose_file" logs --no-color >&2 || true
  exit 1
fi

docker compose -p "$project" -f "$compose_file" exec -T openldap \
  ldapadd -x -H ldap://localhost -D "$bind_dn" -w "$EG_LDAP_TEST_ADMIN_PASSWORD" <<EOF
dn: ou=people,$base_dn
objectClass: organizationalUnit
ou: people

dn: uid=alice,ou=people,$base_dn
objectClass: inetOrgPerson
objectClass: extensibleObject
uid: alice
cn: Alice Protocol Test
sn: Protocol Test
givenName: Alice
mail: alice@identity-mock.test
employeeType: active
userPassword: $EG_LDAP_TEST_USER_PASSWORD

dn: uid=bob,ou=people,$base_dn
objectClass: inetOrgPerson
objectClass: extensibleObject
uid: bob
cn: Bob Protocol Test
sn: Protocol Test
givenName: Bob
mail: bob@identity-mock.test
employeeType: active
userPassword: $EG_LDAP_TEST_SECOND_USER_PASSWORD

dn: uid=disabled,ou=people,$base_dn
objectClass: inetOrgPerson
objectClass: extensibleObject
uid: disabled
cn: Disabled Protocol Test
sn: Protocol Test
givenName: Disabled
mail: disabled@identity-mock.test
employeeType: disabled
userPassword: $EG_LDAP_TEST_DISABLED_USER_PASSWORD

dn: uid=browser-login,ou=people,$base_dn
objectClass: inetOrgPerson
objectClass: extensibleObject
uid: browser-login
cn: Browser Login Rehearsal
sn: Rehearsal
givenName: Browser
mail: browser-login@identity-mock.test
employeeType: active
userPassword: $EG_LDAP_TEST_BROWSER_USER_PASSWORD

dn: ou=groups,$base_dn
objectClass: organizationalUnit
ou: groups

dn: cn=operations,ou=groups,$base_dn
objectClass: groupOfNames
objectClass: extensibleObject
cn: operations
businessCategory: group-id-operations
member: uid=alice,ou=people,$base_dn

dn: cn=platform-operators-renamed,ou=groups,$base_dn
objectClass: groupOfNames
objectClass: extensibleObject
cn: platform-operators-renamed
businessCategory: group-id-platform-operators
member: cn=operations,ou=groups,$base_dn
EOF

ldap_port="$(docker compose -p "$project" -f "$compose_file" port openldap 636 | sed -E 's/.*:([0-9]+)$/\1/')"
if [[ -z "$ldap_port" ]]; then
  echo 'LDAP test harness could not determine the published LDAPS port.' >&2
  exit 1
fi

export EG_LDAP_TEST_URL="ldaps://localhost:$ldap_port"
export EG_LDAP_TEST_BIND_DN="$bind_dn"
export EG_LDAP_TEST_USER_DN="uid=alice,ou=people,$base_dn"
export EG_LDAP_TEST_CA_CERT_PATH="$client_ca_cert"
export EG_LDAP_TEST_CA_CERTIFICATE="$(<"$client_ca_cert")"

if [[ "$#" -eq 0 ]]; then
  echo 'LDAP protocol fixture is healthy and seeded. Pass a command to exercise it with the exported EG_LDAP_TEST_* inputs.'
  exit 0
fi

if ! "$@"; then
  docker compose -p "$project" -f "$compose_file" logs --no-color >&2 || true
  exit 1
fi
