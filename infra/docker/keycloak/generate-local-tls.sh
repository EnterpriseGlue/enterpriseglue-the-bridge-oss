#!/usr/bin/env bash
set -Eeuo pipefail

output_dir="${KEYCLOAK_TLS_DIR:-.local/docker/keycloak-tls}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate disposable local TLS material." >&2
  exit 2
fi

mkdir -p "$output_dir"
chmod 700 "$output_dir"

if [[ -f "$output_dir/ca.crt" && -f "$output_dir/server.crt" && -f "$output_dir/server.key" ]] \
  && openssl x509 -checkend 0 -noout -in "$output_dir/server.crt" >/dev/null 2>&1 \
  && openssl verify -CAfile "$output_dir/ca.crt" "$output_dir/server.crt" >/dev/null 2>&1; then
  echo "Reusing existing disposable local TLS material in $output_dir"
  exit 0
fi

rm -f "$output_dir/ca.key" "$output_dir/ca.crt" "$output_dir/server.key" "$output_dir/server.csr" "$output_dir/server.crt"

openssl req -x509 -new -nodes -newkey rsa:2048 -sha256 -days 7 \
  -subj '/CN=EnterpriseGlue local OIDC test CA' \
  -keyout "$output_dir/ca.key" \
  -out "$output_dir/ca.crt" >/dev/null 2>&1

openssl req -new -nodes -newkey rsa:2048 -sha256 \
  -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost' \
  -keyout "$output_dir/server.key" \
  -out "$output_dir/server.csr" >/dev/null 2>&1

openssl x509 -req -sha256 -days 7 \
  -in "$output_dir/server.csr" \
  -CA "$output_dir/ca.crt" \
  -CAkey "$output_dir/ca.key" \
  -CAcreateserial \
  -copy_extensions copy \
  -out "$output_dir/server.crt" >/dev/null 2>&1

rm -f "$output_dir/server.csr" "$output_dir/ca.srl"
chmod 600 "$output_dir/ca.key" "$output_dir/server.key"
chmod 644 "$output_dir/ca.crt" "$output_dir/server.crt"
echo "Generated disposable local TLS material in $output_dir"
