#!/usr/bin/env bash
set -Eeuo pipefail

# Boots a fully disposable localhost stack for the real OIDC, SAML, and LDAP
# browser rehearsals. The generated environment, TLS keys, directory secrets,
# database volume, and containers are removed at the end of every invocation.
# Only diagnostic logs and Playwright output are retained under .artifacts/.

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_dir="${IDENTITY_PROTOCOL_REHEARSAL_ARTIFACT_DIR:-$root_dir/.artifacts/identity-protocol-rehearsal}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/enterpriseglue-identity-protocol-rehearsal.XXXXXX")"
env_file="$temp_dir/rehearsal.env"
tls_dir="$temp_dir/keycloak-tls"
identity_secret_dir="$temp_dir/identity-secrets"
realm_import_file="$temp_dir/enterpriseglue-local-realm.json"
playwright_output_dir="$temp_dir/playwright-results"
project_name="enterpriseglue-identity-protocol-${RANDOM}${RANDOM}"

free_loopback_port() {
  node --input-type=module <<'NODE'
import net from 'node:net';
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  process.stdout.write(String(address.port));
  server.close();
});
NODE
}

backend_port="${IDENTITY_PROTOCOL_REHEARSAL_BACKEND_PORT:-$(free_loopback_port)}"
frontend_port="${IDENTITY_PROTOCOL_REHEARSAL_FRONTEND_PORT:-$(free_loopback_port)}"
keycloak_port="${IDENTITY_PROTOCOL_REHEARSAL_KEYCLOAK_PORT:-$(free_loopback_port)}"
tls_frontend_port="${IDENTITY_PROTOCOL_REHEARSAL_TLS_FRONTEND_PORT:-$(free_loopback_port)}"
postgres_port="${IDENTITY_PROTOCOL_REHEARSAL_POSTGRES_PORT:-$(free_loopback_port)}"

if ! docker info >/dev/null 2>&1; then
  echo '[identity-protocol-rehearsal] Docker is required.' >&2
  exit 2
fi

mkdir -p "$artifact_dir"
chmod 700 "$artifact_dir"

node - "$root_dir" "$env_file" "$tls_dir" "$identity_secret_dir" "$realm_import_file" \
  "$backend_port" "$frontend_port" "$keycloak_port" "$tls_frontend_port" "$postgres_port" <<'NODE'
const fs = require('node:fs');
const [
  rootDir,
  envFile,
  tlsDir,
  identitySecretDir,
  realmImportFile,
  backendPort,
  frontendPort,
  keycloakPort,
  tlsFrontendPort,
  postgresPort,
] = process.argv.slice(2);
const randomHex = (bytes) => require('node:crypto').randomBytes(bytes).toString('hex');
const values = {
  NODE_ENV: 'development',
  EG_BACKEND_ENV_FILE: envFile,
  API_PORT: '8787',
  BACKEND_HOST_PORT: backendPort,
  FRONTEND_HOST_PORT: frontendPort,
  FRONTEND_URL: `https://localhost:${tlsFrontendPort}`,
  DATABASE_TYPE: 'postgres',
  POSTGRES_SCHEMA: 'main',
  POSTGRES_USER: 'enterpriseglue',
  POSTGRES_PASSWORD: randomHex(24),
  POSTGRES_DB: 'enterpriseglue',
  POSTGRES_HOST: 'db',
  POSTGRES_PORT: '5432',
  POSTGRES_DATABASE: 'enterpriseglue',
  POSTGRES_SSL: 'false',
  POSTGRES_SSL_REJECT_UNAUTHORIZED: 'false',
  POSTGRES_HOST_PORT: postgresPort,
  JWT_SECRET: randomHex(32),
  ADMIN_EMAIL: 'identity-protocol-rehearsal-admin@example.test',
  ADMIN_PASSWORD: randomHex(24),
  ADMIN_EMAIL_VERIFICATION_EXEMPT: 'true',
  ENCRYPTION_KEY: randomHex(32),
  GIT_REPOS_PATH: './data/repos',
  GIT_DEFAULT_BRANCH: 'main',
  API_BASE_URL: '',
  KEYCLOAK_HOST_PORT: keycloakPort,
  KEYCLOAK_INTERNAL_PORT: keycloakPort,
  KEYCLOAK_HTTPS_FRONTEND_PORT: tlsFrontendPort,
  KEYCLOAK_TLS_DIR: tlsDir,
  KEYCLOAK_REALM_IMPORT_FILE: realmImportFile,
  LOCAL_IDENTITY_SECRET_DIR: identitySecretDir,
};
fs.writeFileSync(envFile, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 });

const sourceRealm = JSON.parse(fs.readFileSync(`${rootDir}/infra/docker/keycloak/enterpriseglue-local-realm.json`, 'utf8'));
const publicOrigin = `https://localhost:${tlsFrontendPort}`;
for (const client of sourceRealm.clients || []) {
  if (['enterpriseglue-local', 'enterpriseglue-local-entra'].includes(client.clientId)) {
    client.redirectUris = [...new Set([...(client.redirectUris || []), `${publicOrigin}/*`])];
    client.webOrigins = [...new Set([...(client.webOrigins || []), publicOrigin])];
  }
  if (client.clientId === 'enterpriseglue-local-saml') {
    client.redirectUris = [...new Set([...(client.redirectUris || []), `${publicOrigin}/api/auth/providers/saml/callback`])];
  }
}
fs.writeFileSync(realmImportFile, `${JSON.stringify(sourceRealm, null, 2)}\n`, { mode: 0o644 });
NODE

