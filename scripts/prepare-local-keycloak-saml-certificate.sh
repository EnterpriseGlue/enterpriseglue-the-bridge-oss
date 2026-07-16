#!/usr/bin/env bash
set -Eeuo pipefail

issuer_url="${LOCAL_SAML_ISSUER_URL:-https://localhost:8180/realms/enterpriseglue-local}"
metadata_url="${LOCAL_SAML_METADATA_URL:-${issuer_url%/}/protocol/saml/descriptor}"
ca_file="${LOCAL_SAML_CA_FILE:-.local/docker/keycloak-tls/ca.crt}"
certificate_file="${LOCAL_SAML_SIGNING_CERT_FILE:-.local/docker/identity-secrets/keycloak-saml-signing.crt}"

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

if ! is_local_https_url "$issuer_url" || ! is_local_https_url "$metadata_url"; then
  echo 'The local SAML certificate helper accepts only localhost, loopback, or .local HTTPS issuer and metadata URLs.' >&2
  exit 2
fi

if [[ ! -f "$ca_file" ]]; then
  echo "LOCAL_SAML_CA_FILE does not exist: $ca_file" >&2
  exit 2
fi

mkdir -p "$(dirname "$certificate_file")"
chmod 700 "$(dirname "$certificate_file")"

curl --fail --silent --show-error --max-time 15 --cacert "$ca_file" "$metadata_url" \
  | node --input-type=module -e '
    import { X509Certificate } from "node:crypto";
    import { mkdirSync, writeFileSync } from "node:fs";
    import { dirname } from "node:path";

    const destination = process.argv[1];
    const metadata = await new Promise((resolve, reject) => {
      let body = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { body += chunk; });
      process.stdin.once("end", () => resolve(body));
      process.stdin.once("error", reject);
    });
    const match = String(metadata).match(/<(?:[A-Za-z0-9_-]+:)?X509Certificate\b[^>]*>\s*([^<\s][^<]*?)\s*<\/(?:[A-Za-z0-9_-]+:)?X509Certificate>/i);
    if (!match) throw new Error("SAML metadata did not contain an IdP signing certificate");
    const certificate = match[1].replace(/\s+/g, "");
    const pem = `-----BEGIN CERTIFICATE-----\n${certificate.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
    new X509Certificate(pem);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, pem, { mode: 0o600 });
  ' "$certificate_file"

echo "Wrote the disposable local Keycloak SAML signing certificate to $certificate_file."
