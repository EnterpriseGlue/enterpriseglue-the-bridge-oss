#!/usr/bin/env bash
set -euo pipefail

# Starts a short-lived, TLS-verified LDAP directory for an explicitly supplied
# test command. The generated CA, bind password, user password, host port, and
# Compose project name never enter the repository or normal test environment.

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$root_dir/test/identity-mocks/docker-compose.ldap.yml"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/enterpriseglue-ldap-protocol.XXXXXX")"
project="enterpriseglue-ldap-$RANDOM-$RANDOM"
domain="identity-mock.test"
base_dn="dc=identity-mock,dc=test"
bind_dn="cn=admin,$base_dn"

random_secret() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))"
}

cleanup() {
  docker compose -p "$project" -f "$compose_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

export EG_LDAP_TEST_DOMAIN="$domain"
export EG_LDAP_TEST_ADMIN_PASSWORD="$(random_secret)"
export EG_LDAP_TEST_CONFIG_PASSWORD="$(random_secret)"
export EG_LDAP_TEST_CERT_DIR="$tmp_dir"
export EG_LDAP_TEST_USER_PASSWORD="$(random_secret)"
export EG_LDAP_TEST_SECOND_USER_PASSWORD="$(random_secret)"

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 \
  -keyout "$tmp_dir/ldap.key" -out "$tmp_dir/ldap.crt" \
  -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' >/dev/null 2>&1
chmod 600 "$tmp_dir/ldap.key"

if ! docker compose -p "$project" -f "$compose_file" up --detach --wait; then
  docker compose -p "$project" -f "$compose_file" logs --no-color >&2 || true
  exit 1
fi

for _attempt in $(seq 1 30); do
  if docker compose -p "$project" -f "$compose_file" exec -T openldap \
    env LDAPTLS_REQCERT=never ldapsearch -x -H ldaps://localhost -b '' -s base >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker compose -p "$project" -f "$compose_file" exec -T openldap \
  env LDAPTLS_REQCERT=never ldapsearch -x -H ldaps://localhost -b '' -s base >/dev/null; then
  echo 'LDAP test harness did not expose LDAPS before the timeout.' >&2
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
uid: alice
cn: Alice Protocol Test
sn: Protocol Test
givenName: Alice
mail: alice@identity-mock.test
userPassword: $EG_LDAP_TEST_USER_PASSWORD

dn: uid=bob,ou=people,$base_dn
objectClass: inetOrgPerson
uid: bob
cn: Bob Protocol Test
sn: Protocol Test
givenName: Bob
mail: bob@identity-mock.test
userPassword: $EG_LDAP_TEST_SECOND_USER_PASSWORD

dn: ou=groups,$base_dn
objectClass: organizationalUnit
ou: groups

dn: cn=operations,ou=groups,$base_dn
objectClass: groupOfNames
objectClass: extensibleObject
cn: operations
businessCategory: group-id-operations
member: uid=alice,ou=people,$base_dn

dn: cn=platform-operators,ou=groups,$base_dn
objectClass: groupOfNames
objectClass: extensibleObject
cn: platform-operators
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
export EG_LDAP_TEST_CA_CERT_PATH="$tmp_dir/ldap.crt"
export EG_LDAP_TEST_CA_CERTIFICATE="$(<"$tmp_dir/ldap.crt")"

if [[ "$#" -eq 0 ]]; then
  echo 'LDAP protocol fixture is healthy and seeded. Pass a command to exercise it with the exported EG_LDAP_TEST_* inputs.'
  exit 0
fi

if ! "$@"; then
  docker compose -p "$project" -f "$compose_file" logs --no-color >&2 || true
  exit 1
fi