# The parent temporary directory remains mode 0700. This mount source must be
# traversable and its short-lived fixture files readable by the non-root Node
# user inside Linux Docker containers, whose UID can differ from the host CI
# runner. It is removed during cleanup and never becomes an artifact.
mkdir -p "$identity_secret_dir"
chmod 755 "$identity_secret_dir"

compose=(
  docker compose --progress plain
  --project-name "$project_name"
  --project-directory "$root_dir"
  --env-file "$env_file"
  -f "$root_dir/infra/docker/compose/docker-compose.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.backend-expose.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.keycloak.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.keycloak-tls.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.keycloak-saml.yml"
)

run_compose() {
  EG_BACKEND_ENV_FILE="$env_file" "${compose[@]}" "$@"
}

capture_diagnostics() {
  run_compose ps --all > "$artifact_dir/compose-status.txt" 2>&1 || true
  for service in db backend frontend frontend-tls keycloak; do
    run_compose logs --no-color --tail=500 "$service" > "$artifact_dir/${service}.log" 2>&1 || true
  done
  if [[ -d "$playwright_output_dir" ]]; then
    rm -rf "$artifact_dir/playwright-results"
    cp -R "$playwright_output_dir" "$artifact_dir/playwright-results"
  fi
}

cleanup() {
  local status=$?
  trap - EXIT
  capture_diagnostics
  run_compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temp_dir"
  exit "$status"
}
trap cleanup EXIT

cd "$root_dir"
KEYCLOAK_TLS_DIR="$tls_dir" ./infra/docker/keycloak/generate-local-tls.sh

echo "[identity-protocol-rehearsal] Starting disposable local Docker stack ($project_name)."
run_compose up --build -d --wait db backend frontend frontend-tls keycloak

curl --fail --silent --show-error --cacert "$tls_dir/ca.crt" \
  "https://localhost:${tls_frontend_port}/login" >/dev/null
curl --fail --silent --show-error --cacert "$tls_dir/ca.crt" \
  "https://localhost:${keycloak_port}/realms/enterpriseglue-local/.well-known/openid-configuration" >/dev/null

# Materialise the public IdP signing certificate only after Keycloak is ready,
# then prove that the backend sees the same disposable bind mount before the
# SAML browser test configures a provider that references it.
LOCAL_SAML_ISSUER_URL="https://localhost:${keycloak_port}/realms/enterpriseglue-local" \
LOCAL_SAML_CA_FILE="$tls_dir/ca.crt" \
LOCAL_SAML_SIGNING_CERT_FILE="$identity_secret_dir/keycloak-saml-signing.crt" \
  "$root_dir/scripts/prepare-local-keycloak-saml-certificate.sh"
chmod 644 "$identity_secret_dir/keycloak-saml-signing.crt"
run_compose exec -T backend test -r /etc/enterpriseglue/local-identity-secrets/keycloak-saml-signing.crt

common_env=(
  LOCAL_OIDC_ADMIN_ENV_FILE="$env_file"
  LOCAL_SAML_ADMIN_ENV_FILE="$env_file"
  LOCAL_LDAP_ADMIN_ENV_FILE="$env_file"
  PLAYWRIGHT_WORKERS=1
  PLAYWRIGHT_OUTPUT_DIR="$playwright_output_dir"
  LOCAL_SAML_SIGNING_CERT_FILE="$identity_secret_dir/keycloak-saml-signing.crt"
  LOCAL_SAML_SKIP_SIGNING_CERTIFICATE_FETCH=true
  LOCAL_LDAP_SECRET_DIR="$identity_secret_dir"
  LOCAL_LDAP_SECRET_DIRECTORY_MODE=755
  LOCAL_LDAP_SECRET_FILE_MODE=644
)

echo '[identity-protocol-rehearsal] Running OIDC provider/mapping/browser authorization rehearsal.'
env "${common_env[@]}" pnpm run test:oidc:local-rehearsal 2>&1 | tee "$artifact_dir/oidc-rehearsal.log"

echo '[identity-protocol-rehearsal] Running Entra-compatible OIDC provider/mapping/browser authorization rehearsal.'
env "${common_env[@]}" pnpm run test:entra:local-rehearsal 2>&1 | tee "$artifact_dir/entra-oidc-rehearsal.log"

echo '[identity-protocol-rehearsal] Running signed SAML browser callback rehearsal.'
env "${common_env[@]}" pnpm run test:saml:local-rehearsal 2>&1 | tee "$artifact_dir/saml-rehearsal.log"

echo '[identity-protocol-rehearsal] Running direct LDAP TLS/browser sign-in rehearsal.'
env "${common_env[@]}" pnpm run test:ldap:local-rehearsal 2>&1 | tee "$artifact_dir/ldap-rehearsal.log"

node - "$artifact_dir/summary.txt" <<'NODE'
const { writeFileSync } = require('node:fs');
writeFileSync(process.argv[2], [
  'status=passed',
  'protocols=oidc,entra-compatible-oidc,saml,ldap',
  'scope=disposable-localhost-docker-stack',
  'artifacts=compose-status,service-logs,playwright-output,protocol-run-logs',
  'credentials=ephemeral-and-not-retained',
  '',
].join('\n'));
NODE

echo '[identity-protocol-rehearsal] Passed; diagnostics are retained and the disposable stack will now be removed.'
