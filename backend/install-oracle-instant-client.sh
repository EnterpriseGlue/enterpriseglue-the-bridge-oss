#!/bin/sh
set -eu
# Oracle-published 23.26.3 Basic archives. Retain BASIC_LICENSE and BASIC_README.
case "${1:?target architecture required}" in
  amd64)
    archive=instantclient-basic-linux.x64-23.26.3.0.0.zip
    checksum=fce485361332927f8328ea4b68d98968c6b0ea124e62470de8c9d0cef880130e ;;
  arm64)
    archive=instantclient-basic-linux.arm64-23.26.3.0.0.zip
    checksum=74b0744d7bf1be28f60c3d90a135e5d9aaca1946bab0adcc0c8db5fbc2cc9758 ;;
  *) echo 'Oracle image supports only amd64 and arm64' >&2; exit 1 ;;
esac
curl --fail --location --retry 3 --silent --show-error \
  "https://download.oracle.com/otn_software/linux/instantclient/2326300/$archive" \
  -o /tmp/oracle-client.zip
printf '%s  %s\n' "$checksum" /tmp/oracle-client.zip | sha256sum --check --strict
mkdir -p /opt/oracle
unzip -q /tmp/oracle-client.zip 'instantclient_23_26/*' -d /opt/oracle
rm /tmp/oracle-client.zip
test -f /opt/oracle/instantclient_23_26/BASIC_LICENSE
test -f /opt/oracle/instantclient_23_26/libclntsh.so.23.1
